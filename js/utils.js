/* ==========================================================================
   Shared helpers: formatting, dates, DOM, theme, toasts, modals
   ========================================================================== */

const Utils = (() => {
  // ---------- IDs & misc ----------
  function uid(prefix = 'id') {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initials(name) {
    return String(name || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  // Deterministic PRNG for demo data
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Formatting ----------
  function settings() {
    return (window.Store && Store.getSettings()) || APP_CONFIG.defaultSettings;
  }

  function num(n) {
    return new Intl.NumberFormat(settings().locale).format(Math.round(n || 0));
  }

  function compact(n) {
    return new Intl.NumberFormat(settings().locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  }

  function money(n, opts = {}) {
    const s = settings();
    try {
      return new Intl.NumberFormat(s.locale, {
        style: 'currency',
        currency: s.currency,
        maximumFractionDigits: opts.decimals ?? 0,
        notation: opts.compact ? 'compact' : 'standard'
      }).format(n || 0);
    } catch (e) {
      return s.currency + ' ' + num(n);
    }
  }

  function pct(n, decimals = 1) {
    if (!isFinite(n)) return '—';
    return (n * 100).toFixed(decimals) + '%';
  }

  // ---------- Dates (local, YYYY-MM-DD) ----------
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function daysBetween(a, b) {
    return Math.round((parseISO(b) - parseISO(a)) / 86400000);
  }

  function formatDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
    return parseISO(iso).toLocaleDateString(settings().locale, opts);
  }

  /**
   * Resolve a range key into { from, to, prevFrom, prevTo, label }.
   * prev* is the equal-length window immediately before, used for deltas.
   */
  function resolveRange(key, earliest) {
    const t = today();
    const to = toISO(t);
    let from;
    let label;
    switch (key) {
      case '7d': from = toISO(addDays(t, -6)); label = 'Last 7 days'; break;
      case '30d': from = toISO(addDays(t, -29)); label = 'Last 30 days'; break;
      case '90d': from = toISO(addDays(t, -89)); label = 'Last 90 days'; break;
      case 'mtd': from = toISO(new Date(t.getFullYear(), t.getMonth(), 1)); label = 'Month to date'; break;
      case 'lastmonth': {
        const s = new Date(t.getFullYear(), t.getMonth() - 1, 1);
        const e = new Date(t.getFullYear(), t.getMonth(), 0);
        const len = Math.round((e - s) / 86400000);
        return {
          from: toISO(s), to: toISO(e),
          prevFrom: toISO(new Date(s.getFullYear(), s.getMonth() - 1, 1)),
          prevTo: toISO(addDays(s, -1)),
          label: 'Last month', days: len + 1
        };
      }
      case 'ytd': from = toISO(new Date(t.getFullYear(), 0, 1)); label = 'Year to date'; break;
      case 'all': default:
        from = earliest || toISO(addDays(t, -29)); label = 'All time'; break;
    }
    const len = daysBetween(from, to);
    const prevTo = toISO(addDays(parseISO(from), -1));
    const prevFrom = toISO(addDays(parseISO(prevTo), -len));
    return { from, to, prevFrom, prevTo, label, days: len + 1 };
  }

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------- Theme ----------
  const THEME_KEY = 'worthyops_theme';

  function currentTheme() {
    const set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applySavedTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (e) { /* storage unavailable */ }
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('themechange', { detail: next }));
    updateThemeIcons();
  }

  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function updateThemeIcons() {
    $$('[data-theme-toggle]').forEach((btn) => {
      const dark = currentTheme() === 'dark';
      btn.innerHTML = dark ? ICON_SUN : ICON_MOON;
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = btn.getAttribute('aria-label');
    });
  }

  function bindThemeToggles() {
    $$('[data-theme-toggle]').forEach((btn) => btn.addEventListener('click', toggleTheme));
    updateThemeIcons();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.getAttribute('data-theme')) {
        document.dispatchEvent(new CustomEvent('themechange'));
        updateThemeIcons();
      }
    });
  }

  // ---------- Toasts ----------
  function toast(message, type = 'info') {
    let stack = $('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' error' : '');
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---------- Modal ----------
  /**
   * Open a modal. `body` is an HTML string. Returns { root, close }.
   * Pressing Escape or clicking the backdrop closes it.
   */
  function modal({ title, subtitle = '', body = '', onOpen }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h3 id="modal-title">${escapeHtml(title)}</h3>
        ${subtitle ? `<p class="modal-sub">${escapeHtml(subtitle)}</p>` : ''}
        <div class="modal-body">${body}</div>
      </div>`;
    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    const first = backdrop.querySelector('input, select, textarea, button');
    if (first) first.focus();
    if (onOpen) onOpen(backdrop, close);
    return { root: backdrop, close };
  }

  function confirmDialog(message, { title = 'Are you sure?', confirmText = 'Confirm', danger = true } = {}) {
    return new Promise((resolve) => {
      const m = modal({
        title,
        body: `<p class="muted">${escapeHtml(message)}</p>
          <div class="form-actions">
            <button class="btn" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? 'btn-primary' : 'btn-primary'}" data-act="ok">${escapeHtml(confirmText)}</button>
          </div>`
      });
      m.root.querySelector('[data-act="cancel"]').onclick = () => { m.close(); resolve(false); };
      m.root.querySelector('[data-act="ok"]').onclick = () => { m.close(); resolve(true); };
    });
  }

  // ---------- Files ----------
  function download(filename, content, type = 'text/plain') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toCSV(rows) {
    return rows
      .map((r) => r.map((cell) => {
        const s = String(cell ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(','))
      .join('\n');
  }

  // ---------- Mobile sidebar ----------
  function bindSidebar() {
    const sidebar = $('.sidebar');
    const btn = $('.menu-btn');
    if (!sidebar || !btn) return;
    let scrim = null;
    const close = () => { sidebar.classList.remove('open'); if (scrim) { scrim.remove(); scrim = null; } };
    btn.addEventListener('click', () => {
      sidebar.classList.add('open');
      scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.onclick = close;
      document.body.appendChild(scrim);
    });
    $$('.nav a', sidebar).forEach((a) => a.addEventListener('click', close));
  }

  applySavedTheme();

  return {
    uid, escapeHtml, initials, mulberry32,
    num, compact, money, pct,
    toISO, parseISO, addDays, today, daysBetween, formatDate, resolveRange,
    $, $$, cssVar,
    currentTheme, toggleTheme, bindThemeToggles,
    toast, modal, confirmDialog,
    download, toCSV, bindSidebar
  };
})();
