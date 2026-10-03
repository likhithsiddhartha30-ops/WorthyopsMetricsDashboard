/* ==========================================================================
   Team member dashboard page
   ========================================================================== */

(async function () {
  const { $, $$, num, money } = Utils;

  Utils.bindThemeToggles();
  Utils.bindSidebar();
  await Store.init();
  const me = Auth.requireRole('member');
  if (!me) return;
  Dashboard.fillUserChip(me);

  const PREF_KEY = 'worthyops_team_filters';
  const state = { view: 'overview', range: '30d' };
  try { Object.assign(state, JSON.parse(localStorage.getItem(PREF_KEY)) || {}); } catch (e) { /* ignore */ }
  const entriesState = { sortKey: 'date', sortDir: 'desc', page: 0 };
  let editingEntry = null; // entry being edited in the Log view

  const VIEWS = {
    overview: { title: 'My dashboard', filters: true },
    log: { title: 'Log activity', filters: false },
    leads: { title: 'My leads', filters: false },
    entries: { title: 'My entries', filters: true },
    account: { title: 'Account', filters: false }
  };

  Dashboard.bindRange($('#f-range'), state.range, (v) => {
    state.range = v;
    entriesState.page = 0;
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ range: state.range })); } catch (x) { /* ignore */ }
    render();
  });
  const leadsView = Leads.mount({ root: $('#leads-root'), me, isAdmin: false });
  const myLeads = () => Store.getLeads().filter((l) => l.ownerId === me.id);

  function scope() {
    const mine = Metrics.filter(Store.getEntries(), { userId: me.id });
    const range = Utils.resolveRange(state.range, Metrics.earliestDate(mine));
    return {
      range,
      mine,
      cur: Metrics.filter(mine, { from: range.from, to: range.to }),
      prev: Metrics.filter(mine, { from: range.prevFrom, to: range.prevTo })
    };
  }

  function render() {
    // Admin may have deactivated/deleted this account in another tab
    const fresh = Store.getUser(me.id);
    if (!fresh || !fresh.active) { Auth.logout(); return; }

    const v = VIEWS[state.view];
    $('#page-title').textContent = v.title;
    $('#f-range').style.display = v.filters ? '' : 'none';
    const s = scope();
    $('#page-sub').textContent = v.filters
      ? `${s.range.label} · ${Utils.formatDate(s.range.from)} – ${Utils.formatDate(s.range.to)}`
      : state.view === 'leads' ? 'Your prospects, from first message to paid' : '';

    const due = Leads.summarize(myLeads()).due;
    const badge = $('#nav-leads-count');
    badge.textContent = due ? due : '';
    badge.hidden = !due;
    badge.classList.toggle('alert', due > 0);
    badge.title = `${due} follow-ups due`;

    ({ overview: renderOverview, log: renderLog, leads: () => leadsView.render(), entries: renderEntries, account: renderAccount })[state.view](s);
  }

  function renderOverview(s) {
    const cur = Metrics.totals(s.cur);
    const prev = Metrics.totals(s.prev);
    const ls = Leads.summarize(myLeads());
    const progress = Metrics.monthProgress(s.mine, Metrics.memberTargets(Store.getUser(me.id)));
    const rev = progress.find((p) => p.key === 'revenue');

    Dashboard.renderHero($('#hero'), {
      eyebrow: s.range.label,
      title: `${Dashboard.greeting()}, ${me.name.split(' ')[0]}`,
      text: `You've sent <strong>${num(cur.outreach)}</strong> messages, booked <strong>${num(cur.callsBooked)}</strong> calls and converted <strong>${num(cur.dealsClosed)}</strong> clients. You're at <strong>${Utils.pct(rev ? rev.ratio : 0, 0)}</strong> of this month's revenue target.`,
      stats: [
        { label: 'Revenue closed', value: money(cur.revenue) },
        { label: 'Open pipeline', value: money(ls.pipeline) },
        { label: 'My leads', value: num(ls.total) }
      ]
    });

    const todayEntry = Store.findEntry(me.id, Utils.toISO(Utils.today()));
    const note = $('#today-note');
    note.hidden = !!todayEntry;
    note.innerHTML = '<span class="dot"></span><span>You haven\'t logged today\'s activity yet.</span><span class="spacer"></span><a href="#log">Log it now →</a>';
    const dueNote = $('#due-note');
    dueNote.hidden = !ls.due;
    dueNote.innerHTML = `<span class="dot"></span><span><strong>${num(ls.due)}</strong> lead follow-up${ls.due === 1 ? ' is' : 's are'} due${ls.overdue ? ` (${num(ls.overdue)} overdue)` : ''}.</span><span class="spacer"></span><a href="#leads">View leads →</a>`;

    const points = Metrics.timeSeries(s.cur, s.range.from, s.range.to).points;
    Dashboard.renderKpis($('#kpis'), cur, prev, points);
    Dashboard.renderRates($('#rates'), cur, prev);
    Dashboard.renderFunnel($('#funnel'), cur);
    Dashboard.renderTrendCharts(s.cur, s.range);
    Dashboard.renderCollections(cur);
    Dashboard.renderTargets($('#targets'), progress);

    const showBoard = Store.getSettings().showLeaderboardToTeam;
    $('#leaderboard-card').hidden = !showBoard;
    if (showBoard) {
      const all = Metrics.filter(Store.getEntries(), { from: s.range.from, to: s.range.to });
      const rows = Metrics.byMember(all, Store.getMembers().filter((m) => m.active));
      Dashboard.renderLeaderboard($('#leaderboard'), rows, { compact: true, highlightId: me.id });
    }
  }

  function renderLog() {
    Dashboard.entryForm($('#log-form'), {
      userId: me.id,
      entry: editingEntry || Store.findEntry(me.id, Utils.toISO(Utils.today())) || undefined,
      submitText: 'Save activity',
      onSaved: (saved) => {
        editingEntry = saved;
        renderLog();
        Utils.toast(`Saved activity for ${Utils.formatDate(saved.date)}.`);
      }
    });

    const from = Utils.toISO(Utils.addDays(Utils.today(), -6));
    const recent = Metrics.filter(Store.getEntries(), { userId: me.id, from })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    $('#recent').innerHTML = recent.length
      ? recent.map((e) => `
          <tr data-id="${e.id}" style="cursor:pointer" title="Edit this day">
            <td>${Utils.formatDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
            <td class="num">${num(e.outreach)}</td>
            <td class="num">${num(e.replies)}</td>
            <td class="num">${num(e.callsBooked)}</td>
            <td class="num">${num(e.dealsClosed)}</td>
            <td class="num">${money(e.revenue)}</td>
          </tr>`).join('')
      : '<tr><td class="empty" colspan="6">Nothing logged in the last 7 days.</td></tr>';
    $$('#recent tr[data-id]').forEach((tr) => (tr.onclick = () => {
      editingEntry = Store.getEntry(tr.dataset.id);
      renderLog();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  function renderEntries(s) {
    const opts = {
      tbody: $('#entries'),
      pager: $('#entries-pager'),
      entries: s.cur,
      showMember: false,
      canEdit: true,
      state: entriesState,
      onEdit: (entry) => Dashboard.openEntryModal({ entry, userId: me.id, onSaved: () => Utils.toast('Entry updated.') }),
      onDelete: async (entry) => {
        if (await Utils.confirmDialog(`Delete your entry for ${Utils.formatDate(entry.date)}?`, { confirmText: 'Delete' })) {
          Store.deleteEntry(entry.id);
          Utils.toast('Entry deleted.');
        }
      }
    };
    Dashboard.bindSortHeaders($('#entries-table'), entriesState, () => Dashboard.renderEntriesTable(opts));
    Dashboard.renderEntriesTable(opts);
    $('#btn-export').onclick = () =>
      Utils.download(`my-activity_${s.range.from}_to_${s.range.to}.csv`, Dashboard.entriesToCSV(s.cur), 'text/csv');
  }

  function renderAccount() {
    $('#acct-email').textContent = Store.getUser(me.id).email;
  }

  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#pw-error');
    err.hidden = true;
    try {
      const u = Store.getUser(me.id);
      if (!(await Auth.verifyPassword($('#pw-current').value, u.passwordHash))) throw new Error('Current password is incorrect.');
      if ($('#pw-new').value !== $('#pw-confirm').value) throw new Error('New passwords do not match.');
      await Store.setPassword(u.id, $('#pw-new').value);
      e.target.reset();
      Utils.toast('Password updated.');
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
    }
  });

  // Re-render on data changes, except while typing in the log form
  Store.subscribe(() => { if (state.view !== 'log' || !document.activeElement.closest('#log-form')) render(); });
  document.addEventListener('themechange', render);
  Dashboard.router(Object.keys(VIEWS), (id) => { state.view = id; if (id !== 'log') editingEntry = null; render(); });
})();
