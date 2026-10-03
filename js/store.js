/* ==========================================================================
   Store: the data layer. Everything is saved in the browser's localStorage.
   All reads/writes go through this file, so swapping in a real backend
   later (Supabase, Firebase, your own API) only means changing this file.
   ========================================================================== */

const Store = (() => {
  const KEY = APP_CONFIG.storageKey;

  /** The numbers a team member logs each day. */
  const FIELDS = [
    { key: 'outreach', label: 'Outreach sent', hint: 'DMs, emails, cold calls, etc.' },
    { key: 'followUps', label: 'Follow-ups sent', hint: 'Follow-up messages to existing leads' },
    { key: 'replies', label: 'Replies received', hint: 'Any response from a prospect' },
    { key: 'callsBooked', label: 'Calls booked', hint: 'Sales / discovery calls scheduled' },
    { key: 'callsShown', label: 'Calls attended', hint: 'Prospects who showed up' },
    { key: 'dealsClosed', label: 'Deals converted', hint: 'Prospects who said yes' },
    { key: 'paid', label: 'Clients paid', hint: 'Converted clients who paid' },
    { key: 'revenue', label: 'Revenue closed', hint: 'Total contract value closed', money: true },
    { key: 'cashCollected', label: 'Cash collected', hint: 'Money actually received', money: true }
  ];

  let db = null;
  const listeners = new Set();

  function emptyDb() {
    return {
      version: 1,
      users: [],
      entries: [],
      leads: [],
      contents: [],
      settings: JSON.parse(JSON.stringify(APP_CONFIG.defaultSettings))
    };
  }

  function load() {
    try {
      db = JSON.parse(localStorage.getItem(KEY));
    } catch (e) {
      db = null;
    }
    if (!db || !Array.isArray(db.users)) db = emptyDb();
    db.settings = Object.assign({}, APP_CONFIG.defaultSettings, db.settings || {});
    db.settings.targets = Object.assign({}, APP_CONFIG.defaultSettings.targets, db.settings.targets || {});
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      Utils.toast('Could not save - browser storage is full or blocked.', 'error');
      throw e;
    }
    listeners.forEach((fn) => fn());
  }

  /** Load data and create the default admin (+ demo data) on first run. */
  async function init() {
    load();
    if (!db.users.some((u) => u.role === 'admin')) {
      const a = APP_CONFIG.defaultAdmin;
      db.users.push(makeUser({ name: a.name, email: a.email, role: 'admin', passwordHash: await Auth.hashPassword(a.password) }));
      if (APP_CONFIG.seedDemoData && !db.users.some((u) => u.role === 'member')) {
        const hash = await Auth.hashPassword(APP_CONFIG.demoPassword);
        APP_CONFIG.demoMembers.forEach((m) => {
          db.users.push(makeUser({ name: m.name, email: m.email, role: 'member', passwordHash: hash }));
        });
        seedEntries();
        seedLeads();
        seedContent();
      }
      save();
    }
    // Older saved data (before the Leads feature) has no lead list yet
    if (!Array.isArray(db.leads)) {
      db.leads = [];
      if (APP_CONFIG.seedDemoData) seedLeads();
      save();
    }
    // ...or no content library yet
    if (!Array.isArray(db.contents)) {
      db.contents = [];
      if (APP_CONFIG.seedDemoData) seedContent();
      save();
    }
    // Sync when another tab changes the data
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) { load(); listeners.forEach((fn) => fn()); }
    });
    return db;
  }

  function makeUser({ name, email, role, passwordHash }) {
    return {
      id: Utils.uid('u'),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      passwordHash,
      active: true,
      targets: null,
      createdAt: new Date().toISOString(),
      lastLogin: null
    };
  }

  // ---------- Demo data ----------
  function seedEntries() {
    const members = db.users.filter((u) => u.role === 'member');
    const rand = Utils.mulberry32(20261003);
    const sr = (x) => Math.floor(x) + (rand() < x - Math.floor(x) ? 1 : 0); // stochastic round
    const between = (a, b) => a + rand() * (b - a);
    const t = Utils.today();
    const profiles = [
      { vol: 1.15, reply: 0.10, close: 0.30, price: 1500 },
      { vol: 0.95, reply: 0.13, close: 0.34, price: 1800 },
      { vol: 1.30, reply: 0.07, close: 0.22, price: 1200 },
      { vol: 0.85, reply: 0.11, close: 0.38, price: 2000 }
    ];
    members.forEach((m, idx) => {
      const p = profiles[idx % profiles.length];
      for (let d = 119; d >= 0; d--) {
        const date = Utils.addDays(t, -d);
        const dow = date.getDay();
        const weekend = dow === 0 || dow === 6;
        if (weekend && rand() < 0.7) continue;
        if (rand() < 0.05) continue; // day off
        const ramp = 0.8 + (119 - d) / 119 * 0.35; // team improving over time
        const outreach = sr((weekend ? between(8, 20) : between(45, 75)) * p.vol * ramp);
        const followUps = sr(outreach * between(0.25, 0.45));
        const replies = sr(outreach * p.reply * between(0.75, 1.25));
        const callsBooked = sr(replies * between(0.22, 0.38));
        const callsShown = Math.min(callsBooked, sr(callsBooked * between(0.65, 0.9)));
        const dealsClosed = Math.min(callsShown, sr(callsShown * p.close * between(0.7, 1.3)));
        const paid = Math.min(dealsClosed, sr(dealsClosed * between(0.75, 1)));
        let revenue = 0;
        for (let i = 0; i < dealsClosed; i++) revenue += Math.round(p.price * between(0.7, 1.4) / 50) * 50;
        const cashCollected = dealsClosed ? Math.round(revenue * (paid / dealsClosed) * between(0.6, 1)) : 0;
        db.entries.push({
          id: Utils.uid('e'),
          userId: m.id,
          date: Utils.toISO(date),
          outreach, followUps, replies, callsBooked, callsShown, dealsClosed, paid, revenue, cashCollected,
          notes: '',
          createdAt: date.toISOString(),
          updatedAt: date.toISOString()
        });
      }
    });
  }

  function seedLeads() {
    const members = db.users.filter((u) => u.role === 'member');
    if (!members.length) return;
    const rand = Utils.mulberry32(777);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const first = ['Ananya', 'Vikram', 'Meera', 'Arjun', 'Kavya', 'Rahul', 'Isha', 'Karan', 'Divya', 'Nikhil', 'Pooja', 'Siddharth', 'Riya', 'Aditya', 'Neha', 'Varun', 'Tanya', 'Harsh', 'Sana', 'Dev', 'Emma', 'Liam', 'Olivia', 'Noah', 'Sophia', 'James', 'Ava', 'Lucas'];
    const last = ['Sharma', 'Iyer', 'Gupta', 'Menon', 'Patel', 'Rao', 'Khan', 'Bose', 'Verma', 'Singh', 'Carter', 'Brooks', 'Hayes', 'Reed', 'Morgan', 'Shah'];
    const biz = ['Fitness Coaching', 'Wellness Studio', 'Mindset Academy', 'Yoga Collective', 'Nutrition Lab', 'Strength Co.', 'Life Coaching', 'Business Mentor', 'Skincare Studio', 'Dance Academy', 'Real Estate Coach', 'Career Coach'];
    const niches = ['Fitness', 'Wellness', 'Coaching', 'Education', 'Beauty', 'Finance', 'Real estate'];
    // Weighted stage distribution: most leads sit early in the funnel
    const stageBag = [...Array(3).fill('new'), ...Array(16).fill('contacted'), ...Array(4).fill('replied'), 'booked', 'booked', 'attended', 'won', 'paid', 'paid', 'lost', 'lost', 'lost'];
    const order = APP_CONFIG.leadStages.map((s) => s.key);
    const t = Utils.today();

    members.forEach((m) => {
      for (let i = 0; i < 22; i++) {
        const fn = pick(first);
        const ln = pick(last);
        const stage = pick(stageBag);
        const added = Utils.addDays(t, -Math.floor(rand() * 60));
        const stageDates = {};
        const reached = stage === 'lost' ? order.indexOf(pick(['contacted', 'replied', 'booked'])) : order.indexOf(stage);
        let d = added;
        order.slice(0, reached + 1).forEach((k) => {
          if (k === 'lost') return;
          stageDates[k] = Utils.toISO(d);
          d = Utils.addDays(d, Math.floor(rand() * 4));
          if (d > t) d = t;
        });
        if (stage === 'lost') stageDates.lost = Utils.toISO(d);
        const late = order.indexOf(stage) >= order.indexOf('booked') && stage !== 'lost';
        const dealValue = late ? Math.round((1000 + rand() * 1500) / 50) * 50 : 0;
        const open = ['contacted', 'replied', 'booked', 'attended'].includes(stage);
        const handle = '@' + (fn + ln).toLowerCase().replace(/[^a-z]/g, '') + (rand() < 0.5 ? '.coach' : '');
        db.leads.push({
          id: Utils.uid('l'),
          name: `${fn} ${ln}`,
          business: `${ln} ${pick(biz)}`,
          email: rand() < 0.6 ? `${fn.toLowerCase()}@${ln.toLowerCase()}${pick(['coaching', 'studio', 'academy'])}.com` : '',
          phone: '',
          handle,
          source: pick(['Instagram', 'Instagram', 'Instagram', 'LinkedIn', 'Cold email', 'Referral', 'Facebook']),
          niche: pick(niches),
          origin: 'outbound',
          contentId: null,
          ownerId: m.id,
          stage,
          dealValue,
          amountPaid: stage === 'paid' ? dealValue : 0,
          followUps: stage === 'new' ? 0 : Math.floor(rand() * 4),
          lastContactAt: stage === 'new' ? '' : Utils.toISO(d),
          nextFollowUpAt: open ? Utils.toISO(Utils.addDays(t, Math.floor(rand() * 10) - 2)) : '',
          stageDates,
          notes: '',
          createdAt: added.toISOString(),
          updatedAt: d.toISOString()
        });
      }
    });
  }

  /** Demo content library + the inbound leads each piece generated. */
  function seedContent() {
    const members = db.users.filter((u) => u.role === 'member');
    if (!members.length) return;
    const rand = Utils.mulberry32(4242);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const t = Utils.today();
    const order = APP_CONFIG.leadStages.map((s) => s.key);
    const pieces = [
      ['organic', 'Instagram', 'Reel', '3 mistakes killing your coaching sales'],
      ['organic', 'Instagram', 'Carousel', 'How we booked 40 calls in 30 days'],
      ['organic', 'YouTube', 'Long-form video', 'Full breakdown: our $50k/month funnel'],
      ['organic', 'Instagram', 'Reel', 'Why your DMs get ignored'],
      ['organic', 'LinkedIn', 'Post', 'Client case study: 0 to 12 clients'],
      ['organic', 'Instagram', 'Story', 'Free audit - reply "AUDIT"'],
      ['organic', 'YouTube', 'Short', 'The 1-line DM opener that works'],
      ['organic', 'Instagram', 'Reel', 'Stop selling, start diagnosing'],
      ['organic', 'Instagram', 'Live / Webinar', 'Live Q&A: scaling to 6 figures'],
      ['organic', 'Newsletter', 'Post', 'Weekly playbook #12'],
      ['paid', 'Instagram', 'Ad - Video', 'VSL ad - Book a free strategy call'],
      ['paid', 'Facebook', 'Lead form', 'Lead magnet: Coaching sales script'],
      ['paid', 'Instagram', 'Ad - Carousel', 'Case study ad - 3 client wins'],
      ['paid', 'YouTube', 'Ad - Video', 'Pre-roll: Free funnel teardown'],
      ['paid', 'Facebook', 'Ad - Image', 'Retargeting - Apply now']
    ];
    // Inbound funnels convert better than cold outbound
    const stageBag = ['new', 'contacted', 'contacted', 'replied', 'replied', 'replied', 'booked', 'booked', 'booked', 'attended', 'attended', 'won', 'paid', 'paid', 'lost', 'lost'];
    const first = ['Aisha', 'Rohit', 'Simran', 'Kunal', 'Ishaan', 'Mira', 'Zoya', 'Yash', 'Nisha', 'Raj', 'Chloe', 'Ethan', 'Grace', 'Mason', 'Leah', 'Omar'];
    const last = ['Kapoor', 'Joshi', 'Malhotra', 'Nair', 'Desai', 'Pillai', 'Chopra', 'Agarwal', 'Bennett', 'Foster', 'Hughes', 'Ward'];

    pieces.forEach(([channel, platform, format, title], i) => {
      const published = Utils.addDays(t, -Math.floor(5 + rand() * 80));
      const views = channel === 'organic'
        ? Math.round((platform === 'YouTube' ? 2000 + rand() * 18000 : 4000 + rand() * 60000) / 10) * 10
        : Math.round((8000 + rand() * 50000) / 10) * 10;
      const adSpend = channel === 'paid' ? Math.round((300 + rand() * 1700) / 10) * 10 : 0;
      const content = {
        id: Utils.uid('c'),
        title, channel, platform, format,
        url: '',
        publishedAt: Utils.toISO(published),
        views,
        adSpend,
        notes: '',
        createdAt: published.toISOString(),
        updatedAt: published.toISOString()
      };
      db.contents.push(content);

      const leadCount = channel === 'paid' ? 4 + Math.floor(rand() * 9) : 1 + Math.floor(rand() * 8);
      for (let k = 0; k < leadCount; k++) {
        const fn = pick(first);
        const ln = pick(last);
        const stage = pick(stageBag);
        const added = Utils.addDays(published, Math.floor(rand() * 10));
        const created = added > t ? t : added;
        const stageDates = {};
        const reachedIdx = stage === 'lost' ? order.indexOf(pick(['replied', 'booked', 'attended'])) : order.indexOf(stage);
        let d = created;
        order.slice(0, reachedIdx + 1).forEach((s) => {
          stageDates[s] = Utils.toISO(d);
          d = Utils.addDays(d, Math.floor(rand() * 3));
          if (d > t) d = t;
        });
        if (stage === 'lost') stageDates.lost = Utils.toISO(d);
        const late = reachedIdx >= order.indexOf('booked') && stage !== 'lost';
        const dealValue = late ? Math.round((1200 + rand() * 1800) / 50) * 50 : 0;
        const open = ['contacted', 'replied', 'booked', 'attended'].includes(stage);
        db.leads.push({
          id: Utils.uid('l'),
          name: `${fn} ${ln}`,
          business: '',
          email: rand() < 0.7 ? `${fn.toLowerCase()}.${ln.toLowerCase()}@gmail.com` : '',
          phone: '',
          handle: '@' + (fn + ln).toLowerCase(),
          source: platform === 'Website / Blog' || platform === 'Newsletter' ? 'Website' : platform,
          niche: '',
          origin: channel,
          contentId: content.id,
          ownerId: members[(i + k) % members.length].id,
          stage,
          dealValue,
          amountPaid: stage === 'paid' ? dealValue : stage === 'won' ? Math.round(dealValue * 0.5) : 0,
          followUps: Math.floor(rand() * 3),
          lastContactAt: stage === 'new' ? '' : Utils.toISO(d),
          nextFollowUpAt: open ? Utils.toISO(Utils.addDays(t, Math.floor(rand() * 8) - 1)) : '',
          stageDates,
          notes: '',
          createdAt: created.toISOString(),
          updatedAt: d.toISOString()
        });
      }
    });
  }

  // ---------- Users ----------
  const getUsers = () => db.users.slice();
  const getMembers = () => db.users.filter((u) => u.role === 'member');
  const getUser = (id) => db.users.find((u) => u.id === id) || null;
  const getUserByEmail = (email) =>
    db.users.find((u) => u.email === String(email || '').trim().toLowerCase()) || null;

  async function addUser({ name, email, password, role = 'member' }) {
    if (!name || !name.trim()) throw new Error('Name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new Error('Enter a valid email address.');
    if (getUserByEmail(email)) throw new Error('An account with this email already exists.');
    validatePassword(password);
    const user = makeUser({ name, email, role, passwordHash: await Auth.hashPassword(password) });
    db.users.push(user);
    save();
    return user;
  }

  function updateUser(id, patch) {
    const u = getUser(id);
    if (!u) throw new Error('User not found.');
    if (patch.email && patch.email.toLowerCase() !== u.email) {
      if (getUserByEmail(patch.email)) throw new Error('An account with this email already exists.');
      patch.email = patch.email.trim().toLowerCase();
    }
    Object.assign(u, patch);
    save();
    return u;
  }

  function validatePassword(pw) {
    if (!pw || pw.length < 8) throw new Error('Password must be at least 8 characters.');
  }

  async function setPassword(id, password) {
    validatePassword(password);
    updateUser(id, { passwordHash: await Auth.hashPassword(password) });
  }

  function deleteUser(id) {
    const u = getUser(id);
    if (!u) return;
    if (u.role === 'admin' && db.users.filter((x) => x.role === 'admin').length === 1) {
      throw new Error('You cannot delete the only admin account.');
    }
    db.users = db.users.filter((x) => x.id !== id);
    db.entries = db.entries.filter((e) => e.userId !== id);
    // Keep their leads (client data) but mark them unassigned
    (db.leads || []).forEach((l) => { if (l.ownerId === id) l.ownerId = null; });
    save();
  }

  // ---------- Leads ----------
  const STAGE_KEYS = () => APP_CONFIG.leadStages.map((s) => s.key);
  const getLeads = () => (db.leads || []).slice();
  const getLead = (id) => (db.leads || []).find((l) => l.id === id) || null;

  function normalizeLead(data, existing) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Lead name is required.');
    const stage = STAGE_KEYS().includes(data.stage) ? data.stage : 'new';
    if (data.ownerId && !getUser(data.ownerId)) throw new Error('Choose a valid owner.');
    const money = (v, label) => {
      const n = Number(v || 0);
      if (!isFinite(n) || n < 0) throw new Error(`${label} must be 0 or more.`);
      return Math.round(n * 100) / 100;
    };
    const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
    const content = data.contentId ? getContent(data.contentId) : null;
    // A lead linked to a piece of content takes that content's channel
    const origin = content
      ? content.channel
      : APP_CONFIG.leadOrigins.some((o) => o.key === data.origin) ? data.origin : 'outbound';
    return {
      origin,
      contentId: content ? content.id : null,
      name: name.slice(0, 120),
      business: String(data.business || '').trim().slice(0, 120),
      email: String(data.email || '').trim().slice(0, 160),
      phone: String(data.phone || '').trim().slice(0, 40),
      handle: String(data.handle || '').trim().slice(0, 200),
      source: String(data.source || '').trim().slice(0, 60),
      niche: String(data.niche || '').trim().slice(0, 60),
      ownerId: data.ownerId || null,
      stage,
      dealValue: money(data.dealValue, 'Deal value'),
      amountPaid: money(data.amountPaid, 'Amount paid'),
      followUps: Math.max(0, Math.round(Number(data.followUps || 0)) || 0),
      lastContactAt: date(data.lastContactAt),
      nextFollowUpAt: date(data.nextFollowUpAt),
      notes: String(data.notes || '').slice(0, 1000),
      stageDates: Object.assign({}, existing ? existing.stageDates : {}, data.stageDates || {})
    };
  }

  /** Create or update a lead. Records the date each stage was first reached. */
  function saveLead(data) {
    if (!db.leads) db.leads = [];
    const existing = data.id ? getLead(data.id) : null;
    const clean = normalizeLead(data, existing);
    const today = Utils.toISO(Utils.today());
    if (!clean.stageDates[clean.stage]) clean.stageDates[clean.stage] = today;
    // Moving past "new" counts as contact
    if (clean.stage !== 'new' && !clean.lastContactAt) clean.lastContactAt = today;
    const now = new Date().toISOString();
    let lead;
    if (existing) {
      lead = Object.assign(existing, clean, { updatedAt: now });
    } else {
      lead = Object.assign({ id: Utils.uid('l'), createdAt: now, updatedAt: now }, clean);
      db.leads.push(lead);
    }
    save();
    return lead;
  }

  function setLeadStage(id, stage) {
    const l = getLead(id);
    if (!l) return null;
    return saveLead(Object.assign({}, l, { stage }));
  }

  /** Log a follow-up: +1 follow-up, last contact = today. */
  function logFollowUp(id, nextFollowUpAt = '') {
    const l = getLead(id);
    if (!l) return null;
    return saveLead(Object.assign({}, l, {
      followUps: (l.followUps || 0) + 1,
      lastContactAt: Utils.toISO(Utils.today()),
      nextFollowUpAt,
      stage: l.stage === 'new' ? 'contacted' : l.stage
    }));
  }

  function deleteLead(id) {
    db.leads = (db.leads || []).filter((l) => l.id !== id);
    save();
  }

  // ---------- Content library ----------
  const getContents = () => (db.contents || []).slice();
  const getContent = (id) => (db.contents || []).find((c) => c.id === id) || null;

  function saveContent(data) {
    if (!db.contents) db.contents = [];
    const title = String(data.title || '').trim();
    if (!title) throw new Error('Give this content a title.');
    const channel = data.channel === 'paid' ? 'paid' : 'organic';
    const n = (v, label) => {
      const x = Number(v || 0);
      if (!isFinite(x) || x < 0) throw new Error(`${label} must be 0 or more.`);
      return Math.round(x * 100) / 100;
    };
    const url = String(data.url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) throw new Error('Link must start with http:// or https://');
    const clean = {
      title: title.slice(0, 160),
      channel,
      platform: String(data.platform || '').slice(0, 60),
      format: String(data.format || '').slice(0, 60),
      url: url.slice(0, 500),
      publishedAt: /^\d{4}-\d{2}-\d{2}$/.test(data.publishedAt || '') ? data.publishedAt : Utils.toISO(Utils.today()),
      views: Math.round(n(data.views, 'Views')),
      adSpend: channel === 'paid' ? n(data.adSpend, 'Ad spend') : 0,
      notes: String(data.notes || '').slice(0, 1000)
    };
    const now = new Date().toISOString();
    let c = data.id ? getContent(data.id) : null;
    if (c) {
      Object.assign(c, clean, { updatedAt: now });
      // Keep linked leads' channel in sync if organic/paid changed
      (db.leads || []).forEach((l) => { if (l.contentId === c.id) l.origin = c.channel; });
    } else {
      c = Object.assign({ id: Utils.uid('c'), createdAt: now, updatedAt: now }, clean);
      db.contents.push(c);
    }
    save();
    return c;
  }

  /** Deletes the content; its leads stay but lose the link (keep their channel). */
  function deleteContent(id) {
    db.contents = (db.contents || []).filter((c) => c.id !== id);
    (db.leads || []).forEach((l) => { if (l.contentId === id) l.contentId = null; });
    save();
  }

  function clearLeads() {
    db.leads = [];
    save();
  }

  /** Bulk insert already-mapped lead objects. Returns { added, skipped, errors }. */
  function importLeads(rows) {
    if (!db.leads) db.leads = [];
    let added = 0;
    const errors = [];
    const now = new Date().toISOString();
    rows.forEach((r, i) => {
      try {
        const clean = normalizeLead(r, null);
        if (!clean.stageDates[clean.stage]) clean.stageDates[clean.stage] = Utils.toISO(Utils.today());
        db.leads.push(Object.assign({ id: Utils.uid('l'), createdAt: now, updatedAt: now }, clean));
        added++;
      } catch (e) {
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    });
    save();
    return { added, skipped: errors.length, errors };
  }

  // ---------- Entries ----------
  const getEntries = () => db.entries.slice();
  const getEntry = (id) => db.entries.find((e) => e.id === id) || null;
  const findEntry = (userId, date) => db.entries.find((e) => e.userId === userId && e.date === date) || null;

  function cleanNumbers(data) {
    const out = {};
    FIELDS.forEach((f) => {
      const v = Number(data[f.key]);
      if (!isFinite(v) || v < 0) throw new Error(`${f.label} must be 0 or more.`);
      out[f.key] = f.money ? Math.round(v * 100) / 100 : Math.round(v);
    });
    return out;
  }

  /** One entry per member per day: logging the same date again updates it. */
  function upsertEntry({ id, userId, date, notes = '', ...rest }) {
    if (!userId || !getUser(userId)) throw new Error('Choose a team member.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Choose a valid date.');
    if (date > Utils.toISO(Utils.today())) throw new Error('You cannot log activity for a future date.');
    const nums = cleanNumbers(rest);
    const now = new Date().toISOString();
    let entry = id ? getEntry(id) : findEntry(userId, date);
    // If editing and the date moved onto another existing day, merge into that day
    const clash = findEntry(userId, date);
    if (entry && clash && clash.id !== entry.id) {
      db.entries = db.entries.filter((e) => e.id !== entry.id);
      entry = clash;
    }
    if (entry) {
      Object.assign(entry, nums, { userId, date, notes: String(notes).slice(0, 500), updatedAt: now });
    } else {
      entry = { id: Utils.uid('e'), userId, date, ...nums, notes: String(notes).slice(0, 500), createdAt: now, updatedAt: now };
      db.entries.push(entry);
    }
    save();
    return entry;
  }

  function deleteEntry(id) {
    db.entries = db.entries.filter((e) => e.id !== id);
    save();
  }

  function clearEntries() {
    db.entries = [];
    save();
  }

  // ---------- Settings ----------
  const getSettings = () => (db ? db.settings : APP_CONFIG.defaultSettings);

  function updateSettings(patch) {
    db.settings = Object.assign({}, db.settings, patch);
    if (patch.targets) db.settings.targets = Object.assign({}, db.settings.targets, patch.targets);
    save();
  }

  // ---------- Backup ----------
  const exportData = () => JSON.stringify(db, null, 2);

  function importData(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || !Array.isArray(data.users) || !Array.isArray(data.entries)) {
      throw new Error('That file is not a valid dashboard backup.');
    }
    if (!data.users.some((u) => u.role === 'admin')) throw new Error('Backup has no admin account.');
    if (!Array.isArray(data.leads)) data.leads = [];
    if (!Array.isArray(data.contents)) data.contents = [];
    db = data;
    save();
    load();
  }

  function resetAll() {
    localStorage.removeItem(KEY);
    db = null;
  }

  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  return {
    FIELDS, init, subscribe,
    getUsers, getMembers, getUser, getUserByEmail, addUser, updateUser, setPassword, deleteUser,
    getEntries, getEntry, findEntry, upsertEntry, deleteEntry, clearEntries,
    getLeads, getLead, saveLead, setLeadStage, logFollowUp, deleteLead, importLeads, clearLeads,
    getContents, getContent, saveContent, deleteContent,
    getSettings, updateSettings, exportData, importData, resetAll
  };
})();
