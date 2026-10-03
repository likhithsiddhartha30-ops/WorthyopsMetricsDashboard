/* ==========================================================================
   Admin dashboard page
   ========================================================================== */

(async function () {
  const { $, $$, escapeHtml: esc, num, money } = Utils;

  Utils.bindThemeToggles();
  Utils.bindSidebar();
  await Store.init();
  const me = Auth.requireRole('admin');
  if (!me) return;
  Dashboard.fillUserChip(me);

  // ---------- State ----------
  const PREF_KEY = 'worthyops_admin_filters';
  const state = { view: 'overview', range: '30d', member: 'all' };
  try { Object.assign(state, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch (e) { /* ignore */ }
  const teamSort = { key: 'revenue', dir: 'desc' };
  const entriesState = { sortKey: 'date', sortDir: 'desc', page: 0 };

  const VIEWS = {
    overview: { title: 'Overview', filters: true },
    team: { title: 'Team performance', filters: true },
    leads: { title: 'Leads', filters: false },
    content: { title: 'Content', filters: true, noMember: true },
    activity: { title: 'Activity log', filters: true },
    members: { title: 'Team members', filters: false },
    settings: { title: 'Settings', filters: false }
  };

  const savePrefs = () => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ range: state.range, member: state.member })); } catch (e) { /* ignore */ }
  };

  // ---------- Filters ----------
  function fillMemberFilter() {
    const sel = $('#f-member');
    const members = Store.getMembers();
    if (state.member !== 'all' && !members.some((m) => m.id === state.member)) state.member = 'all';
    sel.innerHTML = '<option value="all">All team members</option>' +
      members.map((m) => `<option value="${m.id}">${esc(m.name)}${m.active ? '' : ' (inactive)'}</option>`).join('');
    sel.value = state.member;
  }

  function scope() {
    const all = Store.getEntries();
    const range = Utils.resolveRange(state.range, Metrics.earliestDate(all));
    const userIds = state.member === 'all' ? null : [state.member];
    return {
      range,
      all,
      cur: Metrics.filter(all, { from: range.from, to: range.to, userIds }),
      prev: Metrics.filter(all, { from: range.prevFrom, to: range.prevTo, userIds }),
      members: state.member === 'all' ? Store.getMembers() : Store.getMembers().filter((m) => m.id === state.member)
    };
  }

  Dashboard.bindRange($('#f-range'), state.range, (v) => { state.range = v; entriesState.page = 0; savePrefs(); render(); });
  const leadsView = Leads.mount({ root: $('#leads-root'), me, isAdmin: true });
  const contentView = Content.mount({ root: $('#content-root'), me });
  $('#f-member').addEventListener('change', (e) => { state.member = e.target.value; entriesState.page = 0; savePrefs(); render(); });

  $('#btn-log').addEventListener('click', () => {
    const members = Store.getMembers().filter((m) => m.active);
    if (!members.length) { Utils.toast('Add a team member first.', 'error'); location.hash = '#members'; return; }
    Dashboard.openEntryModal({
      members,
      userId: state.member !== 'all' ? state.member : members[0].id,
      onSaved: () => Utils.toast('Activity saved.')
    });
  });

  // ---------- Render ----------
  function render() {
    const v = VIEWS[state.view];
    $('#page-title').textContent = v.title;
    $('#filters').style.visibility = v.filters ? 'visible' : 'hidden';
    $('#f-member').hidden = !!v.noMember;
    fillMemberFilter();
    const s = scope();
    $('#page-sub').textContent = v.filters
      ? `${s.range.label} · ${Utils.formatDate(s.range.from)} – ${Utils.formatDate(s.range.to)}`
      : state.view === 'leads' ? 'Every prospect your team is working, from first message to paid' : '';

    // Sidebar badge: follow-ups due across all leads
    const due = Leads.summarize(Store.getLeads()).due;
    const badge = $('#nav-leads-count');
    badge.textContent = due ? due : '';
    badge.hidden = !due;
    badge.classList.toggle('alert', due > 0);
    badge.title = `${due} follow-ups due`;

    ({ overview: renderOverview, team: renderTeam, leads: () => leadsView.render(), content: () => contentView.render(s.range), activity: renderActivity, members: renderMembers, settings: renderSettings })[state.view](s);
  }

  function renderOverview(s) {
    const cur = Metrics.totals(s.cur);
    const prev = Metrics.totals(s.prev);
    const single = state.member !== 'all' ? Store.getUser(state.member) : null;
    const leads = Store.getLeads().filter((l) => !single || l.ownerId === single.id);
    const ls = Leads.summarize(leads);
    Dashboard.renderHero($('#hero'), {
      eyebrow: `${s.range.label} · ${single ? single.name : 'Whole team'}`,
      title: `${Dashboard.greeting()}, ${Store.getUser(me.id).name.split(' ')[0]}`,
      text: `${single ? single.name.split(' ')[0] : 'The team'} sent <strong>${num(cur.outreach)}</strong> messages, booked <strong>${num(cur.callsBooked)}</strong> calls and converted <strong>${num(cur.dealsClosed)}</strong> clients. ${ls.due ? `<strong>${num(ls.due)}</strong> lead follow-ups are due.` : 'No follow-ups are due.'}`,
      stats: [
        { label: 'Revenue closed', value: money(cur.revenue) },
        { label: 'Cash collected', value: money(cur.cashCollected) },
        { label: 'Open pipeline', value: money(ls.pipeline) }
      ]
    });
    const points = Metrics.timeSeries(s.cur, s.range.from, s.range.to).points;
    Dashboard.renderKpis($('#kpis'), cur, prev, points);
    Dashboard.renderRates($('#rates'), cur, prev);
    Dashboard.renderFunnel($('#funnel'), cur);
    Dashboard.renderTrendCharts(s.cur, s.range);
    Dashboard.renderCollections(cur);

    // Targets: team targets, or one member's targets when filtered
    const targets = single ? Metrics.memberTargets(single) : Store.getSettings().targets;
    const scoped = single ? Metrics.filter(s.all, { userId: single.id }) : s.all;
    $('#targets-sub').textContent = single ? `${single.name}'s targets` : 'Whole team';
    Dashboard.renderTargets($('#targets'), Metrics.monthProgress(scoped, targets));

    // Revenue by member
    const rows = Metrics.byMember(s.cur, s.members);
    $('#member-revenue-box').style.height = Math.max(220, rows.length * 56 + 40) + 'px';
    Charts.bar('chart-member-revenue', {
      horizontal: true,
      format: 'money',
      labels: rows.map((r) => r.user.name),
      datasets: [
        { label: 'Revenue closed', data: rows.map((r) => r.totals.revenue), slot: 1 },
        { label: 'Cash collected', data: rows.map((r) => r.totals.cashCollected), slot: 3 }
      ]
    });
    Dashboard.legend($('#legend-member-revenue'), [{ label: 'Revenue closed', slot: 1 }, { label: 'Cash collected', slot: 3 }]);
  }

  function renderTeam(s) {
    const rows = Metrics.byMember(s.cur, s.members);
    const val = (r) => (teamSort.key in r.totals ? r.totals[teamSort.key] : r.rates[teamSort.key]);
    rows.sort((a, b) => {
      const av = isFinite(val(a)) ? val(a) : -1;
      const bv = isFinite(val(b)) ? val(b) : -1;
      return teamSort.dir === 'asc' ? av - bv : bv - av;
    });
    Dashboard.renderLeaderboard($('#leaderboard'), rows);
    $$('#leaderboard-table th[data-sort]').forEach((th) => {
      th.classList.add('sortable');
      th.classList.toggle('sorted', th.dataset.sort === teamSort.key);
      th.classList.toggle('asc', th.dataset.sort === teamSort.key && teamSort.dir === 'asc');
      th.onclick = () => {
        if (teamSort.key === th.dataset.sort) teamSort.dir = teamSort.dir === 'asc' ? 'desc' : 'asc';
        else { teamSort.key = th.dataset.sort; teamSort.dir = 'desc'; }
        render();
      };
    });

    const h = Math.max(220, rows.length * 56 + 40) + 'px';
    $('#member-outreach-box').style.height = h;
    $('#member-close-box').style.height = h;
    const names = rows.map((r) => r.user.name);
    Charts.bar('chart-member-outreach', {
      horizontal: true, stacked: true, labels: names,
      datasets: [
        { label: 'Outreach', data: rows.map((r) => r.totals.outreach), slot: 1 },
        { label: 'Follow-ups', data: rows.map((r) => r.totals.followUps), slot: 2 }
      ]
    });
    Dashboard.legend($('#legend-member-outreach'), [{ label: 'Outreach', slot: 1 }, { label: 'Follow-ups', slot: 2 }]);
    Charts.bar('chart-member-close', {
      horizontal: true, format: 'pct', labels: names,
      datasets: [{ label: 'Close rate', data: rows.map((r) => (isFinite(r.rates.closeRate) ? r.rates.closeRate : 0)), slot: 1 }]
    });

    $('#btn-export-team').onclick = () => {
      const header = ['Member', 'Email', 'Outreach', 'Follow-ups', 'Replies', 'Reply rate', 'Calls booked', 'Calls attended', 'Show rate', 'Converted', 'Close rate', 'Paid', 'Revenue', 'Cash collected'];
      const r2 = (v) => (isFinite(v) ? (v * 100).toFixed(1) + '%' : '');
      const data = rows.map((r) => [r.user.name, r.user.email, r.totals.outreach, r.totals.followUps, r.totals.replies, r2(r.rates.replyRate), r.totals.callsBooked, r.totals.callsShown, r2(r.rates.showRate), r.totals.dealsClosed, r2(r.rates.closeRate), r.totals.paid, r.totals.revenue, r.totals.cashCollected]);
      Utils.download(`team-performance_${s.range.from}_to_${s.range.to}.csv`, Utils.toCSV([header, ...data]), 'text/csv');
    };
  }

  function renderActivity(s) {
    const opts = {
      tbody: $('#entries'),
      pager: $('#entries-pager'),
      entries: s.cur,
      showMember: true,
      canEdit: true,
      state: entriesState,
      onEdit: (entry) => Dashboard.openEntryModal({
        entry, members: Store.getMembers(), onSaved: () => Utils.toast('Entry updated.')
      }),
      onDelete: async (entry) => {
        const u = Store.getUser(entry.userId);
        if (await Utils.confirmDialog(`Delete ${u ? u.name + "'s" : 'this'} entry for ${Utils.formatDate(entry.date)}?`, { confirmText: 'Delete' })) {
          Store.deleteEntry(entry.id);
          Utils.toast('Entry deleted.');
        }
      }
    };
    Dashboard.bindSortHeaders($('#entries-table'), entriesState, () => Dashboard.renderEntriesTable(opts));
    Dashboard.renderEntriesTable(opts);
    $('#btn-export-entries').onclick = () =>
      Utils.download(`activity_${s.range.from}_to_${s.range.to}.csv`, Dashboard.entriesToCSV(s.cur), 'text/csv');
  }

  // ---------- Members ----------
  function renderMembers() {
    const all = Store.getEntries();
    const from = Utils.toISO(Utils.addDays(Utils.today(), -29));
    const members = Store.getMembers();
    $('#members').innerHTML = members.length
      ? members.map((m) => {
          const t = Metrics.totals(Metrics.filter(all, { from, userId: m.id }));
          return `<tr>
            <td><span class="member-cell"><span class="avatar">${esc(Utils.initials(m.name))}</span>${esc(m.name)}</span></td>
            <td>${esc(m.email)}</td>
            <td>${m.active ? '<span class="badge badge-good">● Active</span>' : '<span class="badge">○ Inactive</span>'}</td>
            <td class="num">${num(t.outreach)}</td>
            <td class="num">${money(t.revenue)}</td>
            <td>${m.lastLogin ? Utils.formatDate(m.lastLogin.slice(0, 10)) : '<span class="muted">Never</span>'}</td>
            <td><div class="table-actions">
              <button class="btn btn-sm" data-m-edit="${m.id}">Edit</button>
              <button class="btn btn-sm" data-m-pw="${m.id}">Reset password</button>
              <button class="btn btn-sm" data-m-toggle="${m.id}">${m.active ? 'Deactivate' : 'Activate'}</button>
              <button class="btn btn-sm btn-danger" data-m-del="${m.id}">Delete</button>
            </div></td>
          </tr>`;
        }).join('')
      : '<tr><td class="empty" colspan="7">No team members yet. Click “Add member” to create a login.</td></tr>';

    $$('[data-m-edit]').forEach((b) => (b.onclick = () => memberModal(Store.getUser(b.dataset.mEdit))));
    $$('[data-m-pw]').forEach((b) => (b.onclick = () => resetPasswordModal(Store.getUser(b.dataset.mPw))));
    $$('[data-m-toggle]').forEach((b) => (b.onclick = () => {
      const u = Store.getUser(b.dataset.mToggle);
      Store.updateUser(u.id, { active: !u.active });
      Utils.toast(`${u.name} ${u.active ? 'activated' : 'deactivated'}.`);
    }));
    $$('[data-m-del]').forEach((b) => (b.onclick = async () => {
      const u = Store.getUser(b.dataset.mDel);
      const ok = await Utils.confirmDialog(
        `Delete ${u.name} and ALL of their logged activity? This cannot be undone. (Tip: Deactivate keeps their history.)`,
        { title: 'Delete member?', confirmText: 'Delete member' }
      );
      if (ok) { Store.deleteUser(u.id); Utils.toast('Member deleted.'); }
    }));
  }

  function memberModal(user) {
    const editing = !!user;
    const t = (user && user.targets) || {};
    const defaults = Metrics.memberTargets(null);
    const m = Utils.modal({
      title: editing ? `Edit ${user.name}` : 'Add team member',
      subtitle: editing ? 'Update details and personal monthly targets.' : 'They will sign in on the Team login page with this email and password.',
      body: `
        <form class="form-grid" novalidate>
          <div class="field"><label for="m-name">Full name</label><input id="m-name" class="input" value="${esc(user ? user.name : '')}" required></div>
          <div class="field"><label for="m-email">Email</label><input id="m-email" class="input" type="email" value="${esc(user ? user.email : '')}" required></div>
          ${editing ? '' : `<div class="field span-all"><label for="m-pw">Temporary password</label><input id="m-pw" class="input" type="text" autocomplete="off" placeholder="At least 8 characters"><span class="hint">Share it with them privately - they can change it after signing in.</span></div>`}
          <div class="span-all small muted" style="margin-top:4px">Personal monthly targets <span class="muted">(leave blank to use an equal share of team targets)</span></div>
          <div class="field"><label for="m-t-outreach">Outreach</label><input id="m-t-outreach" class="input" type="number" min="0" value="${t.outreach || ''}" placeholder="${defaults.outreach}"></div>
          <div class="field"><label for="m-t-callsBooked">Calls booked</label><input id="m-t-callsBooked" class="input" type="number" min="0" value="${t.callsBooked || ''}" placeholder="${defaults.callsBooked}"></div>
          <div class="field"><label for="m-t-dealsClosed">Deals converted</label><input id="m-t-dealsClosed" class="input" type="number" min="0" value="${t.dealsClosed || ''}" placeholder="${defaults.dealsClosed}"></div>
          <div class="field"><label for="m-t-revenue">Revenue</label><input id="m-t-revenue" class="input" type="number" min="0" value="${t.revenue || ''}" placeholder="${defaults.revenue}"></div>
          <div class="form-error span-all" hidden></div>
          <div class="form-actions span-all">
            <button type="button" class="btn" data-act="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${editing ? 'Save changes' : 'Create member'}</button>
          </div>
        </form>`
    });
    const r = m.root;
    $('[data-act="cancel"]', r).onclick = m.close;
    $('form', r).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', r);
      err.hidden = true;
      const targets = {};
      ['outreach', 'callsBooked', 'dealsClosed', 'revenue'].forEach((k) => {
        const v = Number($(`#m-t-${k}`, r).value);
        if (v > 0) targets[k] = v;
      });
      try {
        const name = $('#m-name', r).value.trim();
        const email = $('#m-email', r).value.trim();
        if (editing) {
          if (!name) throw new Error('Name is required.');
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
          Store.updateUser(user.id, { name, email, targets: Object.keys(targets).length ? targets : null });
          Utils.toast('Member updated.');
        } else {
          const u = await Store.addUser({ name, email, password: $('#m-pw', r).value, role: 'member' });
          if (Object.keys(targets).length) Store.updateUser(u.id, { targets });
          Utils.toast(`${u.name} added. They can now sign in on the Team login.`);
        }
        m.close();
      } catch (x) {
        err.textContent = x.message;
        err.hidden = false;
      }
    });
  }

  function resetPasswordModal(user) {
    const m = Utils.modal({
      title: `Reset password for ${user.name}`,
      subtitle: 'Set a new temporary password and share it with them privately.',
      body: `
        <form novalidate style="display:grid; gap:14px">
          <div class="field"><label for="rp-pw">New password</label><input id="rp-pw" class="input" type="text" autocomplete="off" placeholder="At least 8 characters"></div>
          <div class="form-error" hidden></div>
          <div class="form-actions">
            <button type="button" class="btn" data-act="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Reset password</button>
          </div>
        </form>`
    });
    const r = m.root;
    $('[data-act="cancel"]', r).onclick = m.close;
    $('form', r).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await Store.setPassword(user.id, $('#rp-pw', r).value);
        Utils.toast('Password reset.');
        m.close();
      } catch (x) {
        $('.form-error', r).textContent = x.message;
        $('.form-error', r).hidden = false;
      }
    });
  }

  $('#btn-add-member').addEventListener('click', () => memberModal(null));

  // ---------- Settings ----------
  function renderSettings() {
    const st = Store.getSettings();
    ['outreach', 'callsBooked', 'dealsClosed', 'revenue'].forEach((k) => { $(`#t-${k}`).value = st.targets[k]; });
    $('#s-currency').value = st.currency;
    $('#s-locale').value = st.locale;
    $('#s-leaderboard').checked = !!st.showLeaderboardToTeam;
    const u = Store.getUser(me.id);
    $('#a-name').value = u.name;
    $('#a-email').value = u.email;
  }

  $('#targets-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const targets = {};
    ['outreach', 'callsBooked', 'dealsClosed', 'revenue'].forEach((k) => { targets[k] = Math.max(0, Number($(`#t-${k}`).value) || 0); });
    Store.updateSettings({ targets });
    Utils.toast('Targets saved.');
  });

  $('#prefs-form').addEventListener('submit', (e) => {
    e.preventDefault();
    Store.updateSettings({
      currency: $('#s-currency').value,
      locale: $('#s-locale').value,
      showLeaderboardToTeam: $('#s-leaderboard').checked
    });
    Utils.toast('Preferences saved.');
  });

  $('#account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#account-error');
    err.hidden = true;
    try {
      const u = Store.getUser(me.id);
      const name = $('#a-name').value.trim();
      const email = $('#a-email').value.trim();
      const newPw = $('#a-new').value;
      if (!name) throw new Error('Name is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
      if (newPw || email.toLowerCase() !== u.email) {
        if (!(await Auth.verifyPassword($('#a-current').value, u.passwordHash))) {
          throw new Error('Enter your current password to change your email or password.');
        }
      }
      if (newPw) await Store.setPassword(u.id, newPw);
      Store.updateUser(u.id, { name, email });
      $('#a-current').value = '';
      $('#a-new').value = '';
      Dashboard.fillUserChip(Store.getUser(me.id));
      Utils.toast('Account updated.');
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
    }
  });

  $('#btn-backup').addEventListener('click', () => {
    Utils.download(`worthyops-backup_${Utils.toISO(Utils.today())}.json`, Store.exportData(), 'application/json');
  });

  $('#restore-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!(await Utils.confirmDialog('Restoring replaces ALL current accounts and activity with the backup. Continue?', { confirmText: 'Restore' }))) return;
    try {
      Store.importData(await file.text());
      Utils.toast('Backup restored.');
      if (!Store.getUser(me.id)) Auth.logout();
    } catch (x) {
      Utils.toast(x.message || 'Could not read that file.', 'error');
    }
  });

  $('#btn-clear').addEventListener('click', async () => {
    if (await Utils.confirmDialog('Delete every logged activity entry for every member? Accounts are kept. Download a backup first if you might need it.', { confirmText: 'Clear activity' })) {
      try {
        Store.clearEntries();
        Utils.toast('All activity cleared.');
      } catch (x) { Utils.toast(x.message, 'error'); }
    }
  });

  $('#btn-clear-leads').addEventListener('click', async () => {
    if (await Utils.confirmDialog('Delete every lead in the lead list? Download a backup or export the leads first if you might need them.', { confirmText: 'Clear leads' })) {
      try {
        Store.clearLeads();
        Utils.toast('All leads cleared.');
      } catch (x) { Utils.toast(x.message, 'error'); }
    }
  });

  $('#btn-factory').addEventListener('click', async () => {
    if (await Utils.confirmDialog('Wipe ALL accounts, activity and settings and start fresh with the default accounts from js/config.js?', { title: 'Factory reset?', confirmText: 'Reset everything' })) {
      Store.resetAll();
      Auth.logout();
    }
  });

  // ---------- Google Sheet sync ----------
  function paintSheetState(st) {
    const badge = $('#gs-state');
    if (!badge) return;
    const map = {
      off: ['Not connected', ''],
      syncing: ['Syncing…', 'badge-accent'],
      ok: [`Connected · ${st.counts ? `${st.counts.leads} leads, ${st.counts.content} content, ${st.counts.daily} days` : 'synced'}`, 'badge-good'],
      error: ['Error', 'badge-bad']
    };
    const [text, cls] = map[st.state] || map.off;
    badge.textContent = text;
    badge.className = 'badge ' + cls;
    const err = $('#gs-error');
    err.hidden = st.state !== 'error';
    err.textContent = st.error || '';
  }
  Sheets.onStatus(paintSheetState);
  const gsCfg = Sheets.config();
  $('#gs-url').value = gsCfg.url;
  $('#gs-key').value = gsCfg.key;

  $('#gs-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#gs-url').value.trim();
    const key = $('#gs-key').value.trim();
    const err = $('#gs-error');
    err.hidden = true;
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) {
      err.textContent = 'Paste the web app URL from Apps Script (starts with https://script.google.com/).';
      err.hidden = false;
      return;
    }
    try {
      const counts = await Sheets.test(url, key);
      if (!(await Utils.confirmDialog(`Found ${counts.leads} leads, ${counts.content} content pieces and ${counts.daily} activity rows in the sheet. Connect? The dashboard's current leads, content and activity will be replaced by the sheet's data.`, { title: 'Connect Google Sheet?', confirmText: 'Connect' }))) return;
      Sheets.saveConfig({ url, key });
      await Sheets.start();
      Utils.toast('Google Sheet connected.');
    } catch (x) {
      err.textContent = 'Could not connect: ' + x.message;
      err.hidden = false;
    }
  });
  $('#gs-sync').addEventListener('click', () => Sheets.pull());
  $('#gs-disconnect').addEventListener('click', () => {
    Sheets.stop();
    Sheets.clearConfig();
    $('#gs-url').value = '';
    $('#gs-key').value = '';
    Utils.toast('Disconnected. Data now stays in this browser only.');
  });

  // ---------- Boot ----------
  Sheets.mountStatus($('#sync-chip'));
  Sheets.start();
  Store.subscribe(render);
  document.addEventListener('themechange', render);
  Dashboard.router(Object.keys(VIEWS), (id) => { state.view = id; render(); });
})();
