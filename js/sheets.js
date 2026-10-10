/* ==========================================================================
   Sheets: two-way sync with the WorthyOps Google Sheet.
   - Pull: reads Leads / Content / Daily Activity from the sheet's Apps Script
     web app and replaces the dashboard's copies (sheet = source of truth).
   - Push: every add / edit / delete on the dashboard is queued and written
     back to the sheet.
   Connection settings come from APP_CONFIG.sheetSync, or from
   Admin → Settings → Google Sheet (saved in this browser).
   ========================================================================== */

const Sheets = (() => {
  const LS_KEY = 'worthyops_sheet_sync';
  const POLL_MS = 60 * 1000;

  const STAGE_LABEL = Object.fromEntries(APP_CONFIG.leadStages.map((s) => [s.key, s.label]));
  const STAGE_KEY = Object.fromEntries(APP_CONFIG.leadStages.map((s) => [s.label.toLowerCase(), s.key]));
  const ORIGIN_LABEL = { outbound: 'Outbound', organic: 'Organic content', paid: 'Paid ads' };
  const CHANNEL_LABEL = { organic: 'Organic content', paid: 'Paid ads' };

  let queue = [];
  let flushing = false;
  let flushTimer = null;
  let pollTimer = null;
  const status = { state: 'off', last: null, error: '' };
  const statusListeners = new Set();

  // ---------- Settings ----------
  function config() {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { /* ignore */ }
    const base = APP_CONFIG.sheetSync || {};
    const c = Object.assign({ url: '', key: '' }, base, local || {});
    return { url: String(c.url || '').trim(), key: String(c.key || '').trim() };
  }
  const isConfigured = () => !!config().url;
  const supaOn = () => typeof Supa !== 'undefined' && Supa.enabled();
  async function isAdmin() {
    const uid = await Supa.currentUserId();
    const me = uid ? Store.getUser(uid) : null;
    return !!me && me.role === 'admin';
  }

  function saveConfig({ url, key }) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ url: url.trim(), key: key.trim() })); } catch (e) { /* ignore */ }
  }
  function clearConfig() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ url: '', key: '' })); } catch (e) { /* ignore */ }
  }

  function setStatus(patch) {
    Object.assign(status, patch);
    statusListeners.forEach((fn) => fn(Object.assign({}, status)));
  }
  const onStatus = (fn) => { statusListeners.add(fn); fn(Object.assign({}, status)); return () => statusListeners.delete(fn); };

  // ---------- Helpers ----------
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const num = (v) => {
    const n = Number(String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  };
  // Dates arrive as 'yyyy-mm-dd', or as UTC timestamps from older script versions
  const day = (v) => {
    const t = str(v);
    if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
      const d = new Date(t);
      return isNaN(d) ? '' : Utils.toISO(d);
    }
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
  };
  const userByName = (name) => {
    const n = str(name).toLowerCase();
    if (!n) return null;
    return Store.getUsers().find((u) => u.name.toLowerCase() === n || u.email === n) || null;
  };

  // ---------- Sheet row → dashboard ----------
  function rowToContent(r) {
    const published = day(r['Published']) || Utils.toISO(Utils.today());
    return {
      id: str(r['Content ID']),
      title: str(r['Title / Hook']),
      channel: /paid/i.test(str(r['Channel'])) ? 'paid' : 'organic',
      platform: str(r['Platform']),
      format: str(r['Format']),
      url: str(r['Link']),
      publishedAt: published,
      views: Math.round(num(r['Views / Reach'])),
      adSpend: num(r['Ad Spend']),
      notes: '',
      createdAt: Utils.parseISO(published).toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function rowToLead(r, contentsByTitle) {
    const content = contentsByTitle.get(str(r['Content / Ad']).toLowerCase()) || null;
    const typeText = str(r['Lead Type']).toLowerCase();
    const origin = content ? content.channel : /paid/.test(typeText) ? 'paid' : /organic|content|inbound/.test(typeText) ? 'organic' : 'outbound';
    let stage = STAGE_KEY[str(r['Stage']).toLowerCase()] || 'new';
    // "Reached Out" = "Reached out" moves a new lead to Contacted ("Not reached out" doesn't match)
    if (stage === 'new' && /^reached out$/i.test(str(r['Reached Out']))) stage = 'contacted';
    const owner = userByName(r['Owner']);
    const added = day(r['Date Added']) || Utils.toISO(Utils.today());
    const order = APP_CONFIG.leadStages.map((s) => s.key);
    const stageDates = {};
    if (stage !== 'lost') order.slice(0, order.indexOf(stage) + 1).forEach((k) => { stageDates[k] = added; });
    return {
      id: str(r['Lead ID']),
      name: str(r['Name']),
      business: str(r['Business']),
      handle: str(r['Handle / Link']),
      email: str(r['Email']),
      phone: str(r['Phone']),
      origin,
      contentId: content ? content.id : null,
      source: str(r['Platform']),
      niche: str(r['Niche']),
      ownerId: owner ? owner.id : null,
      ownerName: owner ? '' : str(r['Owner']),
      stage,
      message: str(r['Outreach Message']),
      followUps: Math.round(num(r['Follow-ups'])),
      lastContactAt: day(r['Last Contact']),
      nextFollowUpAt: day(r['Next Follow-up']),
      dealValue: num(r['Deal Value']),
      amountPaid: num(r['Amount Paid']),
      notes: str(r['Notes']),
      stageDates,
      createdAt: Utils.parseISO(added).toISOString(), // local midnight, so the local date round-trips
      updatedAt: new Date().toISOString()
    };
  }

  function rowToEntry(r) {
    const date = day(r['Date']);
    const member = str(r['Team Member']);
    const user = userByName(member);
    return {
      id: `d_${date}_${member.toLowerCase().replace(/\W+/g, '-')}`,
      userId: user ? user.id : null,
      memberName: member,
      date,
      outreach: num(r['Outreach Sent']),
      followUps: num(r['Follow-ups Sent']),
      replies: num(r['Replies Received']),
      callsBooked: num(r['Calls Booked']),
      callsShown: num(r['Calls Attended']),
      dealsClosed: num(r['Deals Converted']),
      paid: num(r['Clients Paid']),
      revenue: num(r['Revenue Closed']),
      cashCollected: num(r['Cash Collected']),
      notes: str(r['Notes']),
      createdAt: Utils.parseISO(date).toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  // ---------- Dashboard → sheet row ----------
  function leadToRow(l) {
    const content = l.contentId ? Store.getContent(l.contentId) : null;
    const owner = l.ownerId ? Store.getUser(l.ownerId) : null;
    return {
      'Lead ID': l.id,
      'Date Added': l.createdAt ? Utils.toISO(new Date(l.createdAt)) : Utils.toISO(Utils.today()), // local date, not UTC
      'Name': l.name,
      'Business': l.business || '',
      'Handle / Link': l.handle || '',
      'Email': l.email || '',
      'Phone': l.phone || '',
      'Lead Type': ORIGIN_LABEL[l.origin || 'outbound'],
      'Content / Ad': content ? content.title : '',
      'Platform': l.source || '',
      'Niche': l.niche || '',
      'Owner': owner ? owner.name : (l.ownerName || ''),
      'Stage': STAGE_LABEL[l.stage] || 'New lead',
      'Outreach Message': l.message || '',
      'Follow-ups': l.followUps || 0,
      'Last Contact': l.lastContactAt || '',
      'Next Follow-up': l.nextFollowUpAt || '',
      'Deal Value': l.dealValue || 0,
      'Amount Paid': l.amountPaid || 0,
      'Notes': l.notes || ''
    };
  }

  function contentToRow(c) {
    return {
      'Content ID': c.id,
      'Title / Hook': c.title,
      'Channel': CHANNEL_LABEL[c.channel] || 'Organic content',
      'Platform': c.platform || '',
      'Format': c.format || '',
      'Published': c.publishedAt || '',
      'Link': c.url || '',
      'Views / Reach': c.views || 0,
      'Ad Spend': c.adSpend || 0
    };
  }

  function entryToRow(e) {
    const user = e.userId ? Store.getUser(e.userId) : null;
    return {
      'Date': e.date,
      'Team Member': user ? user.name : (e.memberName || ''),
      'Outreach Sent': e.outreach || 0,
      'Follow-ups Sent': e.followUps || 0,
      'Replies Received': e.replies || 0,
      'Calls Booked': e.callsBooked || 0,
      'Calls Attended': e.callsShown || 0,
      'Deals Converted': e.dealsClosed || 0,
      'Clients Paid': e.paid || 0,
      'Revenue Closed': e.revenue || 0,
      'Cash Collected': e.cashCollected || 0,
      'Notes': e.notes || ''
    };
  }

  const TO_ROW = { leads: leadToRow, content: contentToRow, daily: entryToRow };

  // ---------- Network ----------
  async function request(method, payload) {
    const { url, key } = config();
    if (!url) throw new Error('Google Sheet is not connected.');
    let res;
    if (method === 'GET') {
      res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}&t=${Date.now()}`);
    } else {
      // text/plain keeps this a "simple" request (no CORS preflight, which Apps Script can't answer)
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key }, payload)) });
    }
    if (!res.ok) throw new Error(`Google Sheet responded with ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error === 'unauthorized' ? 'Wrong API key for this sheet.' : data.error || 'Sheet error');
    return data;
  }

  /** Copy the sheet's rows into Supabase (used when Supabase is the data store). */
  async function importToSupabase() {
    setStatus({ state: 'syncing', error: '' });
    try {
      const { data } = await request('GET');
      const contents = (data.content || []).map(rowToContent).filter((c) => c.id && c.title);
      const byTitle = new Map(contents.map((c) => [c.title.toLowerCase(), c]));
      const leads = (data.leads || []).map((r) => rowToLead(r, byTitle)).filter((l) => l.id && l.name);
      // Daily rows whose Team Member doesn't match a dashboard login can't be stored, so skip them
      const entries = (data.daily || []).map(rowToEntry).filter((e) => e.date && e.userId);
      const counts = await Supa.importSheet({ contents, leads, entries });
      setStatus({ state: 'ok', last: new Date(), error: '', counts });
      return true;
    } catch (e) {
      setStatus({ state: 'error', error: e.message });
      return false;
    }
  }

  /** Read everything from the sheet and replace the dashboard's synced data. */
  async function pull() {
    if (!isConfigured()) return false;
    if (supaOn()) return importToSupabase();
    if (queue.length || flushing) return false; // don't overwrite unsent local edits
    setStatus({ state: 'syncing', error: '' });
    try {
      const { data } = await request('GET');
      const contents = (data.content || []).map(rowToContent).filter((c) => c.id && c.title);
      const byTitle = new Map(contents.map((c) => [c.title.toLowerCase(), c]));
      const leads = (data.leads || []).map((r) => rowToLead(r, byTitle)).filter((l) => l.id && l.name);
      const entries = (data.daily || []).map(rowToEntry).filter((e) => e.date);
      if (queue.length || flushing) return false; // a local edit happened while we were fetching
      // First sync on this browser: the sheet is the real data, so drop the demo team
      if (!Store.getSettings().demoRemoved) Store.removeDemoData();
      Store.applyRemote({ leads, contents, entries });
      setStatus({ state: 'ok', last: new Date(), error: '', counts: { leads: leads.length, content: contents.length, daily: entries.length } });
      return true;
    } catch (e) {
      setStatus({ state: 'error', error: e.message });
      return false;
    }
  }

  /** Queue a change (called by the Store remote hook). */
  function enqueue(kind, action, record) {
    if (!TO_ROW[kind]) return; // users / settings aren't stored in the sheet
    const row = TO_ROW[kind](record);
    queue.push({ kind, action, record: row });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
  }

  async function flush() {
    if (flushing || !queue.length) return;
    flushing = true;
    const ops = queue.splice(0, queue.length);
    setStatus({ state: 'syncing', error: '' });
    try {
      const res = await request('POST', { ops });
      const failed = (res.results || []).filter((r) => !r.ok);
      if (failed.length) throw new Error(failed[0].error || 'Some changes were not saved to the sheet');
      setStatus({ state: 'ok', last: new Date() });
    } catch (e) {
      queue = ops.concat(queue); // retry later
      setStatus({ state: 'error', error: e.message });
      flushing = false;
      setTimeout(flush, 15000);
      return;
    }
    flushing = false;
    if (queue.length) flush();
  }

  /** Start syncing on this page (no-op if not configured). */
  async function start() {
    if (!isConfigured()) { setStatus({ state: 'off' }); return false; }
    if (supaOn()) {
      // Supabase holds the data; the sheet is copied into it. Only admins can write every table.
      if (!(await isAdmin())) { setStatus({ state: 'off' }); return false; }
      const ok = await pull();
      clearInterval(pollTimer);
      pollTimer = setInterval(pull, POLL_MS);
      return ok;
    }
    Store.setRemote(enqueue);
    const ok = await pull();
    clearInterval(pollTimer);
    pollTimer = setInterval(pull, POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    window.addEventListener('beforeunload', () => { if (queue.length) flush(); });
    return ok;
  }

  function stop() {
    clearInterval(pollTimer);
    if (!supaOn()) Store.setRemote(null); // with Supabase on, the remote hook is Supabase's, not ours
    setStatus({ state: 'off', error: '' });
  }

  /** Test a URL/key pair without saving it. */
  async function test(url, key) {
    const res = await fetch(`${url.trim()}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key.trim())}&t=${Date.now()}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error === 'unauthorized' ? 'Wrong API key.' : data.error || 'Sheet error');
    return { leads: (data.data.leads || []).length, content: (data.data.content || []).length, daily: (data.data.daily || []).length };
  }

  // ---------- Status chip ----------
  function ago(d) {
    if (!d) return '';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    return `${Math.round(s / 60)}m ago`;
  }

  /** Render a small sync status chip into `el` and keep it updated. */
  function mountStatus(el) {
    if (!el) return;
    const paint = (st) => {
      if (st.state === 'off') { el.hidden = true; return; }
      el.hidden = false;
      el.className = `sync-chip ${st.state}`;
      const label = st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Sync error' : `Synced ${ago(st.last)}`;
      el.innerHTML = `<i></i><span>Google Sheet · ${label}</span>`;
      el.title = st.error || 'Click to sync now';
    };
    el.onclick = () => pull();
    onStatus(paint);
    setInterval(() => paint(status), 15000);
  }

  return { config, isConfigured, saveConfig, clearConfig, start, stop, pull, test, onStatus, mountStatus, status: () => Object.assign({}, status) };
})();
