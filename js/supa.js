/* ==========================================================================
   Supa: Supabase backend (logins + database).
   Active when APP_CONFIG.supabase.url and .anonKey are set and the
   supabase-js library is loaded. Then:
   - Logins use Supabase Auth; roles / active flag come from public.profiles.
   - Store keeps an in-memory copy of profiles, settings, content, leads and
     daily_activity, refreshed every 30s; every change is written straight
     to Supabase (Store remote hook).
   Row-level security in supabase/*.sql decides what each user can see.
   ========================================================================== */

const Supa = (() => {
  const POLL_MS = 30 * 1000;
  let client = null;
  let pollTimer = null;
  const status = { state: 'off', last: null, error: '' };
  const statusListeners = new Set();

  const cfg = () => APP_CONFIG.supabase || {};
  const enabled = () => !!(cfg().url && cfg().anonKey && window.supabase && window.supabase.createClient);

  function db() {
    if (!client) client = window.supabase.createClient(cfg().url, cfg().anonKey);
    return client;
  }

  function setStatus(patch) {
    Object.assign(status, patch);
    statusListeners.forEach((fn) => fn(Object.assign({}, status)));
  }
  const onStatus = (fn) => { statusListeners.add(fn); fn(Object.assign({}, status)); return () => statusListeners.delete(fn); };

  function fail(error, context) {
    const msg = (error && (error.message || error.error_description)) || String(error);
    setStatus({ state: 'error', error: msg });
    if (typeof Utils !== 'undefined') Utils.toast(`${context}: ${msg}`, 'error');
    return msg;
  }

  // ---------- Row ↔ dashboard mapping ----------
  const num = (v) => Number(v) || 0;
  const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

  function profileToUser(p) {
    const t = {
      outreach: p.target_outreach, callsBooked: p.target_calls_booked,
      dealsClosed: p.target_deals_closed, revenue: p.target_revenue
    };
    const hasTargets = Object.values(t).some((v) => v !== null && v !== undefined && Number(v) > 0);
    return {
      id: p.id,
      name: p.full_name || p.email,
      email: p.email,
      role: p.role,
      active: p.active,
      targets: hasTargets ? Object.fromEntries(Object.entries(t).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])) : null,
      createdAt: p.created_at,
      lastLogin: p.last_login
    };
  }

  function rowToSettings(s) {
    return {
      currency: s.currency,
      locale: s.locale,
      showLeaderboardToTeam: s.show_leaderboard_to_team,
      targets: {
        outreach: num(s.target_outreach),
        callsBooked: num(s.target_calls_booked),
        dealsClosed: num(s.target_deals_closed),
        revenue: num(s.target_revenue)
      }
    };
  }

  function rowToContent(r) {
    return {
      id: r.id, title: r.title, channel: r.channel, platform: r.platform, format: r.format,
      url: r.url, publishedAt: r.published_at, views: num(r.views), adSpend: num(r.ad_spend),
      notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at
    };
  }

  function rowToLead(r) {
    return {
      id: r.id, name: r.name, business: r.business, handle: r.handle, email: r.email, phone: r.phone,
      origin: r.origin, contentId: r.content_id, source: r.source, niche: r.niche,
      ownerId: r.owner_id, ownerName: '', stage: r.stage, message: r.message,
      followUps: num(r.follow_ups), lastContactAt: r.last_contact_at || '', nextFollowUpAt: r.next_follow_up_at || '',
      dealValue: num(r.deal_value), amountPaid: num(r.amount_paid), notes: r.notes,
      stageDates: r.stage_dates || {}, createdAt: r.created_at, updatedAt: r.updated_at
    };
  }

  function rowToEntry(r) {
    return {
      id: r.id, userId: r.user_id, date: r.date,
      outreach: num(r.outreach), followUps: num(r.follow_ups), replies: num(r.replies),
      callsBooked: num(r.calls_booked), callsShown: num(r.calls_shown), dealsClosed: num(r.deals_closed),
      paid: num(r.paid), revenue: num(r.revenue), cashCollected: num(r.cash_collected),
      notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at
    };
  }

  const leadToRow = (l) => ({
    id: l.id, name: l.name, business: l.business || '', handle: l.handle || '', email: l.email || '',
    phone: l.phone || '', origin: l.origin || 'outbound', content_id: l.contentId || null,
    source: l.source || '', niche: l.niche || '', owner_id: l.ownerId || null, stage: l.stage,
    message: l.message || '', follow_ups: l.followUps || 0,
    last_contact_at: dateOrNull(l.lastContactAt), next_follow_up_at: dateOrNull(l.nextFollowUpAt),
    deal_value: l.dealValue || 0, amount_paid: l.amountPaid || 0, notes: l.notes || '',
    stage_dates: l.stageDates || {}, created_at: l.createdAt
  });

  const contentToRow = (c) => ({
    id: c.id, title: c.title, channel: c.channel, platform: c.platform || '', format: c.format || '',
    url: c.url || '', published_at: dateOrNull(c.publishedAt), views: c.views || 0,
    ad_spend: c.adSpend || 0, notes: c.notes || ''
  });

  const entryToRow = (e) => ({
    user_id: e.userId, date: e.date, outreach: e.outreach || 0, follow_ups: e.followUps || 0,
    replies: e.replies || 0, calls_booked: e.callsBooked || 0, calls_shown: e.callsShown || 0,
    deals_closed: e.dealsClosed || 0, paid: e.paid || 0, revenue: e.revenue || 0,
    cash_collected: e.cashCollected || 0, notes: e.notes || ''
  });

  const settingsToRow = (s) => ({
    currency: s.currency, locale: s.locale, show_leaderboard_to_team: !!s.showLeaderboardToTeam,
    target_outreach: num(s.targets.outreach), target_calls_booked: num(s.targets.callsBooked),
    target_deals_closed: num(s.targets.dealsClosed), target_revenue: num(s.targets.revenue)
  });

  function userPatchToRow(patch) {
    const row = {};
    if ('name' in patch) row.full_name = patch.name;
    if ('active' in patch) row.active = patch.active;
    if ('role' in patch) row.role = patch.role;
    if ('lastLogin' in patch) row.last_login = patch.lastLogin;
    if ('targets' in patch) {
      const t = patch.targets || {};
      row.target_outreach = t.outreach || null;
      row.target_calls_booked = t.callsBooked || null;
      row.target_deals_closed = t.dealsClosed || null;
      row.target_revenue = t.revenue || null;
    }
    return row;
  }

  // ---------- Auth ----------
  async function currentUserId() {
    const { data } = await db().auth.getSession();
    return data && data.session ? data.session.user.id : null;
  }

  async function fetchProfile(id) {
    const { data, error } = await db().from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? profileToUser(data) : null;
  }

  /** Sign in and return the dashboard user (role/active come from profiles). */
  async function signIn(email, password) {
    const { data, error } = await db().auth.signInWithPassword({ email: String(email).trim(), password });
    if (error) return { ok: false, error: /invalid/i.test(error.message) ? 'Incorrect email or password.' : error.message };
    const user = await fetchProfile(data.user.id);
    if (!user) {
      await db().auth.signOut();
      return { ok: false, error: 'This login has no dashboard profile. Ask your admin.' };
    }
    db().from('profiles').update({ last_login: new Date().toISOString() }).eq('id', user.id).then(() => {});
    return { ok: true, user };
  }

  async function signOut() {
    try { await db().auth.signOut(); } catch (e) { /* ignore */ }
  }

  /** Re-check a user's current password (used before changing it). */
  async function checkPassword(email, password) {
    const { error } = await db().auth.signInWithPassword({ email, password });
    return !error;
  }

  async function changeOwnPassword(password) {
    const { error } = await db().auth.updateUser({ password });
    if (error) throw new Error(error.message);
  }

  async function changeOwnEmail(email) {
    const { error } = await db().auth.updateUser({ email });
    if (error) throw new Error(error.message);
  }

  async function sendPasswordReset(email) {
    const { error } = await db().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname.replace(/[^/]*$/, 'index.html') });
    if (error) throw new Error(error.message);
  }

  /**
   * Admin creates a team login. Uses a separate, non-persisting client so the
   * admin stays signed in. The profile row is created by the database trigger.
   */
  async function createMember({ name, email, password }) {
    const temp = window.supabase.createClient(cfg().url, cfg().anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    const { data, error } = await temp.auth.signUp({ email, password, options: { data: { full_name: name } } });
    if (error) throw new Error(error.message);
    if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
      throw new Error('An account with this email already exists.');
    }
    // Profile row is created by the trigger; read it back (admin can read all profiles)
    let user = null;
    for (let i = 0; i < 5 && !user; i++) {
      user = await fetchProfile(data.user.id);
      if (!user) await new Promise((r) => setTimeout(r, 400));
    }
    if (!user) user = { id: data.user.id, name, email, role: 'member', active: true, targets: null, createdAt: new Date().toISOString(), lastLogin: null };
    else if (!user.name || user.name === email) {
      await db().from('profiles').update({ full_name: name }).eq('id', user.id);
      user.name = name;
    }
    return { user, needsConfirmation: !data.session };
  }

  // ---------- Google Sheet import ----------
  /** Sheet ids are short text ("1", "L-1a2b3c4d") but Supabase ids are UUIDs.
   *  Derive a stable UUID from each sheet id, so re-running the import updates the same rows. */
  async function uuidFor(key) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).slice(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4 layout
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** Upsert dashboard-shaped rows read from the sheet. Admins only (RLS). */
  async function importSheet({ contents, leads, entries }) {
    const contentIds = new Map();
    const contentRows = [];
    for (const c of contents) {
      const id = await uuidFor(`content:${c.id}`);
      contentIds.set(c.id, id);
      contentRows.push(contentToRow({ ...c, id }));
    }
    const leadRows = [];
    for (const l of leads) {
      leadRows.push(leadToRow({
        ...l,
        id: await uuidFor(`lead:${l.id}`),
        contentId: l.contentId ? contentIds.get(l.contentId) || null : null
      }));
    }
    const entryRows = entries.map(entryToRow);

    const steps = [
      ['content', contentRows, { onConflict: 'id' }],
      ['leads', leadRows, { onConflict: 'id' }],
      ['daily_activity', entryRows, { onConflict: 'user_id,date' }]
    ];
    for (const [table, rows, opts] of steps) {
      if (!rows.length) continue;
      const { error } = await db().from(table).upsert(rows, opts);
      if (error) throw error;
    }
    return { content: contentRows.length, leads: leadRows.length, daily: entryRows.length };
  }

  // ---------- Data ----------
  /** Load everything this user may see and hand it to the Store. */
  async function pull() {
    if (!enabled()) return false;
    setStatus({ state: 'syncing', error: '' });
    try {
      const uid = await currentUserId();
      if (!uid) { setStatus({ state: 'off' }); return false; }
      const [profiles, settings, content, leads, daily] = await Promise.all([
        db().from('profiles').select('*').order('full_name'),
        db().from('settings').select('*').eq('id', 1).maybeSingle(),
        db().from('content').select('*').order('published_at', { ascending: false }),
        db().from('leads').select('*').order('created_at', { ascending: false }),
        db().from('daily_activity').select('*').order('date', { ascending: false })
      ]);
      for (const r of [profiles, settings, content, leads, daily]) if (r.error) throw r.error;
      Store.applyRemote({
        users: profiles.data.map(profileToUser),
        settings: settings.data ? rowToSettings(settings.data) : null,
        contents: content.data.map(rowToContent),
        leads: leads.data.map(rowToLead),
        entries: daily.data.map(rowToEntry)
      });
      setStatus({ state: 'ok', last: new Date(), error: '', counts: { leads: leads.data.length, content: content.data.length, daily: daily.data.length } });
      return true;
    } catch (e) {
      fail(e, 'Could not load data from Supabase');
      return false;
    }
  }

  let pending = 0;
  /** Store remote hook: write one change to Supabase. */
  async function write(kind, action, record) {
    pending++;
    setStatus({ state: 'syncing' });
    try {
      let res;
      if (kind === 'leads') {
        res = action === 'delete'
          ? await db().from('leads').delete().eq('id', record.id)
          : await db().from('leads').upsert(leadToRow(record));
      } else if (kind === 'content') {
        res = action === 'delete'
          ? await db().from('content').delete().eq('id', record.id)
          : await db().from('content').upsert(contentToRow(record));
      } else if (kind === 'daily') {
        res = action === 'delete'
          ? await db().from('daily_activity').delete().eq('user_id', record.userId).eq('date', record.date)
          : await db().from('daily_activity').upsert(entryToRow(record), { onConflict: 'user_id,date' });
      } else if (kind === 'settings') {
        res = await db().from('settings').update(settingsToRow(record)).eq('id', 1);
      } else if (kind === 'users') {
        res = action === 'delete'
          ? await db().from('profiles').delete().eq('id', record.id)
          : await db().from('profiles').update(userPatchToRow(record.patch)).eq('id', record.id);
      } else {
        return;
      }
      if (res && res.error) throw res.error;
      if (--pending === 0) setStatus({ state: 'ok', last: new Date() });
    } catch (e) {
      pending = Math.max(0, pending - 1);
      fail(e, 'Could not save to Supabase');
      // Reload so the screen shows what's really in the database
      setTimeout(pull, 1500);
    }
  }

  /** Team leaderboard (members can't read each other's rows, so use the RPC). */
  async function leaderboard(from, to) {
    const { data, error } = await db().rpc('team_leaderboard', { p_from: from, p_to: to });
    if (error) throw error;
    return (data || []).map((r) => ({
      user: { id: r.user_id, name: r.full_name },
      totals: { outreach: num(r.outreach), replies: num(r.replies), callsBooked: num(r.calls_booked), dealsClosed: num(r.deals_closed), revenue: num(r.revenue) }
    }));
  }

  /** Called by Store.init: load the signed-in user's data and start syncing. */
  async function boot() {
    const uid = await currentUserId();
    if (!uid) {
      // Supabase session gone (signed out / expired): drop the dashboard session
      // and any data cached in this browser (matters on shared computers)
      Auth.clearSession();
      Store.applyRemote({ users: [], leads: [], contents: [], entries: [] });
      setStatus({ state: 'off' });
      return false;
    }
    Store.setRemote(write);
    await pull();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!pending) pull(); }, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !pending) pull(); });
    return true;
  }

  // ---------- Status chip ----------
  function mountStatus(el) {
    if (!el) return;
    const ago = (d) => {
      if (!d) return '';
      const s = Math.round((Date.now() - d.getTime()) / 1000);
      return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
    };
    const paint = (st) => {
      if (st.state === 'off') { el.hidden = true; return; }
      el.hidden = false;
      el.className = `sync-chip ${st.state}`;
      const label = st.state === 'syncing' ? 'Saving…' : st.state === 'error' ? 'Error' : `Synced ${ago(st.last)}`;
      el.innerHTML = `<i></i><span>Supabase · ${label}</span>`;
      el.title = st.error || 'Click to refresh';
    };
    el.onclick = () => pull();
    onStatus(paint);
    setInterval(() => paint(status), 15000);
  }

  return {
    enabled, client: db, boot, pull, write, leaderboard,
    signIn, signOut, checkPassword, changeOwnPassword, changeOwnEmail, sendPasswordReset, createMember,
    currentUserId, fetchProfile, onStatus, mountStatus, importSheet, status: () => Object.assign({}, status)
  };
})();
