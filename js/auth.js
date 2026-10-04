/* ==========================================================================
   Auth: password hashing, login, sessions and page guards
   NOTE: This is client-side auth for a browser-only app. It keeps honest
   people on the right page, but it is NOT real security - anyone with
   access to the browser can read/modify localStorage. Connect a backend
   (e.g. Supabase / Firebase) before storing sensitive data.
   ========================================================================== */

const Auth = (() => {
  const SESSION_KEY = APP_CONFIG.sessionKey;
  const SESSION_HOURS = 12;

  // ---------- Hashing ----------
  function randomSalt() {
    const bytes = new Uint8Array(16);
    (window.crypto || {}).getRandomValues
      ? crypto.getRandomValues(bytes)
      : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for non-secure contexts (e.g. opened over plain http on a LAN)
  function fnvHash(text) {
    let out = '';
    for (let round = 0; round < 4; round++) {
      let h = 0x811c9dc5 ^ round;
      for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      for (let i = 0; i < 2000; i++) h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
      out += (h >>> 0).toString(16).padStart(8, '0');
    }
    return out;
  }

  const canSubtle = () => !!(window.crypto && crypto.subtle && window.isSecureContext);

  /** Returns "algo$salt$hash" */
  async function hashPassword(password, salt = randomSalt()) {
    if (canSubtle()) return `sha256$${salt}$${await sha256(salt + ':' + password)}`;
    return `fnv$${salt}$${fnvHash(salt + ':' + password)}`;
  }

  async function verifyPassword(password, stored) {
    if (!stored) return false;
    const [algo, salt, hash] = stored.split('$');
    if (algo === 'sha256') {
      if (!canSubtle()) return false;
      return (await sha256(salt + ':' + password)) === hash;
    }
    if (algo === 'fnv') return fnvHash(salt + ':' + password) === hash;
    return false;
  }

  // ---------- Session ----------
  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || Date.now() > s.expires) { logout(false); return null; }
      return s;
    } catch (e) {
      return null;
    }
  }

  function setSession(user, remember) {
    const s = { userId: user.id, role: user.role, expires: Date.now() + SESSION_HOURS * 3600 * 1000 };
    if (remember) s.expires = Date.now() + 14 * 24 * 3600 * 1000;
    const raw = JSON.stringify(s);
    try {
      (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, raw);
    } catch (e) { /* ignore */ }
  }

  function logout(redirect = true) {
    const role = (getSessionRaw() || {}).role;
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
    const go = () => { if (redirect) window.location.href = role === 'admin' ? 'admin-login.html' : 'team-login.html'; };
    if (typeof Store !== 'undefined' && Store.supaOn()) Supa.signOut().finally(go);
    else go();
  }

  function getSessionRaw() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY));
    } catch (e) { return null; }
  }

  /**
   * Attempt a login for the given portal role ('admin' | 'member').
   * Returns { ok, user?, error? }.
   */
  async function login(email, password, role, remember = false) {
    if (Store.supaOn()) {
      const res = await Supa.signIn(email, password);
      if (!res.ok) return res;
      const u = res.user;
      const wrongPortal = u.role !== role;
      if (wrongPortal || !u.active) {
        await Supa.signOut();
        if (!u.active) return { ok: false, error: 'This account has been deactivated. Contact your admin.' };
        return {
          ok: false,
          error: role === 'admin'
            ? 'This account is a team account. Use the Team login instead.'
            : 'This is an admin account. Use the Admin login instead.'
        };
      }
      setSession(u, remember);
      return { ok: true, user: u };
    }
    const user = Store.getUserByEmail(email);
    const generic = 'Incorrect email or password.';
    if (!user) return { ok: false, error: generic };
    if (!(await verifyPassword(password, user.passwordHash))) return { ok: false, error: generic };
    if (user.role !== role) {
      return {
        ok: false,
        error: role === 'admin'
          ? 'This account is a team account. Use the Team login instead.'
          : 'This is an admin account. Use the Admin login instead.'
      };
    }
    if (!user.active) return { ok: false, error: 'This account has been deactivated. Contact your admin.' };
    setSession(user, remember);
    Store.updateUser(user.id, { lastLogin: new Date().toISOString() });
    return { ok: true, user };
  }

  /**
   * Guard a protected page. Redirects to the right login if there's no
   * valid session for `role`. Returns the current user when allowed.
   */
  function requireRole(role) {
    const s = getSession();
    const loginPage = role === 'admin' ? 'admin-login.html' : 'team-login.html';
    if (!s || s.role !== role) { window.location.replace(loginPage); return null; }
    const user = Store.getUser(s.userId);
    if (!user || !user.active || user.role !== role) { logout(false); window.location.replace(loginPage); return null; }
    return user;
  }

  /** If already logged in, skip the login page. */
  function redirectIfLoggedIn(role) {
    const s = getSession();
    if (s && s.role === role && Store.getUser(s.userId)) {
      window.location.replace(role === 'admin' ? 'admin.html' : 'team.html');
    }
  }

  /** Check a user's current password (before changing email/password). */
  async function checkPassword(user, password) {
    if (Store.supaOn()) return Supa.checkPassword(user.email, password);
    return verifyPassword(password, user.passwordHash);
  }

  /** Drop the local session (e.g. Supabase session expired). */
  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  return { hashPassword, verifyPassword, checkPassword, clearSession, login, logout, getSession, requireRole, redirectIfLoggedIn };
})();
