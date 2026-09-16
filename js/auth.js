// DURU KOREAN — authentication (Supabase Auth)
//
// This file builds the login/signup modal, wires it to the header's
// "Log in" button, and drives every real auth flow (email+password
// signup with email verification, login, logout, password reset,
// resend verification, Google OAuth) through Supabase's own client
// library. No password is ever read, stored, or hashed by this code —
// Supabase's hosted auth service handles all of that. See README.md
// for how to connect a real Supabase project.

(function () {
  'use strict';

  const CONFIG = window.DURU_SUPABASE_CONFIG || {};
  const isConfigured = CONFIG.url && CONFIG.anonKey &&
    !CONFIG.url.includes('YOUR_SUPABASE') && !CONFIG.anonKey.includes('YOUR_SUPABASE');

  let client = null;
  if (isConfigured && window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
  }
  window.DURU_SUPABASE_CLIENT = client;

  const REDIRECT_URL = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'my-learning.html';

  /* ---------------- Modal markup ---------------- */

  const modalHTML = `
    <div class="auth-overlay" id="authOverlay" hidden>
      <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
        <button type="button" class="auth-close" id="authCloseBtn" aria-label="Close">&times;</button>

        <div id="authConfigNotice" class="auth-config-notice" ${isConfigured ? 'hidden' : ''}>
          Sign-in isn't connected yet. This site is wired for Supabase Auth —
          add your project's URL and anon key in <code>js/supabase-config.js</code>
          to turn it on. See <code>README.md</code> for the full setup.
        </div>

        <div class="auth-tabs" id="authTabs">
          <button type="button" class="auth-tab active" data-tab="login">Log in</button>
          <button type="button" class="auth-tab" data-tab="signup">Create account</button>
        </div>

        <!-- Log in panel -->
        <div class="auth-panel" data-panel="login">
          <h2 id="authModalTitle">Welcome back</h2>
          <p class="auth-sub">Log in to Duru Korean.</p>
          <div class="auth-message" data-msg="login" hidden></div>
          <form id="loginForm" novalidate>
            <div class="auth-field">
              <label for="loginEmail">Email</label>
              <input type="email" id="loginEmail" autocomplete="email" required>
            </div>
            <div class="auth-field">
              <label for="loginPassword">Password</label>
              <input type="password" id="loginPassword" autocomplete="current-password" required minlength="6">
            </div>
            <div class="auth-row-between">
              <span></span>
              <button type="button" class="auth-link-btn" data-tab="reset">Forgot password?</button>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="loginSubmit">Log in</button>
          </form>
          <div class="auth-divider">or</div>
          <button type="button" class="btn auth-google" id="googleLoginBtn">Continue with Google</button>
        </div>

        <!-- Create account panel -->
        <div class="auth-panel" data-panel="signup" hidden>
          <h2>Create your account</h2>
          <p class="auth-sub">Start with a free Duru Korean account.</p>
          <div class="auth-message" data-msg="signup" hidden></div>
          <form id="signupForm" novalidate>
            <div class="auth-field">
              <label for="signupEmail">Email</label>
              <input type="email" id="signupEmail" autocomplete="email" required>
            </div>
            <div class="auth-field">
              <label for="signupPassword">Password</label>
              <input type="password" id="signupPassword" autocomplete="new-password" required minlength="6">
            </div>
            <div class="auth-field">
              <label for="signupPasswordConfirm">Confirm password</label>
              <input type="password" id="signupPasswordConfirm" autocomplete="new-password" required minlength="6">
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="signupSubmit">Create account</button>
          </form>
          <div class="auth-divider">or</div>
          <button type="button" class="btn auth-google" id="googleSignupBtn">Continue with Google</button>
        </div>

        <!-- Reset password panel -->
        <div class="auth-panel" data-panel="reset" hidden>
          <h2>Reset your password</h2>
          <p class="auth-sub">We'll email you a link to set a new password.</p>
          <div class="auth-message" data-msg="reset" hidden></div>
          <form id="resetForm" novalidate>
            <div class="auth-field">
              <label for="resetEmail">Email</label>
              <input type="email" id="resetEmail" autocomplete="email" required>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="resetSubmit">Send reset link</button>
          </form>
          <div class="auth-row-between" style="margin-top:4px;">
            <button type="button" class="auth-link-btn" data-tab="login">Back to log in</button>
            <span></span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('authOverlay');
    const closeBtn = document.getElementById('authCloseBtn');
    const tabsBar = document.getElementById('authTabs');
    const panels = overlay.querySelectorAll('.auth-panel');
    const tabs = overlay.querySelectorAll('.auth-tab');
    let lastFocused = null;

    function showPanel(name) {
      panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
      tabsBar.hidden = name === 'reset';
      tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
      const activePanel = overlay.querySelector(`.auth-panel[data-panel="${name}"]`);
      const firstInput = activePanel && activePanel.querySelector('input');
      if (firstInput) firstInput.focus();
    }

    function openModal(tab) {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      showPanel(tab || 'login');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      overlay.hidden = true;
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    }

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !overlay.hidden) closeModal();
    });
    overlay.querySelectorAll('[data-tab]').forEach((el) => {
      el.addEventListener('click', () => showPanel(el.dataset.tab));
    });

    const trigger = document.getElementById('authTrigger');
    if (trigger) trigger.addEventListener('click', () => openModal('login'));

    function setMessage(panel, type, text) {
      const el = overlay.querySelector(`[data-msg="${panel}"]`);
      if (!el) return;
      el.className = 'auth-message ' + type;
      el.textContent = text;
      el.hidden = false;
    }
    function clearMessage(panel) {
      const el = overlay.querySelector(`[data-msg="${panel}"]`);
      if (el) el.hidden = true;
    }
    function friendlyError(err) {
      const msg = (err && err.message) || 'Something went wrong. Please try again.';
      if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match our records.';
      if (/email not confirmed/i.test(msg)) return 'Please verify your email first — check your inbox for the confirmation link.';
      if (/user already registered/i.test(msg)) return 'An account with this email already exists — try logging in instead.';
      if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
      return msg;
    }
    function setLoading(btn, loading, label) {
      btn.disabled = loading;
      btn.textContent = loading ? 'Please wait…' : label;
    }

    function requireClient(panel) {
      if (!client) {
        setMessage(panel, 'error', 'Sign-in isn’t connected yet. See the notice above for setup steps.');
        return false;
      }
      return true;
    }

    /* ---- Log in ---- */
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage('login');
      if (!requireClient('login')) return;
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const btn = document.getElementById('loginSubmit');
      setLoading(btn, true, 'Log in');
      const { error } = await client.auth.signInWithPassword({ email, password });
      setLoading(btn, false, 'Log in');
      if (error) { setMessage('login', 'error', friendlyError(error)); return; }
      closeModal();
    });

    /* ---- Create account ---- */
    document.getElementById('signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage('signup');
      if (!requireClient('signup')) return;
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value;
      const confirm = document.getElementById('signupPasswordConfirm').value;
      if (password !== confirm) { setMessage('signup', 'error', 'Passwords don’t match.'); return; }
      if (password.length < 6) { setMessage('signup', 'error', 'Password must be at least 6 characters.'); return; }
      const btn = document.getElementById('signupSubmit');
      setLoading(btn, true, 'Create account');
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: REDIRECT_URL },
      });
      setLoading(btn, false, 'Create account');
      if (error) { setMessage('signup', 'error', friendlyError(error)); return; }
      if (data && data.user && data.user.identities && data.user.identities.length === 0) {
        setMessage('signup', 'error', 'An account with this email already exists — try logging in instead.');
        return;
      }
      setMessage('signup', 'success',
        `We’ve sent a verification link to ${email}. Confirm your email, then log in. ` +
        `Didn’t get it? Use "Forgot password?" from the log in tab to resend, or check your spam folder.`);
      document.getElementById('signupForm').reset();
    });

    /* ---- Reset password ---- */
    document.getElementById('resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage('reset');
      if (!requireClient('reset')) return;
      const email = document.getElementById('resetEmail').value.trim();
      const btn = document.getElementById('resetSubmit');
      setLoading(btn, true, 'Send reset link');
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL });
      setLoading(btn, false, 'Send reset link');
      if (error) { setMessage('reset', 'error', friendlyError(error)); return; }
      setMessage('reset', 'success', `If an account exists for ${email}, a reset link is on its way.`);
      document.getElementById('resetForm').reset();
    });

    /* ---- Google OAuth ---- */
    async function signInWithGoogle(panel) {
      clearMessage(panel);
      if (!requireClient(panel)) return;
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: REDIRECT_URL },
      });
      if (error) setMessage(panel, 'error', friendlyError(error));
    }
    document.getElementById('googleLoginBtn').addEventListener('click', () => signInWithGoogle('login'));
    document.getElementById('googleSignupBtn').addEventListener('click', () => signInWithGoogle('signup'));

    /* ---------------- Header auth state ---------------- */

    function initials(email) {
      return (email || '?').slice(0, 1).toUpperCase();
    }

    function renderSignedIn(user) {
      if (!trigger) return;
      const wrap = document.createElement('div');
      wrap.className = 'account-menu';
      wrap.innerHTML = `
        <button type="button" class="account-trigger" id="accountTriggerBtn" aria-haspopup="true" aria-expanded="false">
          <span class="avatar">${initials(user.email)}</span>
          <span class="email">${user.email}</span>
        </button>
        <div class="account-dropdown" id="accountDropdown" hidden>
          <a href="${REDIRECT_URL.endsWith('/my-learning.html') ? 'my-learning.html' : REDIRECT_URL}">My Learning</a>
          <button type="button" id="logoutBtn">Log out</button>
        </div>
      `;
      trigger.replaceWith(wrap);
      const accBtn = wrap.querySelector('#accountTriggerBtn');
      const dropdown = wrap.querySelector('#accountDropdown');
      accBtn.addEventListener('click', () => {
        const open = !dropdown.hidden;
        dropdown.hidden = open;
        accBtn.setAttribute('aria-expanded', String(!open));
      });
      document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) { dropdown.hidden = true; accBtn.setAttribute('aria-expanded', 'false'); }
      });
      wrap.querySelector('#logoutBtn').addEventListener('click', async () => {
        if (client) await client.auth.signOut();
        window.location.reload();
      });

      // Admin-only "Manage Resources" link — verified server-side via the
      // admin_users table's RLS policy, never inferred from the email string.
      if (client) {
        client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
          .then(({ data }) => {
            if (!data) return;
            const link = document.createElement('a');
            link.href = 'free-resources.html#adminResources';
            link.textContent = 'Manage Resources';
            dropdown.insertBefore(link, dropdown.querySelector('#logoutBtn'));
          });
      }
    }

    if (client) {
      client.auth.getSession().then(({ data }) => {
        if (data && data.session && data.session.user) renderSignedIn(data.session.user);
      });
      client.auth.onAuthStateChange((_event, session) => {
        if (session && session.user && document.getElementById('authTrigger')) {
          renderSignedIn(session.user);
          if (!overlay.hidden) closeModal();
        }
      });
    }
  });
})();
