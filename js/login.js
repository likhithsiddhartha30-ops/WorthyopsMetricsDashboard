/* ==========================================================================
   Login page logic (index.html). One login for everyone: after signing in,
   admins go to admin.html and team members to team.html.
   Also handles "Forgot password?" and the link from the reset email.
   ========================================================================== */

(async function () {
  const { $ } = Utils;

  // Supabase reset links land here with "type=recovery" in the URL
  const recovering = /type=recovery/.test(location.hash + location.search);

  Utils.bindThemeToggles();
  await Store.init();

  const form = $('#login-form');
  const email = $('#email');
  const password = $('#password');
  const error = $('#login-error');
  const info = $('#login-info');
  const submit = $('#login-submit');
  const title = $('.auth-card h2');
  const lead = $('.auth-card .lead');

  const showError = (msg) => { info.hidden = true; error.textContent = msg; error.hidden = false; };
  const showInfo = (msg) => { error.hidden = true; info.textContent = msg; info.hidden = false; };

  if (recovering && Store.supaOn()) {
    showResetForm();
    return;
  }
  Auth.redirectIfLoggedIn();

  $('#toggle-password').addEventListener('click', (e) => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    info.hidden = true;
    if (!email.value.trim() || !password.value) {
      showError('Enter your email and password.');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    const res = await Auth.login(email.value, password.value, $('#remember').checked);
    if (res.ok) {
      window.location.href = res.home;
      return;
    }
    showError(res.error === 'Incorrect email or password.'
      ? 'Incorrect email or password. Check the password wasn\'t auto-filled by the browser, or use "Forgot password?".'
      : res.error);
    submit.disabled = false;
    submit.textContent = 'Sign in';
    password.select();
  });

  $('#forgot').addEventListener('click', async () => {
    const addr = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      showError('Enter your email above, then click "Forgot password?" again.');
      email.focus();
      return;
    }
    if (!Store.supaOn()) {
      showError('Password reset needs the Supabase connection. Ask your admin.');
      return;
    }
    try {
      await Supa.sendPasswordReset(addr);
      showInfo(`If ${addr} has an account, a reset link is on its way. Open it on this computer.`);
    } catch (x) {
      showError(x.message);
    }
  });

  // ---------- Set a new password (arrived from the reset email) ----------
  function showResetForm() {
    form.hidden = true;
    $('#reset-form').hidden = false;
    title.textContent = 'Set a new password';
    lead.textContent = 'Choose a new password for your account.';
    const err = $('#reset-error');
    $('#reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const pw = $('#new-password').value;
      if (pw.length < 8) { err.textContent = 'Password must be at least 8 characters.'; err.hidden = false; return; }
      if (pw !== $('#confirm-password').value) { err.textContent = 'Passwords do not match.'; err.hidden = false; return; }
      const btn = $('#reset-submit');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await Supa.changeOwnPassword(pw);
        await Supa.signOut();
        Auth.clearSession();
        history.replaceState(null, '', location.pathname);
        $('#reset-form').hidden = true;
        form.hidden = false;
        title.textContent = 'Welcome back';
        lead.textContent = 'Sign in to your WorthyOps account.';
        showInfo('Password updated. Sign in with your new password.');
        password.value = '';
      } catch (x) {
        err.textContent = x.message.includes('session') || x.message.includes('expired')
          ? 'This reset link has expired. Use "Forgot password?" to get a new one.'
          : x.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Set new password';
      }
    });
  }
})();
