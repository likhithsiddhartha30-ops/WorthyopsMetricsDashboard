/* ==========================================================================
   Content: inbound performance of organic content vs paid ads.
   Every post / ad is a "content piece". Inbound leads are linked to the
   piece that brought them in, so each piece shows its own leads, meetings,
   deals, revenue and cash. Click a piece to see everything it generated.
   ========================================================================== */

const Content = (() => {
  const { $, $$, escapeHtml: esc, num, money, pct } = Utils;

  const CH = {
    organic: { label: 'Organic content', short: 'Organic', slot: 3 },
    paid: { label: 'Paid ads', short: 'Paid ads', slot: 2 }
  };
  const day = (iso) => String(iso || '').slice(0, 10);
  const safe = (a, b) => (b > 0 ? a / b : NaN);

  /** Funnel + money numbers for a set of leads. */
  function leadStats(leads) {
    const reached = (s) => leads.filter((l) => Leads.reached(l, s)).length;
    const won = leads.filter((l) => l.stage === 'won' || l.stage === 'paid');
    return {
      leads: leads.length,
      booked: reached('booked'),
      attended: reached('attended'),
      closed: reached('won'),
      paid: reached('paid'),
      revenue: won.reduce((s, l) => s + (l.dealValue || 0), 0),
      cash: leads.reduce((s, l) => s + (l.amountPaid || 0), 0)
    };
  }

  function channelPill(ch) {
    return `<span class="stage-pill"><i style="background:var(--series-${CH[ch].slot})"></i>${CH[ch].short}</span>`;
  }

  // Date buckets for the inbound chart (same grain rules as the main charts)
  function buckets(from, to) {
    const days = Utils.daysBetween(from, to) + 1;
    const grain = days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
    const start = (iso) => {
      const d = Utils.parseISO(iso);
      if (grain === 'week') return Utils.toISO(Utils.addDays(d, -((d.getDay() + 6) % 7)));
      if (grain === 'month') return Utils.toISO(new Date(d.getFullYear(), d.getMonth(), 1));
      return iso;
    };
    const keys = [];
    let c = Utils.parseISO(start(from));
    const end = Utils.parseISO(to);
    while (c <= end) {
      keys.push(Utils.toISO(c));
      c = grain === 'day' ? Utils.addDays(c, 1) : grain === 'week' ? Utils.addDays(c, 7) : new Date(c.getFullYear(), c.getMonth() + 1, 1);
    }
    const fmt = grain === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' };
    return { grain, keys, start, label: (k) => Utils.formatDate(k, fmt) };
  }

  // ======================================================================
  function mount({ root, me }) {
    const state = { q: '', channel: 'all', platform: 'all', sortKey: 'revenue', sortDir: 'desc', range: null };

    root.innerHTML = `
      <div class="channel-grid" id="ct-channels"></div>

      <div class="grid-3-1">
        <div class="card">
          <div class="card-head">
            <div><div class="card-title">Inbound leads</div><div class="card-sub">New inbound leads, <span id="ct-grain"></span></div></div>
            <div class="legend" id="ct-legend-inbound"></div>
          </div>
          <div class="chart-box"><canvas id="chart-inbound" role="img" aria-label="Inbound leads over time, organic vs paid"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">Revenue by source</div><div class="card-sub">Closed revenue from leads added in this period</div></div></div>
          <div class="chart-box" style="height:170px"><canvas id="chart-source" role="img" aria-label="Revenue by lead source"></canvas></div>
          <div class="legend" id="ct-source-legend" style="flex-direction:column; gap:8px; margin-top:16px"></div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-head">
            <div><div class="card-title">Funnel: organic vs paid</div><div class="card-sub">Leads added in this period and how far they got</div></div>
            <div class="legend" id="ct-legend-funnel"></div>
          </div>
          <div class="chart-box"><canvas id="chart-ch-funnel" role="img" aria-label="Funnel comparison organic vs paid"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head"><div><div class="card-title">Top content</div><div class="card-sub">By closed revenue, all time · click to open</div></div></div>
          <div class="top-list" id="ct-top"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><div class="card-title">Content library</div><div class="card-sub">Every post and ad, with all-time results. Click one to see the leads it generated.</div></div>
        </div>
        <div class="toolbar">
          <div class="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input class="input" id="ct-q" type="search" placeholder="Search content…" aria-label="Search content">
          </div>
          <div class="seg" id="ct-channel" role="group" aria-label="Channel">
            <button type="button" data-ch="all">All</button>
            <button type="button" data-ch="organic">Organic</button>
            <button type="button" data-ch="paid">Paid ads</button>
          </div>
          <select class="select" id="ct-platform" aria-label="Platform">
            <option value="all">All platforms</option>
            ${APP_CONFIG.contentPlatforms.map((p) => `<option>${esc(p)}</option>`).join('')}
          </select>
          <span class="spacer"></span>
          <button class="btn btn-sm" id="ct-export" type="button">Export</button>
          <button class="btn btn-primary btn-sm" id="ct-add" type="button">+ Add content</button>
        </div>
        <div class="table-wrap">
          <table class="table" id="ct-table">
            <thead><tr>
              <th data-sort="title">Content</th>
              <th data-sort="channel">Channel</th>
              <th data-sort="publishedAt">Published</th>
              <th class="num" data-sort="views">Views</th>
              <th class="num" data-sort="leads">Leads</th>
              <th class="num" data-sort="booked">Meetings</th>
              <th class="num" data-sort="closed">Closed</th>
              <th class="num" data-sort="revenue">Revenue</th>
              <th class="num" data-sort="cash">Cash</th>
              <th class="num" data-sort="adSpend">Spend</th>
              <th class="num" data-sort="roas">ROAS</th>
            </tr></thead>
            <tbody id="ct-rows"></tbody>
          </table>
        </div>
      </div>`;

    $('#ct-q', root).addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); renderLibrary(); });
    $$('[data-ch]', root).forEach((b) => b.addEventListener('click', () => { state.channel = b.dataset.ch; renderLibrary(); }));
    $('#ct-platform', root).addEventListener('change', (e) => { state.platform = e.target.value; renderLibrary(); });
    $('#ct-add', root).addEventListener('click', () => contentForm(null));
    $('#ct-export', root).addEventListener('click', exportCSV);
    $$('#ct-table th[data-sort]', root).forEach((th) => {
      th.classList.add('sortable');
      th.onclick = () => {
        if (state.sortKey === th.dataset.sort) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = th.dataset.sort; state.sortDir = th.dataset.sort === 'title' ? 'asc' : 'desc'; }
        renderLibrary();
      };
    });

    /** All-time stats per content piece. */
    function pieceRows() {
      const leads = Store.getLeads();
      return Store.getContents().map((c) => {
        const st = leadStats(leads.filter((l) => l.contentId === c.id));
        return Object.assign({ c }, st, {
          title: c.title, channel: c.channel, publishedAt: c.publishedAt, views: c.views || 0, adSpend: c.adSpend || 0,
          roas: c.channel === 'paid' ? safe(st.revenue, c.adSpend) : NaN,
          cpl: c.channel === 'paid' ? safe(c.adSpend, st.leads) : NaN
        });
      });
    }

    // ----- Render -----
    function render(range) {
      if (range) state.range = range;
      const r = state.range || Utils.resolveRange('30d');
      const inRange = (l) => day(l.createdAt) >= r.from && day(l.createdAt) <= r.to;
      const leads = Store.getLeads().filter(inRange);
      const by = (o) => leads.filter((l) => Leads.originOf(l) === o);
      const contents = Store.getContents().filter((c) => c.publishedAt >= r.from && c.publishedAt <= r.to);

      renderChannels({
        organic: { st: leadStats(by('organic')), pieces: contents.filter((c) => c.channel === 'organic') },
        paid: { st: leadStats(by('paid')), pieces: contents.filter((c) => c.channel === 'paid') }
      });
      renderInbound(leads, r);
      renderSources(leads);
      renderFunnel(leadStats(by('organic')), leadStats(by('paid')));
      renderTop();
      renderLibrary();
    }

    function mini(label, value, sub = '') {
      return `<div class="mini"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    }

    function renderChannels(d) {
      const o = d.organic;
      const p = d.paid;
      const views = o.pieces.reduce((s, c) => s + (c.views || 0), 0);
      const spend = p.pieces.reduce((s, c) => s + (c.adSpend || 0), 0);
      const common = (st) => [
        mini('Leads', num(st.leads)),
        mini('Meetings booked', num(st.booked), `${pct(safe(st.booked, st.leads))} of leads`),
        mini('Show-ups', num(st.attended), `${pct(safe(st.attended, st.booked))} show rate`),
        mini('Deals closed', num(st.closed), `${pct(safe(st.closed, st.attended))} close rate`),
        mini('Revenue', money(st.revenue)),
        mini('Cash collected', money(st.cash))
      ].join('');
      $('#ct-channels', root).innerHTML = `
        <div class="card channel-card" style="--ch: var(--series-3)">
          <div class="channel-head">
            <div><div class="card-title">Organic content</div><div class="card-sub">Leads from posts, reels, videos &amp; newsletters</div></div>
            <span class="badge">${num(o.pieces.length)} published</span>
          </div>
          <div class="mini-grid">
            ${common(o.st)}
            ${mini('Total views', num(views), `${num(o.pieces.length)} pieces`)}
            ${mini('Leads / 1k views', isFinite(safe(o.st.leads, views)) ? (o.st.leads / views * 1000).toFixed(2) : '—')}
            ${mini('Lead → client', pct(safe(o.st.closed, o.st.leads)))}
          </div>
        </div>
        <div class="card channel-card" style="--ch: var(--series-2)">
          <div class="channel-head">
            <div><div class="card-title">Paid ads</div><div class="card-sub">Leads from ad campaigns and lead forms</div></div>
            <span class="badge">${num(p.pieces.length)} ads launched</span>
          </div>
          <div class="mini-grid">
            ${common(p.st)}
            ${mini('Ad spend', money(spend), `${money(safe(spend, p.st.closed) || 0)} per client`)}
            ${mini('Cost per lead', isFinite(safe(spend, p.st.leads)) ? money(spend / p.st.leads) : '—', `${isFinite(safe(spend, p.st.booked)) ? money(spend / p.st.booked) : '—'} per meeting`)}
            ${mini('ROAS', isFinite(safe(p.st.revenue, spend)) ? (p.st.revenue / spend).toFixed(1) + '×' : '—', 'Revenue ÷ ad spend')}
          </div>
        </div>`;
      $('#ct-channels', root).insertAdjacentHTML('beforeend',
        '<p class="small muted channel-note">Channel numbers count leads added in the selected period. Ad spend and views count content published in the period.</p>');
    }

    function renderInbound(leads, r) {
      const b = buckets(r.from, r.to);
      $('#ct-grain', root).textContent = { day: 'per day', week: 'per week', month: 'per month' }[b.grain];
      const count = (o) => {
        const m = new Map(b.keys.map((k) => [k, 0]));
        leads.filter((l) => Leads.originOf(l) === o).forEach((l) => {
          const k = b.start(day(l.createdAt));
          if (m.has(k)) m.set(k, m.get(k) + 1);
        });
        return b.keys.map((k) => m.get(k));
      };
      Charts.bar('chart-inbound', {
        labels: b.keys.map(b.label), stacked: true,
        datasets: [
          { label: 'Organic', data: count('organic'), slot: 3 },
          { label: 'Paid ads', data: count('paid'), slot: 2 }
        ]
      });
      Dashboard.legend($('#ct-legend-inbound', root), [{ label: 'Organic', slot: 3 }, { label: 'Paid ads', slot: 2 }]);
    }

    function renderSources(leads) {
      const rev = (o) => leadStats(leads.filter((l) => Leads.originOf(l) === o)).revenue;
      const vals = { outbound: rev('outbound'), organic: rev('organic'), paid: rev('paid') };
      const total = vals.outbound + vals.organic + vals.paid;
      Charts.doughnut('chart-source', {
        labels: ['Outbound', 'Organic content', 'Paid ads'],
        data: [vals.outbound, vals.organic, vals.paid],
        slots: [1, 3, 2],
        format: 'money'
      });
      $('#ct-source-legend', root).innerHTML = [['outbound', 'Outbound', 1], ['organic', 'Organic content', 3], ['paid', 'Paid ads', 2]]
        .map(([k, l, s]) => `<span style="justify-content:space-between; width:100%"><span style="display:inline-flex;align-items:center;gap:6px"><i style="background:var(--series-${s})"></i>${l}</span><strong class="tnum">${money(vals[k])} <span class="muted" style="font-weight:500">${pct(safe(vals[k], total), 0)}</span></strong></span>`).join('');
    }

    function renderFunnel(o, p) {
      Charts.bar('chart-ch-funnel', {
        labels: ['Leads', 'Meetings booked', 'Show-ups', 'Closed', 'Paid'],
        datasets: [
          { label: 'Organic', data: [o.leads, o.booked, o.attended, o.closed, o.paid], slot: 3 },
          { label: 'Paid ads', data: [p.leads, p.booked, p.attended, p.closed, p.paid], slot: 2 }
        ]
      });
      Dashboard.legend($('#ct-legend-funnel', root), [{ label: 'Organic', slot: 3 }, { label: 'Paid ads', slot: 2 }]);
    }

    function renderTop() {
      const rows = pieceRows().sort((a, b) => b.revenue - a.revenue || b.leads - a.leads).slice(0, 5);
      const max = Math.max(1, ...rows.map((r) => r.revenue));
      $('#ct-top', root).innerHTML = rows.length
        ? rows.map((r, i) => `
          <button type="button" class="top-item" data-open="${r.c.id}">
            <span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span>
            <span class="top-main">
              <span class="top-title">${esc(r.title)}</span>
              <span class="top-meta">${channelPill(r.channel)} <span>${esc(r.c.platform || '')}</span> <span>${num(r.leads)} leads · ${num(r.closed)} closed</span></span>
              <span class="top-bar"><i style="width:${(r.revenue / max) * 100}%; background:var(--series-${CH[r.channel].slot})"></i></span>
            </span>
            <span class="top-val">${money(r.revenue)}</span>
          </button>`).join('')
        : '<div class="empty-state">No content yet.</div>';
      $$('[data-open]', $('#ct-top', root)).forEach((b) => (b.onclick = () => openDetail(b.dataset.open)));
    }

    function renderLibrary() {
      $$('[data-ch]', root).forEach((b) => b.classList.toggle('active', b.dataset.ch === state.channel));
      $$('#ct-table th[data-sort]', root).forEach((th) => {
        th.classList.toggle('sorted', th.dataset.sort === state.sortKey);
        th.classList.toggle('asc', th.dataset.sort === state.sortKey && state.sortDir === 'asc');
      });
      const dir = state.sortDir === 'asc' ? 1 : -1;
      const rows = pieceRows()
        .filter((r) => state.channel === 'all' || r.channel === state.channel)
        .filter((r) => state.platform === 'all' || r.c.platform === state.platform)
        .filter((r) => !state.q || [r.title, r.c.platform, r.c.format, r.c.notes].join(' ').toLowerCase().includes(state.q))
        .sort((a, b) => {
          const av = a[state.sortKey];
          const bv = b[state.sortKey];
          const an = typeof av === 'number' && !isFinite(av) ? -1 : av;
          const bn = typeof bv === 'number' && !isFinite(bv) ? -1 : bv;
          return (an < bn ? -1 : an > bn ? 1 : 0) * dir;
        });
      $('#ct-rows', root).innerHTML = rows.length
        ? rows.map((r) => `
          <tr class="clickable" data-open="${r.c.id}" tabindex="0" title="Open ${esc(r.title)}">
            <td><div class="lead-cell"><span class="n" style="max-width:250px; overflow:hidden; text-overflow:ellipsis">${esc(r.title)}</span><span class="b">${esc([r.c.format, r.c.platform].filter(Boolean).join(' · '))}</span></div></td>
            <td>${channelPill(r.channel)}</td>
            <td>${Utils.formatDate(r.publishedAt, { month: 'short', day: 'numeric' })}</td>
            <td class="num">${r.views ? Utils.compact(r.views) : '—'}</td>
            <td class="num"><strong>${num(r.leads)}</strong></td>
            <td class="num">${num(r.booked)}</td>
            <td class="num">${num(r.closed)}</td>
            <td class="num">${money(r.revenue)}</td>
            <td class="num">${money(r.cash)}</td>
            <td class="num">${r.channel === 'paid' ? money(r.adSpend) : '<span class="muted">—</span>'}</td>
            <td class="num">${isFinite(r.roas) ? `<span class="badge ${r.roas >= 1 ? 'badge-good' : 'badge-bad'}">${r.roas.toFixed(1)}×</span>` : '<span class="muted">—</span>'}</td>
          </tr>`).join('')
        : `<tr><td class="empty" colspan="11">${Store.getContents().length ? 'No content matches these filters.' : 'No content yet. Click “Add content” to log your first post or ad.'}</td></tr>`;
      $$('#ct-rows tr[data-open]', root).forEach((tr) => {
        tr.onclick = () => openDetail(tr.dataset.open);
        tr.onkeydown = (e) => { if (e.key === 'Enter') openDetail(tr.dataset.open); };
      });
    }

    // ----- Detail: everything one piece of content generated -----
    function openDetail(id) {
      const c = Store.getContent(id);
      if (!c) return;
      const leads = Store.getLeads().filter((l) => l.contentId === c.id)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const st = leadStats(leads);
      const paid = c.channel === 'paid';
      const m = Utils.modal({ title: c.title, body: '' });
      m.root.querySelector('.modal').style.width = 'min(920px, 100%)';
      m.root.querySelector('.modal-body').innerHTML = `
        <div class="detail-meta">
          ${channelPill(c.channel)}
          ${c.platform ? `<span class="badge">${esc(c.platform)}</span>` : ''}
          ${c.format ? `<span class="badge">${esc(c.format)}</span>` : ''}
          <span class="muted small">Published ${Utils.formatDate(c.publishedAt)}</span>
          ${c.url ? `<a class="small" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Open ${paid ? 'ad' : 'post'} ↗</a>` : ''}
        </div>
        <div class="detail-stats">
          ${mini('Views', c.views ? num(c.views) : '—')}
          ${mini('Leads', num(st.leads), c.views ? `${(st.leads / c.views * 1000).toFixed(2)} per 1k views` : '')}
          ${mini('Meetings booked', num(st.booked), pct(safe(st.booked, st.leads)) + ' of leads')}
          ${mini('Show-ups', num(st.attended))}
          ${mini('Deals closed', num(st.closed), pct(safe(st.closed, st.leads)) + ' of leads')}
          ${mini('Revenue', money(st.revenue))}
          ${mini('Cash collected', money(st.cash))}
          ${paid
            ? mini('Ad spend', money(c.adSpend), `ROAS ${isFinite(safe(st.revenue, c.adSpend)) ? (st.revenue / c.adSpend).toFixed(1) + '×' : '—'} · CPL ${isFinite(safe(c.adSpend, st.leads)) ? money(c.adSpend / st.leads) : '—'}`)
            : mini('Revenue / 1k views', c.views ? money(st.revenue / c.views * 1000) : '—')}
        </div>
        ${c.notes ? `<p class="small muted" style="margin-top:14px; white-space:pre-wrap">${esc(c.notes)}</p>` : ''}
        <div class="row" style="margin:22px 0 10px">
          <div class="card-title">Leads from this ${paid ? 'ad' : 'content'}</div>
          <span class="spacer"></span>
          <button class="btn btn-sm" data-act="edit">Edit</button>
          <button class="btn btn-sm btn-danger" data-act="del">Delete</button>
          <button class="btn btn-sm btn-primary" data-act="add-lead">+ Add lead</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Lead</th><th>Owner</th><th>Stage</th><th class="num">Deal value</th><th class="num">Paid</th><th>Added</th></tr></thead>
            <tbody>
              ${leads.length ? leads.map((l) => {
                const o = Store.getUser(l.ownerId);
                return `<tr class="clickable" data-lead="${l.id}">
                  <td><div class="lead-cell"><span class="n">${esc(l.name)}</span><span class="b">${esc(l.handle || l.email || '')}</span></div></td>
                  <td>${o ? esc(o.name) : '<span class="badge badge-warn">Unassigned</span>'}</td>
                  <td>${Leads.stagePill(l.stage)}</td>
                  <td class="num">${l.dealValue ? money(l.dealValue) : '—'}</td>
                  <td class="num">${l.amountPaid ? money(l.amountPaid) : '—'}</td>
                  <td>${Utils.formatDate(day(l.createdAt), { month: 'short', day: 'numeric' })}</td>
                </tr>`;
              }).join('') : '<tr><td class="empty" colspan="6">No leads linked yet. Add one here, or pick this content in a lead\'s “Content / ad” field.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="form-actions"><button class="btn" data-act="close">Close</button></div>`;

      const r = m.root;
      $('[data-act="close"]', r).onclick = m.close;
      $('[data-act="edit"]', r).onclick = () => { m.close(); contentForm(c); };
      $('[data-act="del"]', r).onclick = async () => {
        m.close();
        if (await Utils.confirmDialog(`Delete “${c.title}”? Its ${leads.length} leads stay in the lead list but will no longer be linked to it.`, { title: 'Delete content?', confirmText: 'Delete' })) {
          Store.deleteContent(c.id);
          Utils.toast('Content deleted.');
        }
      };
      $('[data-act="add-lead"]', r).onclick = () => {
        m.close();
        const src = APP_CONFIG.leadSources.includes(c.platform) ? c.platform : '';
        Leads.openLeadForm(null, { me, isAdmin: true, prefill: { origin: c.channel, contentId: c.id, source: src } });
      };
      $$('[data-lead]', r).forEach((tr) => (tr.onclick = () => {
        m.close();
        Leads.openLeadForm(Store.getLead(tr.dataset.lead), { me, isAdmin: true });
      }));
    }

    // ----- Add / edit content -----
    function contentForm(c) {
      const x = c || { channel: state.channel === 'paid' ? 'paid' : 'organic', publishedAt: Utils.toISO(Utils.today()) };
      const opts = (list, v) => {
        const all = v && !list.includes(v) ? [v, ...list] : list;
        return '<option value="">—</option>' + all.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
      };
      const m = Utils.modal({
        title: c ? 'Edit content' : 'Add content',
        subtitle: 'Log a post, video or ad so inbound leads can be linked to it.',
        body: `
          <form class="form-grid" novalidate>
            <div class="field span-all"><label for="cf-title">Title / hook *</label><input id="cf-title" class="input" value="${esc(x.title || '')}" placeholder="e.g. 3 mistakes killing your coaching sales"></div>
            <div class="field"><label>Channel</label>
              <div class="seg" id="cf-channel" role="group" aria-label="Channel">
                <button type="button" data-v="organic">Organic</button>
                <button type="button" data-v="paid">Paid ad</button>
              </div>
            </div>
            <div class="field"><label for="cf-platform">Platform</label><select id="cf-platform" class="select">${opts(APP_CONFIG.contentPlatforms, x.platform)}</select></div>
            <div class="field"><label for="cf-format">Format</label><select id="cf-format" class="select">${opts(APP_CONFIG.contentFormats, x.format)}</select></div>
            <div class="field"><label for="cf-date">Published / launched</label><input id="cf-date" class="input" type="date" value="${esc(x.publishedAt || '')}"></div>
            <div class="field"><label for="cf-views">Views / reach</label><input id="cf-views" class="input" type="number" min="0" value="${x.views || ''}" placeholder="0"></div>
            <div class="field" id="cf-spend-field"><label for="cf-spend">Ad spend (${esc(Store.getSettings().currency)})</label><input id="cf-spend" class="input" type="number" min="0" step="0.01" value="${x.adSpend || ''}" placeholder="0"></div>
            <div class="field span-all"><label for="cf-url">Link</label><input id="cf-url" class="input" type="url" value="${esc(x.url || '')}" placeholder="https://instagram.com/p/…"></div>
            <div class="field span-all"><label for="cf-notes">Notes</label><textarea id="cf-notes" class="input" maxlength="1000" placeholder="Hook, CTA, targeting, what worked…">${esc(x.notes || '')}</textarea></div>
            <div class="form-error span-all" hidden></div>
            <div class="form-actions span-all">
              <button type="button" class="btn" data-act="cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">${c ? 'Save' : 'Add content'}</button>
            </div>
          </form>`
      });
      const r = m.root;
      m.root.querySelector('.modal').style.width = 'min(640px, 100%)';
      let channel = x.channel;
      const paint = () => {
        $$('#cf-channel [data-v]', r).forEach((b) => b.classList.toggle('active', b.dataset.v === channel));
        $('#cf-spend-field', r).hidden = channel !== 'paid';
      };
      $$('#cf-channel [data-v]', r).forEach((b) => (b.onclick = () => { channel = b.dataset.v; paint(); }));
      paint();
      $('[data-act="cancel"]', r).onclick = m.close;
      $('form', r).addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          const saved = Store.saveContent({
            id: c ? c.id : undefined,
            title: $('#cf-title', r).value,
            channel,
            platform: $('#cf-platform', r).value,
            format: $('#cf-format', r).value,
            publishedAt: $('#cf-date', r).value,
            views: $('#cf-views', r).value,
            adSpend: $('#cf-spend', r).value,
            url: $('#cf-url', r).value,
            notes: $('#cf-notes', r).value
          });
          m.close();
          Utils.toast(c ? 'Content saved.' : 'Content added.');
          if (!c) openDetail(saved.id);
        } catch (x2) {
          const err = $('.form-error', r);
          err.textContent = x2.message;
          err.hidden = false;
        }
      });
    }

    function exportCSV() {
      const header = ['Title', 'Channel', 'Platform', 'Format', 'Published', 'Link', 'Views', 'Ad spend', 'Leads', 'Meetings booked', 'Show-ups', 'Deals closed', 'Revenue', 'Cash collected', 'ROAS'];
      const rows = pieceRows().map((r) => [r.title, CH[r.channel].short, r.c.platform, r.c.format, r.publishedAt, r.c.url, r.views, r.adSpend, r.leads, r.booked, r.attended, r.closed, r.revenue, r.cash, isFinite(r.roas) ? r.roas.toFixed(2) : '']);
      Utils.download(`content_${Utils.toISO(Utils.today())}.csv`, Utils.toCSV([header, ...rows]), 'text/csv');
    }

    return { render };
  }

  return { mount, leadStats };
})();
