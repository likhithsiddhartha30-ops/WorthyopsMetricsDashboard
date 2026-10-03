/* ==========================================================================
   Login page logic (shared by admin-login.html and team-login.html).
   The portal role comes from <body data-role="admin|member">.
   ========================================================================== */

(async function () {
  const { $ } = Utils;
  const role = document.body.dataset.role;
  const target = role === 'admin' ? 'admin.html' : 'team.html';

  Utils.bindThemeToggles();
  await Store.init();
  Auth.redirectIfLoggedIn(role);

  const form = $('#login-form');
  const email = $('#email');
  const password = $('#password');
  const error = $('#login-error');
  const submit = $('#login-submit');

  $('#toggle-password').addEventListener('click', (e) => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    if (!email.value.trim() || !password.value) {
      error.textContent = 'Enter your email and password.';
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    const res = await Auth.login(email.value, password.value, role, $('#remember').checked);
    if (res.ok) {
      window.location.href = target;
      return;
    }
    error.textContent = res.error;
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Sign in';
    password.select();
  });
})();
