/* ==========================================================================
   Dashboard: shared building blocks used by both the admin and team pages
   (KPI tiles, funnel, targets, charts, entry form, entries table, router)
   ========================================================================== */

const Dashboard = (() => {
  const { $, $$, escapeHtml: esc, num, money, pct } = Utils;

  // ---------- Router (hash based: #overview, #log, ...) ----------
  function router(views, onShow) {
    const show = () => {
      const fallback = views[0];
      let id = (location.hash || '').slice(1) || fallback;
      if (!views.includes(id)) id = fallback;
      views.forEach((v) => { const el = $(`#view-${v}`); if (el) el.hidden = v !== id; });
      $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
      onShow(id);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', show);
    show();
  }

  // ---------- Icons ----------
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    outreach: svg('<path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/>'),
    replies: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    callsBooked: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    callsShown: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
    dealsClosed: svg('<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="M22 4 12 14l-3-3"/>'),
    paid: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    revenue: svg('<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>'),
    cashCollected: svg('<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>')
  };

  // ---------- KPI tiles ----------
  const KPI_DEFS = [
    { key: 'outreach', label: 'Outreach sent', sub: (t, r) => `${num(t.followUps)} follow-ups` },
    { key: 'replies', label: 'Replies', sub: (t, r) => `${pct(r.replyRate)} reply rate` },
    { key: 'callsBooked', label: 'Calls booked', sub: (t, r) => `${pct(r.bookingRate)} of replies` },
    { key: 'callsShown', label: 'Calls attended', sub: (t, r) => `${pct(r.showRate)} show rate` },
    { key: 'dealsClosed', label: 'Converted', sub: (t, r) => `${pct(r.closeRate)} close rate` },
    { key: 'paid', label: 'Paid clients', sub: (t, r) => `${pct(r.payRate)} of converted` },
    { key: 'revenue', label: 'Revenue closed', money: true, sub: (t, r) => `${money(r.avgDeal || 0)} avg deal` },
    { key: 'cashCollected', label: 'Cash collected', money: true, sub: (t, r) => `${money(r.outstanding)} outstanding` }
  ];

  function deltaHtml(cur, prev) {
    const d = Metrics.delta(cur, prev);
    if (!isFinite(d.value)) return '<span class="delta flat" title="No data in the previous period">—</span>';
    const arrow = d.dir === 'up' ? '↑' : d.dir === 'down' ? '↓' : '';
    const label = `${Math.abs(d.value * 100).toFixed(0)}%`;
    return `<span class="delta ${d.dir}" title="vs previous period">${arrow}${label}</span>`;
  }

  /** Tiny trend line for a KPI tile. */
  function sparkline(values, id) {
    if (!values || values.length < 2) return '';
    const max = Math.max(...values, 1);
    const step = 100 / (values.length - 1);
    const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(30 - (v / max) * 26 - 2).toFixed(2)}`);
    return `
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="sf-${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--accent)" stop-opacity="0.22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="M0,30 L${pts.join(' L')} L100,30 Z" fill="url(#sf-${id})"/>
        <polyline class="line" points="${pts.join(' ')}" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }

  /** points: optional timeSeries points for sparklines. */
  function renderKpis(el, cur, prev, points) {
    const r = Metrics.derive(cur);
    el.innerHTML = KPI_DEFS.map((k) => `
      <div class="kpi">
        <div class="kpi-top">
          <div class="kpi-label"><span class="kpi-icon">${ICONS[k.key]}</span>${k.label}</div>
          ${deltaHtml(cur[k.key], prev[k.key])}
        </div>
        <div class="kpi-value" data-count="${cur[k.key]}" data-format="${k.money ? 'money' : 'num'}">${k.money ? money(cur[k.key]) : num(cur[k.key])}</div>
        <div class="kpi-sub">${k.sub(cur, r)}</div>
        <div class="kpi-spark">${points ? sparkline(points.map((p) => p.totals[k.key]), k.key) : ''}</div>
      </div>`).join('');
    countUp(el);
  }

  /** Animate [data-count] numbers from 0 to their value. */
  function countUp(root) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    $$('[data-count]', root).forEach((el) => {
      const target = Number(el.dataset.count) || 0;
      const fmt = el.dataset.format === 'money' ? money : num;
      const start = performance.now();
      const dur = 700;
      const tick = (now) => {
        const p = Math.min(1, (now - start) / dur);
        el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------- Hero ----------
  /** opts: { eyebrow, title, text (HTML), stats: [{label, value}] } */
  function renderHero(el, opts) {
    el.innerHTML = `
      <div>
        <div class="hero-eyebrow">${esc(opts.eyebrow)}</div>
        <h2>${esc(opts.title)}</h2>
        <p>${opts.text}</p>
      </div>
      <div class="hero-stats">
        ${opts.stats.map((s) => `<div class="hero-stat"><div class="l">${esc(s.label)}</div><div class="v">${s.value}</div></div>`).join('')}
      </div>`;
  }

  // ---------- Segmented date range ----------
  const RANGES = [
    ['7d', '7D'], ['30d', '30D'], ['mtd', 'MTD'], ['lastmonth', 'Last month'], ['90d', '90D'], ['ytd', 'YTD'], ['all', 'All']
  ];

  function bindRange(el, value, onChange) {
    el.innerHTML = RANGES.map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${k === value}">${l}</button>`).join('');
    const paint = (v) => $$('[data-range]', el).forEach((b) => {
      b.classList.toggle('active', b.dataset.range === v);
      b.setAttribute('aria-pressed', String(b.dataset.range === v));
    });
    paint(value);
    $$('[data-range]', el).forEach((b) => b.addEventListener('click', () => { paint(b.dataset.range); onChange(b.dataset.range); }));
  }

  // ---------- Rate strip ----------
  function renderRates(el, cur, prev) {
    const r = Metrics.derive(cur);
    const p = Metrics.derive(prev);
    const items = [
      { label: 'Reply rate', v: r.replyRate, pv: p.replyRate, desc: 'Replies ÷ outreach' },
      { label: 'Booking rate', v: r.bookingRate, pv: p.bookingRate, desc: 'Calls booked ÷ replies' },
      { label: 'Show rate', v: r.showRate, pv: p.showRate, desc: 'Attended ÷ booked' },
      { label: 'Close rate', v: r.closeRate, pv: p.closeRate, desc: 'Converted ÷ attended' },
      { label: 'Outreach → client', v: r.outreachToClient, pv: p.outreachToClient, desc: 'Paid ÷ outreach', decimals: 2 },
      { label: 'Revenue / 100 msgs', v: r.revenuePer100, pv: p.revenuePer100, desc: 'Revenue per 100 outreach', money: true }
    ];
    el.innerHTML = items.map((i) => `
      <div class="rate">
        <div class="label">${i.label}</div>
        <div class="value">${i.money ? (isFinite(i.v) ? money(i.v) : '—') : pct(i.v, i.decimals ?? 1)} ${deltaHtml(i.v, i.pv)}</div>
        <div class="desc">${i.desc}</div>
      </div>`).join('');
  }

  // ---------- Funnel ----------
  function renderFunnel(el, t) {
    const stages = [
      { label: 'Outreach', v: t.outreach },
      { label: 'Replies', v: t.replies },
      { label: 'Calls booked', v: t.callsBooked },
      { label: 'Attended', v: t.callsShown },
      { label: 'Converted', v: t.dealsClosed },
      { label: 'Paid', v: t.paid }
    ];
    const max = Math.max(1, stages[0].v);
    el.innerHTML = stages.map((s, i) => {
      const width = Math.max(1.5, (s.v / max) * 100);
      const step = i > 0 && stages[i - 1].v > 0 ? `${pct(s.v / stages[i - 1].v)} of ${stages[i - 1].label.toLowerCase()}` : '';
      return `
        <div class="funnel-row">
          <div class="funnel-name">${s.label}</div>
          <div class="funnel-track" title="${s.label}: ${num(s.v)}">
            <div class="funnel-bar" style="width:${width}%; background: var(--ramp-${6 - i})"></div>
          </div>
          <div class="funnel-value">${num(s.v)}</div>
          ${step ? `<div class="funnel-step">↳ ${step}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ---------- Monthly targets ----------
  const TARGET_LABELS = {
    outreach: 'Outreach', callsBooked: 'Calls booked', dealsClosed: 'Deals converted', revenue: 'Revenue'
  };

  function renderTargets(el, progress) {
    el.innerHTML = progress.map((p) => {
      const isMoney = p.key === 'revenue';
      const f = (v) => (isMoney ? money(v) : num(v));
      const w = Math.min(100, p.ratio * 100);
      const ahead = p.ratio >= p.pace;
      return `
        <div>
          <div class="target-head">
            <span class="name">${TARGET_LABELS[p.key] || p.key}</span>
            <span class="nums"><strong>${f(p.actual)}</strong> <span class="muted">/ ${f(p.target)}</span></span>
          </div>
          <div class="progress" role="progressbar" aria-valuenow="${Math.round(p.ratio * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="${TARGET_LABELS[p.key]} progress">
            <div class="progress-bar ${p.ratio >= 1 ? 'done' : ''}" style="width:${w}%"></div>
            <div class="progress-pace" style="left:${Math.min(100, p.pace * 100)}%" title="Where you should be today"></div>
          </div>
          <div class="target-foot"><span class="badge ${ahead ? 'badge-good' : 'badge-warn'}">${ahead ? '✓ On pace' : '⚠ Behind pace'}</span>${pct(p.ratio, 0)} done · projected ${f(p.projected)}</div>
        </div>`;
    }).join('') + '<p class="small muted">The dark tick marks where you should be today to hit the monthly target.</p>';
  }

  // ---------- Legends ----------
  function legend(el, items, type = 'box') {
    if (!el) return;
    el.innerHTML = items.map((i) =>
      `<span><i class="${type === 'line' ? 'line' : ''}" style="background: var(--series-${i.slot})"></i>${esc(i.label)}</span>`
    ).join('');
  }

  // ---------- Trend charts ----------
  function renderTrendCharts(entries, range) {
    const ts = Metrics.timeSeries(entries, range.from, range.to);
    const labels = ts.points.map((p) => p.short);
    const col = (k) => ts.points.map((p) => p.totals[k]);
    // Daily rates are noisy (tiny samples), so rates use at least weekly buckets past 2 weeks
    const rts = ts.grain === 'day' && Utils.daysBetween(range.from, range.to) > 14
      ? Metrics.timeSeries(entries, range.from, range.to, 'week')
      : ts;
    const rate = (k) => rts.points.map((p) => (isFinite(p.rates[k]) ? p.rates[k] : null));
    const GRAIN_TEXT = { day: 'per day', week: 'per week', month: 'per month' };
    $$('[data-grain]').forEach((el) => { el.textContent = GRAIN_TEXT[ts.grain]; });
    $$('[data-grain-rates]').forEach((el) => { el.textContent = GRAIN_TEXT[rts.grain]; });

    Charts.line('chart-revenue', {
      labels, format: 'money',
      datasets: [
        { label: 'Revenue closed', data: col('revenue'), slot: 1, fill: true },
        { label: 'Cash collected', data: col('cashCollected'), slot: 3 }
      ]
    });
    legend($('#legend-revenue'), [{ label: 'Revenue closed', slot: 1 }, { label: 'Cash collected', slot: 3 }], 'line');

    Charts.bar('chart-activity', {
      labels, stacked: true,
      datasets: [
        { label: 'Outreach', data: col('outreach'), slot: 1 },
        { label: 'Follow-ups', data: col('followUps'), slot: 2 }
      ]
    });
    legend($('#legend-activity'), [{ label: 'Outreach', slot: 1 }, { label: 'Follow-ups', slot: 2 }]);

    Charts.line('chart-rates', {
      labels: rts.points.map((p) => p.short), format: 'pct',
      datasets: [
        { label: 'Reply rate', data: rate('replyRate'), slot: 1 },
        { label: 'Show rate', data: rate('showRate'), slot: 2 },
        { label: 'Close rate', data: rate('closeRate'), slot: 3 }
      ]
    });
    legend($('#legend-rates'), [{ label: 'Reply rate', slot: 1 }, { label: 'Show rate', slot: 2 }, { label: 'Close rate', slot: 3 }], 'line');

    Charts.bar('chart-calls', {
      labels,
      datasets: [
        { label: 'Calls booked', data: col('callsBooked'), slot: 1 },
        { label: 'Calls attended', data: col('callsShown'), slot: 3 },
        { label: 'Converted', data: col('dealsClosed'), slot: 2 }
      ]
    });
    legend($('#legend-calls'), [{ label: 'Calls booked', slot: 1 }, { label: 'Calls attended', slot: 3 }, { label: 'Converted', slot: 2 }]);
  }

  function renderCollections(t) {
    const outstanding = Math.max(0, t.revenue - t.cashCollected);
    Charts.doughnut('chart-cash', {
      labels: ['Cash collected', 'Outstanding'],
      data: [t.cashCollected, outstanding],
      slots: [1, '--grid'],
      format: 'money'
    });
    const el = $('#cash-summary');
    if (el) {
      const r = t.revenue > 0 ? t.cashCollected / t.revenue : NaN;
      el.innerHTML = `
        <div class="kpi-value">${pct(r, 0)}</div>
        <div class="muted small">of closed revenue collected</div>
        <div class="legend" style="margin-top:12px; flex-direction:column; gap:6px">
          <span><i style="background: var(--series-1)"></i>Collected · ${money(t.cashCollected)}</span>
          <span><i style="background: var(--grid)"></i>Outstanding · ${money(outstanding)}</span>
        </div>`;
    }
  }

  // ---------- Leaderboard ----------
  function renderLeaderboard(el, rows, { compact = false, highlightId = null } = {}) {
    if (!rows.length) {
      el.innerHTML = '<tr><td class="empty" colspan="10">No team members yet.</td></tr>';
      return;
    }
    el.innerHTML = rows.map((r, i) => {
      const rank = `<span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span>`;
      const who = `<span class="member-cell">${rank}<span class="avatar">${esc(Utils.initials(r.user.name))}</span>${esc(r.user.name)}${r.user.id === highlightId ? ' <span class="badge badge-accent">You</span>' : ''}</span>`;
      if (compact) {
        return `<tr><td>${who}</td><td class="num">${num(r.totals.outreach)}</td><td class="num">${num(r.totals.callsBooked)}</td><td class="num">${num(r.totals.dealsClosed)}</td><td class="num">${money(r.totals.revenue)}</td></tr>`;
      }
      return `<tr>
        <td>${who}</td>
        <td class="num">${num(r.totals.outreach)}</td>
        <td class="num">${num(r.totals.replies)}</td>
        <td class="num">${pct(r.rates.replyRate)}</td>
        <td class="num">${num(r.totals.callsBooked)}</td>
        <td class="num">${pct(r.rates.showRate)}</td>
        <td class="num">${num(r.totals.dealsClosed)}</td>
        <td class="num">${pct(r.rates.closeRate)}</td>
        <td class="num">${num(r.totals.paid)}</td>
        <td class="num">${money(r.totals.revenue)}</td>
        <td class="num">${money(r.totals.cashCollected)}</td>
      </tr>`;
    }).join('');
  }

  // ---------- Entry form ----------
  /**
   * Builds the "log activity" form inside `el`.
   * opts: { entry, members (admin only), userId, onSaved, onCancel, submitText }
   */
  function entryForm(el, opts = {}) {
    const e = opts.entry || {};
    const date = e.date || Utils.toISO(Utils.today());
    const memberSelect = opts.members
      ? `<div class="field">
          <label for="ef-user">Team member</label>
          <select id="ef-user" class="select" required>
            ${opts.members.map((m) => `<option value="${m.id}" ${m.id === (e.userId || opts.userId) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
          </select>
        </div>`
      : '';
    el.innerHTML = `
      <form class="entry-form" novalidate>
        <div class="form-grid">
          ${memberSelect}
          <div class="field">
            <label for="ef-date">Date</label>
            <input id="ef-date" class="input" type="date" value="${date}" max="${Utils.toISO(Utils.today())}" required>
          </div>
          ${Store.FIELDS.map((f) => `
            <div class="field">
              <label for="ef-${f.key}">${f.label}${f.money ? ` (${esc(Store.getSettings().currency)})` : ''}</label>
              <input id="ef-${f.key}" name="${f.key}" class="input" type="number" min="0" step="${f.money ? '0.01' : '1'}" inputmode="${f.money ? 'decimal' : 'numeric'}" value="${e[f.key] ?? ''}" placeholder="0">
              <span class="hint">${f.hint}</span>
            </div>`).join('')}
          <div class="field span-all">
            <label for="ef-notes">Notes (optional)</label>
            <textarea id="ef-notes" class="input" maxlength="500" placeholder="Wins, objections heard, anything worth sharing…">${esc(e.notes || '')}</textarea>
          </div>
        </div>
        <p class="ef-existing small muted" style="margin-top:12px"></p>
        <div class="form-error" hidden style="margin-top:12px"></div>
        <div class="form-actions" style="margin-top:16px">
          ${opts.onCancel ? '<button type="button" class="btn" data-act="cancel">Cancel</button>' : ''}
          <button type="submit" class="btn btn-primary">${opts.submitText || 'Save entry'}</button>
        </div>
      </form>`;

    const form = $('form', el);
    const err = $('.form-error', el);
    const existingNote = $('.ef-existing', el);
    const getUserId = () => (opts.members ? $('#ef-user', el).value : opts.userId);

    // Warn when a date already has an entry (saving will update it)
    const checkExisting = () => {
      const found = Store.findEntry(getUserId(), $('#ef-date', el).value);
      existingNote.textContent = found && found.id !== e.id
        ? 'An entry already exists for this date - saving will replace it.'
        : '';
    };
    $('#ef-date', el).addEventListener('change', checkExisting);
    if (opts.members) $('#ef-user', el).addEventListener('change', checkExisting);
    checkExisting();

    if (opts.onCancel) $('[data-act="cancel"]', el).onclick = opts.onCancel;

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const data = { id: e.id, userId: getUserId(), date: $('#ef-date', el).value, notes: $('#ef-notes', el).value.trim() };
      Store.FIELDS.forEach((f) => { data[f.key] = $(`#ef-${f.key}`, el).value || 0; });
      try {
        const saved = Store.upsertEntry(data);
        if (opts.onSaved) opts.onSaved(saved);
      } catch (x) {
        err.textContent = x.message;
        err.hidden = false;
      }
    });
  }

  function openEntryModal(opts) {
    const m = Utils.modal({
      title: opts.entry && opts.entry.id ? 'Edit activity' : 'Log activity',
      subtitle: 'One entry per person per day. Logging the same day again updates it.'
    });
    m.root.querySelector('.modal').style.width = 'min(760px, 100%)';
    entryForm(m.root.querySelector('.modal-body'), Object.assign({}, opts, {
      onCancel: m.close,
      onSaved: (saved) => { m.close(); if (opts.onSaved) opts.onSaved(saved); }
    }));
  }

  // ---------- Entries table ----------
  /**
   * Render a sortable, paginated entries table.
   * opts: { tbody, pager, entries, showMember, canEdit, onEdit, onDelete, state }
   */
  function renderEntriesTable(opts) {
    const st = opts.state;
    const sorted = opts.entries.slice().sort((a, b) => {
      const av = st.sortKey === 'member' ? (Store.getUser(a.userId) || {}).name || '' : a[st.sortKey];
      const bv = st.sortKey === 'member' ? (Store.getUser(b.userId) || {}).name || '' : b[st.sortKey];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return st.sortDir === 'asc' ? cmp : -cmp;
    });
    const pageSize = 20;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    st.page = Math.min(st.page, pages - 1);
    const slice = sorted.slice(st.page * pageSize, (st.page + 1) * pageSize);
    const cols = Store.FIELDS.length + (opts.showMember ? 4 : 3);

    opts.tbody.innerHTML = slice.length
      ? slice.map((e) => {
          const u = Store.getUser(e.userId);
          return `<tr>
            <td>${Utils.formatDate(e.date)}</td>
            ${opts.showMember ? `<td>${esc(u ? u.name : e.memberName || 'Deleted user')}</td>` : ''}
            ${Store.FIELDS.map((f) => `<td class="num">${f.money ? money(e[f.key]) : num(e[f.key])}</td>`).join('')}
            <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis" title="${esc(e.notes)}">${esc(e.notes) || '<span class="muted">—</span>'}</td>
            <td><div class="table-actions">
              ${opts.canEdit ? `<button class="btn btn-sm" data-edit="${e.id}">Edit</button>
              <button class="btn btn-sm btn-danger" data-del="${e.id}">Delete</button>` : ''}
            </div></td>
          </tr>`;
        }).join('')
      : `<tr><td class="empty" colspan="${cols}">No activity logged for this filter.</td></tr>`;

    $$('[data-edit]', opts.tbody).forEach((b) => (b.onclick = () => opts.onEdit(Store.getEntry(b.dataset.edit))));
    $$('[data-del]', opts.tbody).forEach((b) => (b.onclick = () => opts.onDelete(Store.getEntry(b.dataset.del))));

    if (opts.pager) {
      opts.pager.innerHTML = `
        <span class="muted small">${sorted.length ? `${st.page * pageSize + 1}–${Math.min(sorted.length, (st.page + 1) * pageSize)} of ${sorted.length}` : ''}</span>
        <span class="spacer"></span>
        <button class="btn btn-sm" data-pg="-1" ${st.page === 0 ? 'disabled' : ''}>Previous</button>
        <button class="btn btn-sm" data-pg="1" ${st.page >= pages - 1 ? 'disabled' : ''}>Next</button>`;
      $$('[data-pg]', opts.pager).forEach((b) => (b.onclick = () => {
        st.page += Number(b.dataset.pg);
        renderEntriesTable(opts);
      }));
    }
  }

  /** Make <th data-sort="key"> headers clickable. Calls rerender() on change. */
  function bindSortHeaders(table, state, rerender) {
    const paint = () => $$('th[data-sort]', table).forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === state.sortKey);
      th.classList.toggle('asc', th.dataset.sort === state.sortKey && state.sortDir === 'asc');
    });
    $$('th[data-sort]', table).forEach((th) => {
      th.classList.add('sortable');
      th.onclick = () => {
        if (state.sortKey === th.dataset.sort) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else { state.sortKey = th.dataset.sort; state.sortDir = 'desc'; }
        state.page = 0;
        paint();
        rerender();
      };
    });
    paint();
  }

  function entriesToCSV(entries) {
    const header = ['Date', 'Member', 'Email', ...Store.FIELDS.map((f) => f.label), 'Notes'];
    const rows = entries
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((e) => {
        const u = Store.getUser(e.userId) || {};
        return [e.date, u.name || '', u.email || '', ...Store.FIELDS.map((f) => e[f.key]), e.notes || ''];
      });
    return Utils.toCSV([header, ...rows]);
  }

  // ---------- Page chrome ----------
  function fillUserChip(user) {
    $$('[data-user-name]').forEach((el) => (el.textContent = user.name));
    $$('[data-user-initials]').forEach((el) => (el.textContent = Utils.initials(user.name)));
    $$('[data-user-first]').forEach((el) => (el.textContent = user.name.split(' ')[0]));
    $$('[data-logout]').forEach((el) => el.addEventListener('click', () => Auth.logout()));
  }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  return {
    router, renderKpis, renderHero, bindRange, countUp, renderRates, renderFunnel, renderTargets, renderTrendCharts, renderCollections,
    renderLeaderboard, entryForm, openEntryModal, renderEntriesTable, bindSortHeaders, entriesToCSV,
    fillUserChip, greeting, legend
  };
})();
