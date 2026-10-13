/* ==========================================================================
   Metrics: filtering, totals, derived rates, time buckets, per-member stats
   ========================================================================== */

const Metrics = (() => {
  const KEYS = () => Store.FIELDS.map((f) => f.key);

  const safeDiv = (a, b) => (b > 0 ? a / b : NaN);

  /** Filter entries by date range and (optionally) one or more user ids. */
  function filter(entries, { from, to, userId, userIds } = {}) {
    const set = userIds ? new Set(userIds) : null;
    return entries.filter((e) =>
      (!from || e.date >= from) &&
      (!to || e.date <= to) &&
      (!userId || e.userId === userId) &&
      (!set || set.has(e.userId))
    );
  }

  function totals(entries) {
    const t = {};
    KEYS().forEach((k) => { t[k] = 0; });
    entries.forEach((e) => KEYS().forEach((k) => { t[k] += Number(e[k]) || 0; }));
    t.days = new Set(entries.map((e) => e.date)).size;
    return t;
  }

  /** Funnel conversion rates and efficiency numbers. */
  function derive(t) {
    return {
      replyRate: safeDiv(t.replies, t.outreach),
      bookingRate: safeDiv(t.callsBooked, t.replies),
      showRate: safeDiv(t.callsShown, t.callsBooked),
      closeRate: safeDiv(t.dealsClosed, t.callsShown),
      payRate: safeDiv(t.paid, t.dealsClosed),
      outreachToClient: safeDiv(t.paid, t.outreach),
      avgDeal: safeDiv(t.revenue, t.dealsClosed),
      collectionRate: safeDiv(t.cashCollected, t.revenue),
      outstanding: Math.max(0, t.revenue - t.cashCollected),
      revenuePer100: safeDiv(t.revenue, t.outreach) * 100,
      outreachPerDay: safeDiv(t.outreach, t.days)
    };
  }

  /** % change vs previous period. */
  function delta(cur, prev) {
    if (!isFinite(cur) || !isFinite(prev)) return { value: NaN, dir: 'flat' };
    if (prev === 0) return { value: cur === 0 ? 0 : NaN, dir: cur > 0 ? 'up' : 'flat' };
    const v = (cur - prev) / Math.abs(prev);
    return { value: v, dir: Math.abs(v) < 0.005 ? 'flat' : v > 0 ? 'up' : 'down' };
  }

  /**
   * Group entries into day / week / month buckets between from..to.
   * Picks a sensible grain automatically unless one is passed.
   */
  function timeSeries(entries, from, to, grain) {
    const days = Utils.daysBetween(from, to) + 1;
    grain = grain || (days <= 45 ? 'day' : days <= 200 ? 'week' : 'month');

    const bucketStart = (iso) => {
      const d = Utils.parseISO(iso);
      if (grain === 'week') {
        const offset = (d.getDay() + 6) % 7; // Monday-start weeks
        return Utils.toISO(Utils.addDays(d, -offset));
      }
      if (grain === 'month') return Utils.toISO(new Date(d.getFullYear(), d.getMonth(), 1));
      return iso;
    };

    // Build empty buckets so gaps show as zero
    const buckets = new Map();
    let cursor = Utils.parseISO(bucketStart(from));
    const end = Utils.parseISO(to);
    while (cursor <= end) {
      const key = Utils.toISO(cursor);
      buckets.set(key, []);
      if (grain === 'day') cursor = Utils.addDays(cursor, 1);
      else if (grain === 'week') cursor = Utils.addDays(cursor, 7);
      else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    entries.forEach((e) => {
      const k = bucketStart(e.date);
      if (buckets.has(k)) buckets.get(k).push(e);
    });

    const fmt = grain === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' };
    const points = Array.from(buckets.entries()).map(([start, list]) => {
      const t = totals(list);
      return { start, label: (grain === 'week' ? 'Wk of ' : '') + Utils.formatDate(start, fmt), short: Utils.formatDate(start, fmt), totals: t, rates: derive(t) };
    });
    return { grain, points };
  }

  /** Totals + rates for each member, sorted by revenue. */
  function byMember(entries, members) {
    return members
      .map((u) => {
        const t = totals(entries.filter((e) => e.userId === u.id));
        return { user: u, totals: t, rates: derive(t) };
      })
      .sort((a, b) => b.totals.revenue - a.totals.revenue || b.totals.outreach - a.totals.outreach);
  }

  /** Monthly targets for a member (custom, or an equal share of team targets). */
  function memberTargets(user) {
    const team = Store.getSettings().targets;
    const activeCount = Math.max(1, Store.getMembers().filter((m) => m.active).length);
    const out = {};
    Object.keys(team).forEach((k) => {
      const custom = user && user.targets && Number(user.targets[k]);
      out[k] = custom > 0 ? custom : Math.round(team[k] / activeCount);
    });
    return out;
  }

  /** Progress for the current calendar month. */
  function monthProgress(entries, targets) {
    const t = Utils.today();
    const from = Utils.toISO(new Date(t.getFullYear(), t.getMonth(), 1));
    const to = Utils.toISO(t);
    const daysInMonth = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    const pace = t.getDate() / daysInMonth;
    const actual = totals(filter(entries, { from, to }));
    return Object.keys(targets).map((k) => ({
      key: k,
      actual: actual[k] || 0,
      target: targets[k] || 0,
      ratio: targets[k] ? (actual[k] || 0) / targets[k] : 0,
      pace,
      projected: pace > 0 ? (actual[k] || 0) / pace : 0
    }));
  }

  function earliestDate(entries) {
    return entries.reduce((min, e) => (!min || e.date < min ? e.date : min), null);
  }

  // Lead stage reached -> activity it counts as (on the date the stage was reached)
  const STAGE_COUNTS = {
    contacted: (l) => ({ outreach: 1 }),
    replied: (l) => ({ replies: 1 }),
    booked: (l) => ({ callsBooked: 1 }),
    attended: (l) => ({ callsShown: 1 }),
    won: (l) => ({ dealsClosed: 1, revenue: Number(l.dealValue) || 0 }),
    paid: (l) => ({ paid: 1, cashCollected: Number(l.amountPaid) || 0 })
  };

  /**
   * Daily activity including what the lead list shows (e.g. leads from the
   * Google Sheet). Per member + day, each number is the larger of the logged
   * entry and the count from leads, so nothing is counted twice.
   */
  function activity(entries, leads) {
    const fromLeads = new Map();
    (leads || []).forEach((l) => {
      const dates = l.stageDates || {};
      Object.keys(STAGE_COUNTS).forEach((stage) => {
        const date = dates[stage];
        if (!date) return;
        const key = `${l.ownerId || ''}|${date}`;
        if (!fromLeads.has(key)) fromLeads.set(key, { userId: l.ownerId || '', date });
        const row = fromLeads.get(key);
        Object.entries(STAGE_COUNTS[stage](l)).forEach(([k, v]) => { row[k] = (row[k] || 0) + v; });
      });
    });
    if (!fromLeads.size) return entries;

    const out = entries.map((e) => {
      const d = fromLeads.get(`${e.userId || ''}|${e.date}`);
      if (!d) return e;
      fromLeads.delete(`${e.userId || ''}|${e.date}`);
      const merged = Object.assign({}, e);
      KEYS().forEach((k) => { merged[k] = Math.max(Number(e[k]) || 0, d[k] || 0); });
      return merged;
    });
    fromLeads.forEach((d, key) => {
      const row = { id: `leads:${key}`, fromLeads: true, userId: d.userId, date: d.date };
      KEYS().forEach((k) => { row[k] = d[k] || 0; });
      out.push(row);
    });
    return out;
  }

  return { filter, totals, derive, delta, timeSeries, byMember, memberTargets, monthProgress, earliestDate, activity };
})();
