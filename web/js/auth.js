(() => {
  const app = (window.AudioTTo = window.AudioTTo || {});

  app.showLoginForm = function showLoginForm() {
    const { loginTab, signupTab, loginForm, signupForm } = app.dom;
    if (loginTab) loginTab.classList.add('active');
    if (signupTab) signupTab.classList.remove('active');
    if (loginForm) loginForm.classList.remove('hidden');
    if (signupForm) signupForm.classList.add('hidden');
  };

  app.showSignupForm = function showSignupForm() {
    const { loginTab, signupTab, loginForm, signupForm } = app.dom;
    if (signupTab) signupTab.classList.add('active');
    if (loginTab) loginTab.classList.remove('active');
    if (signupForm) signupForm.classList.remove('hidden');
    if (loginForm) loginForm.classList.add('hidden');
  };

  function formatAuthError(detail, fallbackMessage = 'Authentication failed') {
    if (!detail) return fallbackMessage;

    if (typeof detail === 'string') return detail;

    if (Array.isArray(detail)) {
      const parts = detail
        .map((item) => {
          if (!item) return '';
          if (typeof item === 'string') return item;
          const field = Array.isArray(item.loc) ? item.loc.filter(Boolean).join('.') : '';
          const message = item.msg || item.message || item.detail || '';
          return [field, message].filter(Boolean).join(': ');
        })
        .filter(Boolean);
      return parts.length ? parts.join(' | ') : fallbackMessage;
    }

    if (typeof detail === 'object') {
      if (detail.message) return String(detail.message);
      if (detail.msg) return String(detail.msg);
      return JSON.stringify(detail);
    }

    return String(detail);
  }

  async function handleAuthSubmit(endpoint, username, password) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      if (!res.ok) {
        const txt = await res.text().catch(() => 'Authentication failed');
        throw new Error(txt || 'Authentication failed');
      }
      data = {};
    }

    if (!res.ok) {
      throw new Error(formatAuthError(data && data.detail));
    }

    app.setSession(data.access_token, data.user);
    app.setAuthUI(true);

    // Keep auth success separate from post-login dashboard initialization.
    // If a secondary fetch fails, the account is still created and the session remains valid.
    afterLoginInit().catch((err) => {
      console.warn('Post-auth initialization failed:', err);
    });
  }

  async function afterLoginInit() {
    if (typeof app.initThreadsInfo === 'function') {
      await app.initThreadsInfo();
    }
    if (typeof app.loadOutputs === 'function') {
      await app.loadOutputs();
    }
    if (typeof app.loadHistory === 'function') {
      await app.loadHistory();
    }
  }

  app.validateSession = async function validateSession() {
    const token = app.getToken();
    if (!token) {
      app.setAuthUI(false);
      return;
    }

    try {
      const res = await app.authFetch('/me');
      if (!res.ok) throw new Error('Invalid token');
      const user = await res.json();
      app.setSession(token, user);
      app.setAuthUI(true);

      afterLoginInit().catch((err) => {
        console.warn('Post-auth initialization failed:', err);
      });
    } catch (_) {
      app.clearSession();
      app.setAuthUI(false);
    }
  };

  function bindPasswordEye(buttonEl, inputEl) {
    if (!buttonEl || !inputEl) return;
    buttonEl.addEventListener('click', () => {
      const type = inputEl.getAttribute('type') === 'password' ? 'text' : 'password';
      inputEl.setAttribute('type', type);
    });
  }

  app.bindAuth = function bindAuth() {
    const { loginTab, signupTab, loginForm, signupForm } = app.dom;

    if (loginTab) loginTab.addEventListener('click', app.showLoginForm);
    if (signupTab) signupTab.addEventListener('click', app.showSignupForm);

    bindPasswordEye(app.dom.loginEyeBtn, app.dom.loginPassword);
    bindPasswordEye(app.dom.signupEyeBtn, app.dom.signupPassword);

    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        if (!username || !password) {
          app.showToast('Username and password are required.', 'error');
          return;
        }

        try {
          await handleAuthSubmit('/login', username, password);
          app.showToast('Login successful!', 'success');
          loginForm.reset();
        } catch (err) {
          app.showToast(err.message || String(err), 'error');
        }
      });
    }

    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value.trim();
        const password = document.getElementById('signup-password').value;

        if (!username || !password) {
          app.showToast('Username and password are required.', 'error');
          return;
        }

        try {
          await handleAuthSubmit('/signup', username, password);
          app.showToast('Account created successfully!', 'success');
          signupForm.reset();
        } catch (err) {
          app.showToast(err.message || String(err), 'error');
        }
      });
    }
  };
})();
