/* ==========================================================================
   Charts: thin wrappers around Chart.js that read colors from CSS tokens,
   so every chart follows light/dark mode automatically.
   ========================================================================== */

const Charts = (() => {
  const registry = new Map();

  const c = (name) => Utils.cssVar(name);
  const series = (i) => c(`--series-${i}`);

  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c('--surface'),
          titleColor: c('--text-primary'),
          bodyColor: c('--text-secondary'),
          borderColor: c('--border-strong'),
          borderWidth: 1,
          cornerRadius: 10,
          padding: 12,
          boxPadding: 5,
          usePointStyle: true,
          titleFont: { weight: '600', size: 12.5 },
          bodyFont: { size: 12.5 },
          caretSize: 0
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: c('--axis') },
          ticks: { color: c('--text-muted'), maxRotation: 0, autoSkip: true, autoSkipPadding: 12, font: { size: 11 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: c('--grid') },
          border: { display: false },
          ticks: { color: c('--text-muted'), font: { size: 11 }, maxTicksLimit: 6 }
        }
      }
    };
  }

  function mount(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return null;
    if (registry.has(id)) registry.get(id).destroy();
    const chart = new Chart(canvas, config);
    registry.set(id, chart);
    return chart;
  }

  const moneyTick = (v) => Utils.money(v, { compact: true });
  const pctTick = (v) => Math.round(v * 100) + '%';

  /** Line chart: one or more series sharing a single y-axis. */
  function line(id, { labels, datasets, format = 'number' }) {
    const opts = baseOptions();
    if (format === 'money') opts.scales.y.ticks.callback = moneyTick;
    if (format === 'pct') opts.scales.y.ticks.callback = pctTick;
    opts.plugins.tooltip.callbacks = {
      label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y, format)}`
    };
    return mount(id, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          borderColor: series(d.slot),
          backgroundColor: d.fill ? fadeFill(series(d.slot)) : series(d.slot),
          fill: !!d.fill,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: c('--surface'),
          pointBackgroundColor: series(d.slot),
          spanGaps: true
        }))
      },
      options: opts
    });
  }

  /** Bar chart (vertical or horizontal). Multiple datasets = grouped bars. */
  function bar(id, { labels, datasets, format = 'number', horizontal = false, stacked = false }) {
    const opts = baseOptions();
    if (horizontal) {
      opts.indexAxis = 'y';
      const x = opts.scales.x;
      opts.scales.x = Object.assign({}, opts.scales.y, { beginAtZero: true });
      opts.scales.y = Object.assign({}, x, { grid: { display: false } });
      opts.scales.y.ticks = Object.assign({}, x.ticks, { autoSkip: false });
      opts.interaction = { mode: 'nearest', axis: 'y', intersect: false };
    }
    const valueAxis = horizontal ? opts.scales.x : opts.scales.y;
    if (format === 'money') valueAxis.ticks.callback = moneyTick;
    if (format === 'pct') valueAxis.ticks.callback = pctTick;
    if (stacked) { opts.scales.x.stacked = true; opts.scales.y.stacked = true; }
    opts.plugins.tooltip.callbacks = {
      label: (ctx) => ` ${ctx.dataset.label}: ${fmt(horizontal ? ctx.parsed.x : ctx.parsed.y, format)}`
    };
    return mount(id, {
      type: 'bar',
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          backgroundColor: d.colors || series(d.slot),
          hoverBackgroundColor: d.colors || series(d.slot),
          borderRadius: 4,
          borderSkipped: 'start',
          borderColor: c('--surface'),
          borderWidth: { top: 0, right: 0, bottom: 0, left: 0 },
          maxBarThickness: horizontal ? 22 : 28,
          categoryPercentage: 0.75,
          barPercentage: datasets.length > 1 ? 0.92 : 0.85
        }))
      },
      options: opts
    });
  }

  /** Doughnut for part-to-whole (e.g. cash collected vs outstanding). */
  function doughnut(id, { labels, data, slots, format = 'number' }) {
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: Object.assign(baseOptions().plugins.tooltip, {
          callbacks: { label: (ctx) => ` ${ctx.label}: ${fmt(ctx.parsed, format)}` }
        })
      }
    };
    return mount(id, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: slots.map((s) => (typeof s === 'number' ? series(s) : c(s))),
          borderColor: c('--surface'),
          borderWidth: 2,
          hoverOffset: 4
        }]
      },
      options: opts
    });
  }

  function fmt(v, format) {
    if (format === 'money') return Utils.money(v);
    if (format === 'pct') return Utils.pct(v);
    return Utils.num(v);
  }

  /** Vertical gradient fill under a line (scriptable, sized to the chart area). */
  function fadeFill(hex) {
    return (ctx) => {
      const { chart } = ctx;
      const area = chart.chartArea;
      if (!area) return hexAlpha(hex, 0.12);
      const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, hexAlpha(hex, 0.28));
      g.addColorStop(1, hexAlpha(hex, 0));
      return g;
    };
  }

  function hexAlpha(hex, a) {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function destroyAll() {
    registry.forEach((ch) => ch.destroy());
    registry.clear();
  }

  if (window.Chart) {
    Chart.defaults.font.family = getComputedStyle(document.body || document.documentElement).fontFamily;
  }

  return { line, bar, doughnut, destroyAll, series };
})();
