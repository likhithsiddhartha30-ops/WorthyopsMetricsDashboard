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
      }
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
    save();
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
    getSettings, updateSettings, exportData, importData, resetAll
  };
})();
