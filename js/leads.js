/* ==========================================================================
   Leads: the client / lead list. Table view, drag-and-drop pipeline board,
   add/edit, follow-up logging, CSV import/export.
   Shared by admin.html (all leads) and team.html (own leads only).
   The field names here are what we'll map Google Sheet columns onto.
   ========================================================================== */

const Leads = (() => {
  const { $, $$, escapeHtml: esc, num, money, pct } = Utils;

  const STAGES = APP_CONFIG.leadStages;
  const ORDER = STAGES.map((s) => s.key);
  const OPEN = ['contacted', 'replied', 'booked', 'attended'];
  const STAGE_COLOR = {
    new: 'var(--axis)',
    contacted: 'var(--ramp-1)',
    replied: 'var(--ramp-3)',
    booked: 'var(--ramp-4)',
    attended: 'var(--ramp-6)',
    won: 'var(--series-3)',
    paid: 'var(--good)',
    lost: 'var(--bad)'
  };
  const stageLabel = (k) => (STAGES.find((s) => s.key === k) || {}).label || k;
  const todayISO = () => Utils.toISO(Utils.today());

  /** Has this lead ever reached `stage`? (uses recorded stage dates + current stage) */
  function reached(lead, stage) {
    if (lead.stageDates && lead.stageDates[stage]) return true;
    if (lead.stage === 'lost') return false;
    return ORDER.indexOf(lead.stage) >= ORDER.indexOf(stage);
  }

  function followUpState(lead) {
    if (!lead.nextFollowUpAt || !OPEN.includes(lead.stage)) return '';
    const t = todayISO();
    if (lead.nextFollowUpAt < t) return 'overdue';
    if (lead.nextFollowUpAt === t) return 'today';
    return 'upcoming';
  }

  /** Summary numbers for a set of leads. */
  function summarize(leads) {
    const contacted = leads.filter((l) => reached(l, 'contacted')).length;
    const replied = leads.filter((l) => reached(l, 'replied')).length;
    const booked = leads.filter((l) => reached(l, 'booked')).length;
    const won = leads.filter((l) => reached(l, 'won')).length;
    const pipeline = leads.filter((l) => l.stage === 'booked' || l.stage === 'attended').reduce((s, l) => s + (l.dealValue || 0), 0);
    const wonValue = leads.filter((l) => l.stage === 'won' || l.stage === 'paid').reduce((s, l) => s + (l.dealValue || 0), 0);
    const due = leads.filter((l) => ['overdue', 'today'].includes(followUpState(l))).length;
    const overdue = leads.filter((l) => followUpState(l) === 'overdue').length;
    return {
      total: leads.length, contacted, replied, booked, won, pipeline, wonValue, due, overdue,
      replyRate: contacted ? replied / contacted : NaN,
      bookRate: replied ? booked / replied : NaN,
      winRate: booked ? won / booked : NaN
    };
  }

  function stagePill(stage) {
    return `<span class="stage-pill"><i style="background:${STAGE_COLOR[stage]}"></i>${esc(stageLabel(stage))}</span>`;
  }

  function dueHtml(lead) {
    if (!lead.nextFollowUpAt) return '<span class="muted">—</span>';
    const st = followUpState(lead);
    const label = Utils.formatDate(lead.nextFollowUpAt, { month: 'short', day: 'numeric' });
    if (st === 'overdue') return `<span class="due overdue">⚠ ${label}</span>`;
    if (st === 'today') return '<span class="due today">● Today</span>';
    return `<span class="due">${label}</span>`;
  }

  // ---------- Origin (outbound / organic / paid) ----------
  const ORIGIN_SLOT = { outbound: 1, paid: 2, organic: 3 };
  const ORIGIN_SHORT = { outbound: 'Outbound', organic: 'Organic', paid: 'Paid ads' };
  const originOf = (l) => l.origin || 'outbound';

  function originPill(l) {
    const o = originOf(l);
    return `<span class="stage-pill"><i style="background:var(--series-${ORIGIN_SLOT[o]})"></i>${ORIGIN_SHORT[o]}</span>`;
  }

  /** <option>s for picking a piece of content, grouped organic / paid. */
  function contentOptions(selectedId) {
    const list = Store.getContents().sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
    const group = (ch, label) => {
      const items = list.filter((c) => c.channel === ch);
      return items.length
        ? `<optgroup label="${label}">${items.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.title)} · ${esc(c.platform || '')}</option>`).join('')}</optgroup>`
        : '';
    };
    return `<option value="">Not linked to a specific post / ad</option>${group('organic', 'Organic content')}${group('paid', 'Paid ads')}`;
  }

  // ---------- Lead form (shared by Leads and Content pages) ----------
  /** ctx: { me, isAdmin, prefill } */
  function openLeadForm(lead, ctx) {
    const { me, isAdmin } = ctx;
    const l = lead || Object.assign({ stage: 'new', ownerId: isAdmin ? null : me.id, source: '', origin: 'outbound' }, ctx.prefill || {});
    const members = Store.getMembers();
    const sourceOpts = APP_CONFIG.leadSources.includes(l.source) || !l.source
      ? APP_CONFIG.leadSources
      : [l.source, ...APP_CONFIG.leadSources];
    const m = Utils.modal({
      title: lead ? 'Edit lead' : 'Add lead',
      subtitle: lead ? `Added ${Utils.formatDate((lead.createdAt || '').slice(0, 10) || todayISO())}` : 'Add a prospect to the lead list.',
      body: `
        <form class="form-grid" novalidate>
          <div class="form-section-title">Contact</div>
          <div class="field"><label for="lf-name">Name *</label><input id="lf-name" class="input" value="${esc(l.name || '')}" required></div>
          <div class="field"><label for="lf-business">Business / brand</label><input id="lf-business" class="input" value="${esc(l.business || '')}"></div>
          <div class="field"><label for="lf-handle">Handle / profile link</label><input id="lf-handle" class="input" value="${esc(l.handle || '')}" placeholder="@handle or URL"></div>
          <div class="field"><label for="lf-email">Email</label><input id="lf-email" class="input" type="email" value="${esc(l.email || '')}"></div>
          <div class="field"><label for="lf-phone">Phone</label><input id="lf-phone" class="input" value="${esc(l.phone || '')}"></div>
          <div class="field"><label for="lf-niche">Niche</label><input id="lf-niche" class="input" value="${esc(l.niche || '')}" placeholder="e.g. Fitness"></div>

          <div class="form-section-title">Where did this lead come from?</div>
          <div class="field"><label for="lf-origin">Lead type</label>
            <select id="lf-origin" class="select">${APP_CONFIG.leadOrigins.map((o) => `<option value="${o.key}" ${o.key === originOf(l) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
          </div>
          <div class="field"><label for="lf-content">Content / ad</label>
            <select id="lf-content" class="select">${contentOptions(l.contentId)}</select>
            <span class="hint">For inbound leads - which post or ad brought them in.</span>
          </div>
          <div class="field"><label for="lf-source">Platform</label>
            <select id="lf-source" class="select"><option value="">—</option>${sourceOpts.map((s) => `<option ${s === l.source ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          </div>

          <div class="form-section-title">Pipeline</div>
          ${isAdmin ? `<div class="field"><label for="lf-owner">Owner</label>
            <select id="lf-owner" class="select"><option value="">Unassigned</option>${members.map((u) => `<option value="${u.id}" ${u.id === l.ownerId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
          </div>` : ''}
          <div class="field"><label for="lf-stage">Stage</label>
            <select id="lf-stage" class="select">${STAGES.map((s) => `<option value="${s.key}" ${s.key === l.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
          </div>
          <div class="field"><label for="lf-deal">Deal value (${esc(Store.getSettings().currency)})</label><input id="lf-deal" class="input" type="number" min="0" step="0.01" value="${l.dealValue || ''}" placeholder="0"></div>
          <div class="field"><label for="lf-paid">Amount paid</label><input id="lf-paid" class="input" type="number" min="0" step="0.01" value="${l.amountPaid || ''}" placeholder="0"></div>
          <div class="field"><label for="lf-fu">Follow-ups sent</label><input id="lf-fu" class="input" type="number" min="0" step="1" value="${l.followUps || ''}" placeholder="0"></div>
          <div class="field"><label for="lf-last">Last contact</label><input id="lf-last" class="input" type="date" value="${esc(l.lastContactAt || '')}"></div>
          <div class="field"><label for="lf-next">Next follow-up</label><input id="lf-next" class="input" type="date" value="${esc(l.nextFollowUpAt || '')}"></div>
          <div class="field span-all"><label for="lf-notes">Notes</label><textarea id="lf-notes" class="input" maxlength="1000" placeholder="Context, objections, what they need…">${esc(l.notes || '')}</textarea></div>
          <div class="form-error span-all" hidden></div>
          <div class="form-actions span-all">
            <button type="button" class="btn" data-act="cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">${lead ? 'Save lead' : 'Add lead'}</button>
          </div>
        </form>`
    });
    m.root.querySelector('.modal').style.width = 'min(720px, 100%)';
    const r = m.root;

    // Picking a post/ad sets the lead type to match; outbound clears the link
    const originSel = $('#lf-origin', r);
    const contentSel = $('#lf-content', r);
    contentSel.addEventListener('change', () => {
      const c = Store.getContent(contentSel.value);
      if (c) {
        originSel.value = c.channel;
        const src = $('#lf-source', r);
        if (!src.value && APP_CONFIG.leadSources.includes(c.platform)) src.value = c.platform;
      }
    });
    originSel.addEventListener('change', () => {
      const c = Store.getContent(contentSel.value);
      if (c && c.channel !== originSel.value) contentSel.value = '';
    });

    $('[data-act="cancel"]', r).onclick = m.close;
    $('form', r).addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        Store.saveLead({
          id: lead ? lead.id : undefined,
          name: $('#lf-name', r).value,
          business: $('#lf-business', r).value,
          handle: $('#lf-handle', r).value,
          email: $('#lf-email', r).value,
          phone: $('#lf-phone', r).value,
          niche: $('#lf-niche', r).value,
          origin: originSel.value,
          contentId: contentSel.value || null,
          source: $('#lf-source', r).value,
          ownerId: isAdmin ? $('#lf-owner', r).value || null : me.id,
          stage: $('#lf-stage', r).value,
          dealValue: $('#lf-deal', r).value,
          amountPaid: $('#lf-paid', r).value,
          followUps: $('#lf-fu', r).value,
          lastContactAt: $('#lf-last', r).value,
          nextFollowUpAt: $('#lf-next', r).value,
          notes: $('#lf-notes', r).value
        });
        m.close();
        Utils.toast(lead ? 'Lead saved.' : 'Lead added.');
      } catch (x) {
        const err = $('.form-error', r);
        err.textContent = x.message;
        err.hidden = false;
      }
    });
  }

  // ======================================================================
  // Mount: builds the whole Leads view inside `root`.
  // opts: { root, me, isAdmin }
  // ======================================================================
  function mount({ root, me, isAdmin }) {
    const PREF = 'worthyops_leads_view';
    const state = { q: '', stage: 'all', origin: 'all', source: 'all', owner: 'all', mode: 'table', sortKey: 'updatedAt', sortDir: 'desc', page: 0 };
    try { state.mode = localStorage.getItem(PREF) || 'table'; } catch (e) { /* ignore */ }

    root.innerHTML = `
      <div class="card" style="padding:0">
        <div class="stat-strip" id="ld-stats"></div>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input class="input" id="ld-q" type="search" placeholder="Search name, business, handle, email…" aria-label="Search leads">
          </div>
          <select class="select" id="ld-stage" aria-label="Filter by stage">
            <option value="all">All stages</option>
            <option value="open">Open (in progress)</option>
            <option value="due">Follow-up due</option>
            ${STAGES.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}
          </select>
          <select class="select" id="ld-origin" aria-label="Filter by lead type">
            <option value="all">All lead types</option>
            <option value="inbound">Inbound (all)</option>
            ${APP_CONFIG.leadOrigins.map((o) => `<option value="${o.key}">${esc(o.label)}</option>`).join('')}
          </select>
          <select class="select" id="ld-source" aria-label="Filter by platform">
            <option value="all">All platforms</option>
            ${APP_CONFIG.leadSources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
          </select>
          ${isAdmin ? '<select class="select" id="ld-owner" aria-label="Filter by owner"></select>' : ''}
          <span class="spacer"></span>
          <div class="seg" role="tablist" aria-label="View mode">
            <button type="button" data-mode="table">Table</button>
            <button type="button" data-mode="board">Pipeline</button>
          </div>
          <label class="btn btn-sm" for="ld-file" title="Import leads from a CSV (e.g. exported from Google Sheets)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Import
          </label>
          <input type="file" id="ld-file" accept=".csv,text/csv" hidden>
          <button class="btn btn-sm" id="ld-export" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></svg>Export
          </button>
          <button class="btn btn-primary btn-sm" id="ld-add" type="button">+ Add lead</button>
        </div>
        <div id="ld-body"></div>
        <div class="row" id="ld-pager" style="margin-top:14px"></div>
      </div>`;

    // ----- Filters -----
    const ownerSel = $('#ld-owner', root);
    function fillOwners() {
      if (!ownerSel) return;
      const members = Store.getMembers();
      ownerSel.innerHTML = '<option value="all">All owners</option><option value="none">Unassigned</option>' +
        members.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
      if (state.owner !== 'all' && state.owner !== 'none' && !members.some((m) => m.id === state.owner)) state.owner = 'all';
      ownerSel.value = state.owner;
    }

    $('#ld-q', root).addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); state.page = 0; render(); });
    $('#ld-stage', root).addEventListener('change', (e) => { state.stage = e.target.value; state.page = 0; render(); });
    $('#ld-origin', root).addEventListener('change', (e) => { state.origin = e.target.value; state.page = 0; render(); });
    $('#ld-source', root).addEventListener('change', (e) => { state.source = e.target.value; state.page = 0; render(); });
    if (ownerSel) ownerSel.addEventListener('change', (e) => { state.owner = e.target.value; state.page = 0; render(); });
    $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      try { localStorage.setItem(PREF, state.mode); } catch (e) { /* ignore */ }
      render();
    }));
    $('#ld-add', root).addEventListener('click', () => openLeadModal(null));
    $('#ld-export', root).addEventListener('click', () => exportCSV(filtered()));
    $('#ld-file', root).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) openImport(await file.text());
    });

    function scopeLeads() {
      const all = Store.getLeads();
      return isAdmin ? all : all.filter((l) => l.ownerId === me.id);
    }

    function filtered() {
      return scopeLeads().filter((l) => {
        if (state.stage === 'open' && !OPEN.includes(l.stage)) return false;
        if (state.stage === 'due' && !['overdue', 'today'].includes(followUpState(l))) return false;
        if (!['all', 'open', 'due'].includes(state.stage) && l.stage !== state.stage) return false;
        if (state.origin === 'inbound' && originOf(l) === 'outbound') return false;
        if (!['all', 'inbound'].includes(state.origin) && originOf(l) !== state.origin) return false;
        if (state.source !== 'all' && l.source !== state.source) return false;
        if (isAdmin && state.owner === 'none' && l.ownerId) return false;
        if (isAdmin && !['all', 'none'].includes(state.owner) && l.ownerId !== state.owner) return false;
        if (state.q) {
          const hay = [l.name, l.business, l.handle, l.email, l.phone, l.niche, l.notes].join(' ').toLowerCase();
          if (!hay.includes(state.q)) return false;
        }
        return true;
      });
    }

    // ----- Render -----
    function render() {
      fillOwners();
      $$('[data-mode]', root).forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
      renderStats(scopeLeads());
      const list = filtered();
      if (state.mode === 'board') renderBoard(list);
      else renderTable(list);
    }

    function renderStats(leads) {
      const s = summarize(leads);
      $('#ld-stats', root).innerHTML = `
        <div><div class="l">Total leads</div><div class="v">${num(s.total)}</div><div class="s">${num(s.contacted)} contacted</div></div>
        <div><div class="l">Reply rate</div><div class="v">${pct(s.replyRate)}</div><div class="s">${num(s.replied)} replied</div></div>
        <div><div class="l">Calls booked</div><div class="v">${num(s.booked)}</div><div class="s">${pct(s.bookRate)} of replies</div></div>
        <div><div class="l">Converted</div><div class="v">${num(s.won)}</div><div class="s">${pct(s.winRate)} of booked · ${money(s.wonValue)}</div></div>
        <div><div class="l">Open pipeline</div><div class="v">${money(s.pipeline)}</div><div class="s">Booked + attended deal value</div></div>
        <div><div class="l">Follow-ups due</div><div class="v" style="${s.overdue ? 'color:var(--bad)' : ''}">${num(s.due)}</div><div class="s">${num(s.overdue)} overdue</div></div>`;
    }

    function renderTable(list) {
      const dir = state.sortDir === 'asc' ? 1 : -1;
      const key = state.sortKey;
      const val = (l) => {
        if (key === 'stage') return ORDER.indexOf(l.stage);
        if (key === 'owner') return (Store.getUser(l.ownerId) || {}).name || '';
        if (key === 'nextFollowUpAt') return l.nextFollowUpAt || '9999';
        return l[key] ?? '';
      };
      list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * dir);

      const pageSize = 25;
      const pages = Math.max(1, Math.ceil(list.length / pageSize));
      state.page = Math.min(state.page, pages - 1);
      const slice = list.slice(state.page * pageSize, (state.page + 1) * pageSize);

      const th = (k, label, cls = '') => `<th class="${cls}" data-sort="${k}">${label}</th>`;
      $('#ld-body', root).innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              ${th('name', 'Lead')}
              <th>Contact</th>
              ${th('origin', 'Came from')}
              ${isAdmin ? th('owner', 'Owner') : ''}
              ${th('stage', 'Stage')}
              ${th('dealValue', 'Deal value', 'num')}
              ${th('followUps', 'Follow-ups', 'num')}
              ${th('lastContactAt', 'Last contact')}
              ${th('nextFollowUpAt', 'Next follow-up')}
              <th></th>
            </tr></thead>
            <tbody>
              ${slice.length ? slice.map(rowHtml).join('') : `<tr><td class="empty" colspan="${isAdmin ? 10 : 9}">${scopeLeads().length ? 'No leads match these filters.' : 'No leads yet. Add one, or import a CSV from your Google Sheet.'}</td></tr>`}
            </tbody>
          </table>
        </div>`;

      $$('th[data-sort]', root).forEach((h) => {
        h.classList.add('sortable');
        h.classList.toggle('sorted', h.dataset.sort === state.sortKey);
        h.classList.toggle('asc', h.dataset.sort === state.sortKey && state.sortDir === 'asc');
        h.onclick = () => {
          if (state.sortKey === h.dataset.sort) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          else { state.sortKey = h.dataset.sort; state.sortDir = h.dataset.sort === 'name' ? 'asc' : 'desc'; }
          render();
        };
      });
      $$('select[data-stage-for]', root).forEach((s) => s.addEventListener('change', () => {
        Store.setLeadStage(s.dataset.stageFor, s.value);
        Utils.toast(`Moved to ${stageLabel(s.value)}.`);
      }));
      $$('[data-fu]', root).forEach((b) => (b.onclick = () => followUpModal(Store.getLead(b.dataset.fu))));
      $$('[data-edit]', root).forEach((b) => (b.onclick = () => openLeadModal(Store.getLead(b.dataset.edit))));
      $$('[data-del]', root).forEach((b) => (b.onclick = () => removeLead(Store.getLead(b.dataset.del))));

      const pager = $('#ld-pager', root);
      pager.hidden = false;
      pager.innerHTML = `
        <span class="muted small">${list.length ? `${state.page * pageSize + 1}–${Math.min(list.length, (state.page + 1) * pageSize)} of ${list.length} leads` : ''}</span>
        <span class="spacer"></span>
        <button class="btn btn-sm" data-pg="-1" ${state.page === 0 ? 'disabled' : ''}>Previous</button>
        <button class="btn btn-sm" data-pg="1" ${state.page >= pages - 1 ? 'disabled' : ''}>Next</button>`;
      $$('[data-pg]', pager).forEach((b) => (b.onclick = () => { state.page += Number(b.dataset.pg); render(); }));
    }

    function rowHtml(l) {
      const owner = Store.getUser(l.ownerId);
      const contact = [l.handle, l.email, l.phone].filter(Boolean);
      const handleLink = (h) => (/^https?:\/\//.test(h) ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(h.replace(/^https?:\/\/(www\.)?/, '').slice(0, 32))}</a>` : esc(h));
      return `<tr>
        <td><div class="lead-cell"><span class="n">${esc(l.name)}</span><span class="b">${esc(l.business || l.niche || '')}</span></div></td>
        <td><div class="lead-cell"><span>${contact[0] ? handleLink(contact[0]) : '<span class="muted">—</span>'}</span><span class="b">${esc(contact[1] || '')}</span></div></td>
        <td><div class="lead-cell">${originPill(l)}<span class="b" style="margin-top:3px; max-width:200px; overflow:hidden; text-overflow:ellipsis">${esc([l.source, (Store.getContent(l.contentId) || {}).title].filter(Boolean).join(' · '))}</span></div></td>
        ${isAdmin ? `<td>${owner ? `<span class="member-cell"><span class="avatar">${esc(Utils.initials(owner.name))}</span>${esc(owner.name.split(' ')[0])}</span>` : '<span class="badge badge-warn">Unassigned</span>'}</td>` : ''}
        <td>
          <select class="select stage-select" data-stage-for="${l.id}" aria-label="Stage for ${esc(l.name)}" style="border-color:${STAGE_COLOR[l.stage]}">
            ${STAGES.map((s) => `<option value="${s.key}" ${s.key === l.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
          </select>
        </td>
        <td class="num">${l.dealValue ? money(l.dealValue) : '<span class="muted">—</span>'}</td>
        <td class="num">${num(l.followUps || 0)}</td>
        <td>${l.lastContactAt ? Utils.formatDate(l.lastContactAt, { month: 'short', day: 'numeric' }) : '<span class="muted">—</span>'}</td>
        <td>${dueHtml(l)}</td>
        <td><div class="table-actions">
          ${OPEN.includes(l.stage) || l.stage === 'new' ? `<button class="btn btn-sm" data-fu="${l.id}" title="Log a follow-up">Follow-up</button>` : ''}
          <button class="btn btn-sm" data-edit="${l.id}">Edit</button>
          <button class="btn btn-sm btn-ghost btn-danger" data-del="${l.id}" aria-label="Delete ${esc(l.name)}">✕</button>
        </div></td>
      </tr>`;
    }

    function renderBoard(list) {
      $('#ld-pager', root).hidden = true;
      $('#ld-body', root).innerHTML = `<div class="board">${STAGES.map((s) => {
        const items = list.filter((l) => l.stage === s.key);
        const sum = items.reduce((a, l) => a + (l.dealValue || 0), 0);
        return `
          <div class="board-col" data-col="${s.key}">
            <div class="board-col-head"><i style="background:${STAGE_COLOR[s.key]}"></i>${esc(s.label)} <span class="c">${items.length}</span>${sum ? `<span class="sum">${money(sum)}</span>` : ''}</div>
            ${items.length ? items.map(cardHtml).join('') : '<div class="board-empty">Drop leads here</div>'}
          </div>`;
      }).join('')}</div>`;

      // Drag & drop between stages
      $$('.lead-card', root).forEach((card) => {
        card.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', card.dataset.id);
          e.dataTransfer.effectAllowed = 'move';
          card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('click', () => openLeadModal(Store.getLead(card.dataset.id)));
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openLeadModal(Store.getLead(card.dataset.id)); });
      });
      $$('.board-col', root).forEach((col) => {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
        col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
        col.addEventListener('drop', (e) => {
          e.preventDefault();
          col.classList.remove('drop');
          const id = e.dataTransfer.getData('text/plain');
          const lead = Store.getLead(id);
          if (lead && lead.stage !== col.dataset.col) {
            Store.setLeadStage(id, col.dataset.col);
            Utils.toast(`${lead.name} → ${stageLabel(col.dataset.col)}`);
          }
        });
      });
    }

    function cardHtml(l) {
      const owner = Store.getUser(l.ownerId);
      return `
        <div class="lead-card" draggable="true" tabindex="0" data-id="${l.id}" aria-label="${esc(l.name)}, ${esc(stageLabel(l.stage))}">
          <div class="top">
            <div style="min-width:0"><div class="n">${esc(l.name)}</div><div class="b">${esc(l.business || l.handle || '')}</div></div>
            ${isAdmin && owner ? `<span class="avatar" title="${esc(owner.name)}">${esc(Utils.initials(owner.name))}</span>` : ''}
          </div>
          <div class="meta">
            ${originPill(l)}
            ${l.dealValue ? `<span class="val">${money(l.dealValue)}</span>` : ''}
            ${l.nextFollowUpAt && OPEN.includes(l.stage) ? `<span>${dueHtml(l)}</span>` : ''}
          </div>
        </div>`;
    }

    // ----- Modals -----
    const openLeadModal = (lead) => openLeadForm(lead, { me, isAdmin });

    function followUpModal(lead) {
      const suggested = Utils.toISO(Utils.addDays(Utils.today(), 3));
      const m = Utils.modal({
        title: `Follow-up: ${lead.name}`,
        subtitle: `This will be follow-up #${(lead.followUps || 0) + 1}. Last contact will be set to today.`,
        body: `
          <form novalidate style="display:grid; gap:14px">
            <div class="field"><label for="fu-next">Next follow-up</label><input id="fu-next" class="input" type="date" value="${suggested}"><span class="hint">Leave empty if no further follow-up is planned.</span></div>
            <div class="form-actions">
              <button type="button" class="btn" data-act="cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Log follow-up</button>
            </div>
          </form>`
      });
      $('[data-act="cancel"]', m.root).onclick = m.close;
      $('form', m.root).addEventListener('submit', (e) => {
        e.preventDefault();
        Store.logFollowUp(lead.id, $('#fu-next', m.root).value);
        m.close();
        Utils.toast('Follow-up logged.');
      });
    }

    async function removeLead(lead) {
      if (await Utils.confirmDialog(`Delete ${lead.name} from the lead list? This cannot be undone.`, { title: 'Delete lead?', confirmText: 'Delete lead' })) {
        Store.deleteLead(lead.id);
        Utils.toast('Lead deleted.');
      }
    }

    // ----- CSV import -----
    // Header aliases: lets a CSV exported from Google Sheets map automatically
    const ALIASES = {
      name: ['name', 'full name', 'lead', 'lead name', 'client', 'client name', 'contact', 'contact name', 'prospect'],
      business: ['business', 'company', 'brand', 'business name', 'company name', 'organisation', 'organization'],
      handle: ['handle', 'instagram', 'ig', 'ig handle', 'username', 'profile', 'profile link', 'link', 'url', 'linkedin', 'social'],
      email: ['email', 'email address', 'e-mail', 'mail'],
      phone: ['phone', 'phone number', 'mobile', 'whatsapp', 'number'],
      source: ['source', 'platform', 'channel', 'lead source'],
      origin: ['lead type', 'type', 'origin', 'inbound/outbound', 'inbound or outbound', 'traffic', 'traffic type'],
      content: ['content', 'post', 'ad', 'campaign', 'creative', 'content piece', 'ad name', 'post title'],
      niche: ['niche', 'industry', 'category', 'vertical'],
      owner: ['owner', 'rep', 'assigned to', 'assigned', 'setter', 'sdr', 'team member', 'sales rep'],
      stage: ['stage', 'status', 'lead status', 'pipeline stage'],
      dealValue: ['deal value', 'value', 'deal', 'price', 'amount', 'revenue', 'contract value', 'offer'],
      amountPaid: ['paid', 'amount paid', 'cash collected', 'collected', 'payment'],
      followUps: ['follow ups', 'follow-ups', 'followups', 'follow up count'],
      lastContactAt: ['last contact', 'last contacted', 'date contacted', 'contacted on', 'outreach date', 'date'],
      nextFollowUpAt: ['next follow up', 'next follow-up', 'follow up date', 'follow-up date'],
      notes: ['notes', 'note', 'comments', 'remarks']
    };
    const STAGE_ALIASES = {
      new: ['new', 'new lead', 'lead', 'not contacted', 'to contact', ''],
      contacted: ['contacted', 'dm sent', 'messaged', 'sent', 'outreach sent', 'reached out', 'emailed', 'no reply', 'follow up'],
      replied: ['replied', 'responded', 'reply', 'response', 'interested', 'in conversation', 'warm'],
      booked: ['booked', 'call booked', 'call scheduled', 'scheduled', 'meeting booked', 'appointment set'],
      attended: ['attended', 'call attended', 'showed', 'show', 'call done', 'call completed', 'met'],
      won: ['won', 'closed', 'closed won', 'converted', 'signed', 'yes'],
      paid: ['paid', 'payment received', 'client', 'onboarded'],
      lost: ['lost', 'closed lost', 'not interested', 'dead', 'no', 'no show', 'rejected', 'ghosted']
    };
    const norm = (s) => String(s || '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
    const toStage = (v) => {
      const n = norm(v);
      return Object.keys(STAGE_ALIASES).find((k) => STAGE_ALIASES[k].includes(n) || norm(stageLabel(k)) === n) || 'new';
    };
    const toDate = (v) => {
      const s = String(v || '').trim();
      if (!s) return '';
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      const m1 = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // dd/mm/yyyy (sheet default in India)
      if (m1) {
        const y = m1[3].length === 2 ? '20' + m1[3] : m1[3];
        return `${y}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
      }
      const d = new Date(s);
      return isNaN(d) ? '' : Utils.toISO(d);
    };
    const toNum = (v) => Number(String(v || '').replace(/[^0-9.]/g, '')) || 0;

    function openImport(text) {
      const rows = Utils.parseCSV(text);
      if (rows.length < 2) { Utils.toast('That CSV has no data rows.', 'error'); return; }
      const headers = rows[0].map(norm);
      const map = {};
      Object.keys(ALIASES).forEach((field) => {
        const idx = headers.findIndex((h) => ALIASES[field].includes(h));
        if (idx >= 0) map[field] = idx;
      });
      if (map.name === undefined) {
        Utils.toast('Could not find a "Name" column in that CSV.', 'error');
        return;
      }
      const members = Store.getMembers();
      const findOwner = (v) => {
        const n = norm(v);
        if (!n) return null;
        const u = members.find((x) => x.email === n || norm(x.name) === n || norm(x.name).split(' ')[0] === n);
        return u ? u.id : null;
      };
      const dataRows = rows.slice(1);
      const contents = Store.getContents();
      const findContent = (v) => {
        const n = norm(v);
        return n ? contents.find((c) => norm(c.title) === n) || null : null;
      };
      const toOrigin = (v) => {
        const n = norm(v);
        if (/\bpaid\b|\bads?\b|sponsored|\bppc\b/.test(n)) return 'paid';
        if (/organic|content|inbound/.test(n)) return 'organic';
        return 'outbound';
      };
      const FIELD_LABELS = { name: 'Name', business: 'Business', handle: 'Handle / link', email: 'Email', phone: 'Phone', origin: 'Lead type', content: 'Content / ad', source: 'Platform', niche: 'Niche', owner: 'Owner', stage: 'Stage', dealValue: 'Deal value', amountPaid: 'Amount paid', followUps: 'Follow-ups', lastContactAt: 'Last contact', nextFollowUpAt: 'Next follow-up', notes: 'Notes' };

      const m = Utils.modal({
        title: 'Import leads from CSV',
        subtitle: `${dataRows.length} rows found. Columns were matched automatically - check them below.`,
        body: `
          <div class="import-map">
            ${Object.keys(FIELD_LABELS).map((f) => `<div><span>${FIELD_LABELS[f]}</span><span class="from">${map[f] !== undefined ? '← ' + esc(rows[0][map[f]]) : '<span class="muted">not found</span>'}</span></div>`).join('')}
          </div>
          ${isAdmin ? `<div class="field" style="margin-top:18px"><label for="imp-owner">Owner for rows without a matching owner</label>
            <select id="imp-owner" class="select"><option value="">Unassigned</option>${members.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>` : ''}
          <div class="form-actions">
            <button type="button" class="btn" data-act="cancel">Cancel</button>
            <button type="button" class="btn btn-primary" data-act="go">Import ${dataRows.length} leads</button>
          </div>`
      });
      m.root.querySelector('.modal').style.width = 'min(680px, 100%)';
      $('[data-act="cancel"]', m.root).onclick = m.close;
      $('[data-act="go"]', m.root).onclick = () => {
        const fallbackOwner = isAdmin ? $('#imp-owner', m.root).value || null : me.id;
        const get = (r, f) => (map[f] !== undefined ? r[map[f]] : '');
        const leads = dataRows.map((r) => ({
          name: get(r, 'name'),
          business: get(r, 'business'),
          handle: get(r, 'handle'),
          email: get(r, 'email'),
          phone: get(r, 'phone'),
          source: get(r, 'source'),
          origin: toOrigin(get(r, 'origin')),
          contentId: (findContent(get(r, 'content')) || {}).id || null,
          niche: get(r, 'niche'),
          ownerId: isAdmin ? findOwner(get(r, 'owner')) || fallbackOwner : me.id,
          stage: toStage(get(r, 'stage')),
          dealValue: toNum(get(r, 'dealValue')),
          amountPaid: toNum(get(r, 'amountPaid')),
          followUps: toNum(get(r, 'followUps')),
          lastContactAt: toDate(get(r, 'lastContactAt')),
          nextFollowUpAt: toDate(get(r, 'nextFollowUpAt')),
          notes: get(r, 'notes')
        }));
        const res = Store.importLeads(leads);
        m.close();
        Utils.toast(`Imported ${res.added} leads${res.skipped ? `, skipped ${res.skipped}` : ''}.`, res.added ? 'info' : 'error');
      };
    }

    function exportCSV(list) {
      const header = ['Name', 'Business', 'Handle', 'Email', 'Phone', 'Lead type', 'Content', 'Platform', 'Niche', 'Owner', 'Stage', 'Deal value', 'Amount paid', 'Follow-ups', 'Last contact', 'Next follow-up', 'Notes', 'Added'];
      const rows = list.map((l) => {
        const o = Store.getUser(l.ownerId);
        return [l.name, l.business, l.handle, l.email, l.phone, ORIGIN_SHORT[originOf(l)], (Store.getContent(l.contentId) || {}).title || '', l.source, l.niche, o ? o.email : '', stageLabel(l.stage), l.dealValue, l.amountPaid, l.followUps, l.lastContactAt, l.nextFollowUpAt, l.notes, (l.createdAt || '').slice(0, 10)];
      });
      Utils.download(`leads_${todayISO()}.csv`, Utils.toCSV([header, ...rows]), 'text/csv');
    }

    return { render };
  }

  return { mount, summarize, reached, followUpState, stagePill, STAGE_COLOR, openLeadForm, originPill, originOf, ORIGIN_SLOT, ORIGIN_SHORT };
})();
