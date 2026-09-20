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

  // Sign-in has to start and finish on the same origin. PKCE stores a
  // one-time verifier under the origin that began the flow, so a visitor who
  // starts on the apex and is redirected to www on the way back arrives with
  // a code the browser can no longer verify — the sign-in fails silently and
  // the page simply says they are not logged in.
  //
  // Only the apex/www pair is corrected, and only when it matches the
  // configured canonical host. Previews, localhost, and any other host are
  // left alone, since bouncing those to production would be worse than the
  // problem being solved.
  (function canonicalizeHost() {
    if (!CONFIG.siteUrl || location.protocol === 'file:') return;
    var canonical;
    try { canonical = new URL(CONFIG.siteUrl); } catch (e) { return; }
    if (canonical.hostname === location.hostname) return;
    if (canonical.hostname !== 'www.' + location.hostname) return;
    location.replace(canonical.origin + location.pathname + location.search + location.hash);
  })();

  let client = null;
  if (isConfigured && window.supabase && typeof window.supabase.createClient === 'function') {
    client = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
  }
  window.DURU_SUPABASE_CLIENT = client;

  const REDIRECT_URL = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'my-learning.html';

  /* ---------------- Modal markup ---------------- */

  // The notice tracks whether a client actually exists, not merely whether
  // the config strings are filled in. With valid config but a CDN that
  // failed to load, the form would otherwise look usable while every
  // submit failed with an error pointing at a hidden notice.
  const noticeKey = isConfigured ? 'auth.sdkNotice' : 'auth.configNotice';
  const noticeText = isConfigured
    ? `Sign-in couldn't start: the authentication library didn't load. That's usually a
       blocked CDN or a dropped connection, not your account. Reload the page, and if it
       keeps happening check whether your network allows <code>cdn.jsdelivr.net</code>.`
    : `Sign-in isn't connected yet. This site is wired for Supabase Auth —
       add your project's URL and anon key in <code>js/supabase-config.js</code>
       to turn it on. See <code>README.md</code> for the full setup.`;

  const modalHTML = `
    <div class="auth-overlay" id="authOverlay" hidden>
      <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">
        <button type="button" class="auth-close" id="authCloseBtn" aria-label="Close">&times;</button>

        <div id="authConfigNotice" class="auth-config-notice" ${client ? 'hidden' : ''} data-i18n-html="${noticeKey}">
          ${noticeText}
        </div>

        <div class="auth-tabs" id="authTabs">
          <button type="button" class="auth-tab active" data-tab="login" data-i18n="auth.tabLogin">Log in</button>
          <button type="button" class="auth-tab" data-tab="signup" data-i18n="auth.tabSignup">Create account</button>
        </div>

        <!-- Log in panel -->
        <div class="auth-panel" data-panel="login">
          <h2 id="authModalTitle" data-i18n="auth.loginTitle">Welcome back</h2>
          <p class="auth-sub" data-i18n="auth.loginSub">Log in to Duru Korean.</p>
          <div class="auth-message" data-msg="login" hidden></div>
          <form id="loginForm" novalidate>
            <div class="auth-field">
              <label for="loginEmail" data-i18n="auth.email">Email</label>
              <input type="email" id="loginEmail" autocomplete="email" required>
            </div>
            <div class="auth-field">
              <label for="loginPassword" data-i18n="auth.password">Password</label>
              <input type="password" id="loginPassword" autocomplete="current-password" required minlength="6">
            </div>
            <div class="auth-row-between">
              <span></span>
              <button type="button" class="auth-link-btn" data-tab="reset" data-i18n="auth.forgotPassword">Forgot password?</button>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="loginSubmit" data-i18n="auth.loginSubmit">Log in</button>
          </form>
          <div class="auth-divider" data-i18n="auth.or">or</div>
          <button type="button" class="btn auth-google" id="googleLoginBtn" data-i18n="auth.continueGoogle">Continue with Google</button>
        </div>

        <!-- Create account panel -->
        <div class="auth-panel" data-panel="signup" hidden>
          <h2 data-i18n="auth.signupTitle">Create your account</h2>
          <p class="auth-sub" data-i18n="auth.signupSub">Start with a free Duru Korean account.</p>
          <div class="auth-message" data-msg="signup" hidden></div>
          <form id="signupForm" novalidate>
            <div class="auth-field">
              <label for="signupEmail" data-i18n="auth.email">Email</label>
              <input type="email" id="signupEmail" autocomplete="email" required>
            </div>
            <div class="auth-field">
              <label for="signupNickname" data-i18n="auth.nickname">Nickname</label>
              <input type="text" id="signupNickname" maxlength="40" required>
            </div>
            <div class="auth-field">
              <label for="signupBirthDate" data-i18n="auth.birthDate">Birth Date</label>
              <input type="date" id="signupBirthDate" required>
            </div>
            <div class="auth-field">
              <label for="signupPassword" data-i18n="auth.password">Password</label>
              <input type="password" id="signupPassword" autocomplete="new-password" required minlength="6">
            </div>
            <div class="auth-field">
              <label for="signupPasswordConfirm" data-i18n="auth.confirmPassword">Confirm password</label>
              <input type="password" id="signupPasswordConfirm" autocomplete="new-password" required minlength="6">
            </div>
            <div class="auth-consents">
              <div class="auth-consent-row">
                <input type="checkbox" id="signupTOS" required>
                <label for="signupTOS" data-i18n="auth.tosLabel">I agree to the Terms of Service (Required)</label>
              </div>
              <div class="auth-consent-row">
                <input type="checkbox" id="signupPrivacy" required>
                <label for="signupPrivacy" data-i18n="auth.privacyLabel">I agree to the Privacy Policy (Required)</label>
              </div>
              <div class="auth-consent-row">
                <input type="checkbox" id="signupMarketing">
                <label for="signupMarketing" data-i18n="auth.marketingLabel">I want to receive marketing emails and updates (Optional)</label>
              </div>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="signupSubmit" data-i18n="auth.signupSubmit">Create account</button>
          </form>
          <div class="auth-divider" data-i18n="auth.or">or</div>
          <button type="button" class="btn auth-google" id="googleSignupBtn" data-i18n="auth.continueGoogle">Continue with Google</button>
        </div>

        <!-- Reset password panel -->
        <div class="auth-panel" data-panel="reset" hidden>
          <h2 data-i18n="auth.resetTitle">Reset your password</h2>
          <p class="auth-sub" data-i18n="auth.resetSub">We'll email you a link to set a new password.</p>
          <div class="auth-message" data-msg="reset" hidden></div>
          <form id="resetForm" novalidate>
            <div class="auth-field">
              <label for="resetEmail" data-i18n="auth.email">Email</label>
              <input type="email" id="resetEmail" autocomplete="email" required>
            </div>
            <button type="submit" class="btn btn-primary auth-submit" id="resetSubmit" data-i18n="auth.resetSubmit">Send reset link</button>
          </form>
          <div class="auth-row-between" style="margin-top:4px;">
            <button type="button" class="auth-link-btn" data-tab="login" data-i18n="auth.backToLogin">Back to log in</button>
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

    function t(key, fallback) {
      // DURU_I18N.t returns the key itself when the dictionary hasn't
      // arrived yet (it loads over the network) or the key is missing.
      // Passing that through puts a raw "some.key" string on screen, so
      // treat it as "no translation" and use the English fallback.
      if (!window.DURU_I18N) return fallback;
      var translated = window.DURU_I18N.t(key);
      return translated === key ? fallback : translated;
    }

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
      const msg = (err && err.message) || t('auth.errors.generic', 'Something went wrong. Please try again.');
      if (/invalid login credentials/i.test(msg)) return t('auth.errors.invalidCredentials', 'That email and password don’t match our records.');
      if (/email not confirmed/i.test(msg)) return t('auth.errors.emailNotConfirmed', 'Please verify your email first — check your inbox for the confirmation link.');
      if (/user already registered/i.test(msg)) return t('auth.errors.userExists', 'An account with this email already exists — try logging in instead.');
      if (/rate limit/i.test(msg)) return t('auth.errors.rateLimit', 'Too many attempts. Please wait a moment and try again.');
      // A provider that hasn't been configured in the Supabase dashboard
      // answers with a developer-facing string; the visitor needs to know
      // to use email instead, not to read "Unsupported provider".
      if (/unsupported provider|provider is not enabled|validation_failed/i.test(msg)) {
        return t('auth.errors.providerDisabled', 'Google sign-in isn\u2019t available yet. Please use your email address instead.');
      }
      return msg;
    }
    function setLoading(btn, loading, labelKey, labelFallback) {
      btn.disabled = loading;
      btn.textContent = loading ? t('auth.pleaseWait', 'Please wait…') : t(labelKey, labelFallback);
    }

    function requireClient(panel) {
      if (!client) {
        setMessage(panel, 'error', t('auth.errors.notConnected', 'Sign-in isn’t connected yet. See the notice above for setup steps.'));
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
      setLoading(btn, true, 'auth.loginSubmit', 'Log in');
      const { error } = await client.auth.signInWithPassword({ email, password });
      setLoading(btn, false, 'auth.loginSubmit', 'Log in');
      if (error) { setMessage('login', 'error', friendlyError(error)); return; }
      closeModal();
    });

    /* ---- Create account ---- */
    document.getElementById('signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage('signup');
      if (!requireClient('signup')) return;
      const email = document.getElementById('signupEmail').value.trim();
      const nickname = document.getElementById('signupNickname').value.trim();
      const birthDate = document.getElementById('signupBirthDate').value;
      const password = document.getElementById('signupPassword').value;
      const confirm = document.getElementById('signupPasswordConfirm').value;
      const tosAgreed = document.getElementById('signupTOS').checked;
      const privacyAgreed = document.getElementById('signupPrivacy').checked;
      const marketingAgreed = document.getElementById('signupMarketing').checked;

      if (password !== confirm) { setMessage('signup', 'error', t('auth.errors.passwordMismatch', 'Passwords do not match.')); return; }
      if (password.length < 6) { setMessage('signup', 'error', t('auth.errors.passwordTooShort', 'Password must be at least 6 characters.')); return; }
      if (!tosAgreed) { setMessage('signup', 'error', t('auth.errors.tosRequired', 'You must agree to the Terms of Service.')); return; }
      if (!privacyAgreed) { setMessage('signup', 'error', t('auth.errors.privacyRequired', 'You must agree to the Privacy Policy.')); return; }

      const btn = document.getElementById('signupSubmit');
      setLoading(btn, true, 'auth.signupSubmit', 'Create account');
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: REDIRECT_URL },
      });
      setLoading(btn, false, 'auth.signupSubmit', 'Create account');
      if (error) { setMessage('signup', 'error', friendlyError(error)); return; }
      if (data && data.user && data.user.identities && data.user.identities.length === 0) {
        setMessage('signup', 'error', t('auth.errors.userExists', 'An account with this email already exists — try logging in instead.'));
        return;
      }

      // Save user profile data
      if (data && data.user) {
        const { error: profileError } = await client
          .from('user_profiles')
          .insert({
            user_id: data.user.id,
            nickname: nickname,
            birth_date: birthDate,
            tos_agreed: tosAgreed,
            privacy_agreed: privacyAgreed,
            marketing_agreed: marketingAgreed
          });
        if (profileError) {
          console.error('Profile save error:', profileError);
        }
      }

      setMessage('signup', 'success',
        t('auth.signupSuccess', 'We sent a verification link to {email}. Confirm your email, then log in. Did not get it? Use "Forgot password?" from the log in tab to resend, or check your spam folder.').replace('{email}', email));
      document.getElementById('signupForm').reset();
    });

    /* ---- Reset password ---- */
    document.getElementById('resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessage('reset');
      if (!requireClient('reset')) return;
      const email = document.getElementById('resetEmail').value.trim();
      const btn = document.getElementById('resetSubmit');
      setLoading(btn, true, 'auth.resetSubmit', 'Send reset link');
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT_URL });
      setLoading(btn, false, 'auth.resetSubmit', 'Send reset link');
      if (error) { setMessage('reset', 'error', friendlyError(error)); return; }
      setMessage('reset', 'success', t('auth.resetSuccess', 'If an account exists for {email}, a reset link is on its way.').replace('{email}', email));
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

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }

    function initials(name) {
      return (name || '?').trim().slice(0, 1).toUpperCase();
    }

    // The header shows the name the member chose at signup. Until that
    // row comes back, the part of the address before the @ stands in —
    // better than a flash of the full address, which is not theirs to
    // show to whoever is looking over their shoulder.
    function displayName(user) {
      return (user.email || '').split('@')[0] || '?';
    }

    function renderSignedIn(user) {
      if (!trigger) return;
      const wrap = document.createElement('div');
      wrap.className = 'account-menu';
      wrap.innerHTML = `
        <button type="button" class="account-trigger" id="accountTriggerBtn" aria-haspopup="true" aria-expanded="false">
          <span class="avatar" id="accountAvatar">${esc(initials(displayName(user)))}</span>
          <span class="email" id="accountName">${esc(displayName(user))}</span>
        </button>
        <div class="account-dropdown" id="accountDropdown" hidden>
          <a href="${REDIRECT_URL.endsWith('/my-learning.html') ? 'my-learning.html' : REDIRECT_URL}" data-i18n="auth.myLearning">My Learning</a>
          <button type="button" id="logoutBtn" data-i18n="auth.logout">Log out</button>
        </div>
      `;
      trigger.replaceWith(wrap);
      if (window.DURU_I18N) window.DURU_I18N.apply(wrap);
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

      if (client) {
        client.from('user_profiles').select('nickname').eq('user_id', user.id).maybeSingle()
          .then(({ data }) => {
            const nick = data && data.nickname && data.nickname.trim();
            if (!nick) return;
            const nameEl = wrap.querySelector('#accountName');
            const avatarEl = wrap.querySelector('#accountAvatar');
            if (nameEl) nameEl.textContent = nick;
            if (avatarEl) avatarEl.textContent = initials(nick);
          });
      }

      // Admin-only "Manage Resources" link — verified server-side via the
      // admin_users table's RLS policy, never inferred from the email string.
      if (client) {
        client.from('admin_users').select('user_id').eq('user_id', user.id).maybeSingle()
          .then(({ data }) => {
            if (!data) return;
            const link = document.createElement('a');
            link.href = 'free-resources.html';
            link.setAttribute('data-i18n', 'auth.manageResources');
            link.textContent = t('auth.manageResources', 'Manage Resources');
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
