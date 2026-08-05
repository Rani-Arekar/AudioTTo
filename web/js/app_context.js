(() => {
  const app = (window.AudioTTo = window.AudioTTo || {});

  app.config = {
    TOKEN_KEY: 'audiotto_token',
    USER_KEY: 'audiotto_user',
  };

  app.state = {
    audioFile: null,
    videoFile: null,
    pdfFile: null,
    youtubeUrl: '',
    ws: null,
    isProcessing: false,
    latestOutputLoaded: false,
    currentThreads: 4,
    publicView: 'landing',
    activePage: 'dashboard',
  };

  app.dom = {};

  app.initDom = function initDom() {
    const dom = (app.dom = {});

    dom.viewLanding = document.getElementById('view-landing');
    dom.viewAuth = document.getElementById('view-auth');
    dom.publicNavbar = document.getElementById('public-navbar');
    dom.appShell = document.getElementById('app-shell');

    dom.navLoginBtn = document.getElementById('nav-login');
    dom.navSignupBtn = document.getElementById('nav-signup');
    dom.footerLoginBtn = document.getElementById('footer-login');
    dom.footerSignupBtn = document.getElementById('footer-signup');
    dom.ctaUploadBtn = document.getElementById('cta-upload');
    dom.ctaDemoBtn = document.getElementById('cta-demo');

    dom.publicBrand = document.querySelector('#public-navbar .brand');

    dom.lectureDropZone = document.getElementById('lecture-drop-zone');
    dom.audioDropZone = document.getElementById('browse-audio') || document.getElementById('audio-drop-zone');
    dom.videoDropZone = document.getElementById('browse-video') || document.getElementById('video-drop-zone');
    dom.pdfDropZone = document.getElementById('browse-pdf') || document.getElementById('pdf-drop-zone');

    dom.youtubeInput = document.getElementById('youtube-input');

    dom.audioInput = document.getElementById('audio-input');
    dom.videoInput = document.getElementById('video-input');
    dom.pdfInput = document.getElementById('pdf-input');
    dom.startBtn = document.getElementById('start-btn');
    dom.pagesInput = document.getElementById('pages-input');

    dom.audioFileInfo = document.getElementById('audio-file-info');
    dom.videoFileInfo = document.getElementById('video-file-info');
    dom.pdfFileInfo = document.getElementById('pdf-file-info');

    dom.terminalWindow = document.getElementById('terminal-window');
    dom.statusIndicator = document.getElementById('status-indicator');

    dom.resultsList = document.getElementById('results-list');
    dom.historyList = document.getElementById('history-list');

    dom.notesPreview = document.getElementById('notes-preview');
    dom.notesSource = document.getElementById('notes-source');

    dom.burgerBtn = document.getElementById('burger-btn');
    dom.sidebar =
      document.getElementById('sidebar-left') ||
      document.querySelector('.sidebar-left') ||
      document.querySelector('.sidebar');

    dom.authShell = document.getElementById('auth-shell');
    dom.globalSearch = document.getElementById('global-search');
    dom.statusPill = document.getElementById('status-pill');

    dom.progressFill = document.getElementById('progress-fill');
    dom.progressLabel = document.getElementById('progress-label');
    dom.progressSteps = Array.from(document.querySelectorAll('#progress-steps .step'));

    dom.terminalSection = document.getElementById('terminal-section');
    dom.terminalToggleBtn = document.getElementById('terminal-toggle');

    dom.menuItems = Array.from(document.querySelectorAll('.sidebar-menu .menu-item[data-page]'));
    dom.pages = Array.from(document.querySelectorAll('.page-host .page[data-page]'));

    dom.sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');

    dom.settingsBtn = document.getElementById('settings-btn');
    dom.settingsModal = document.getElementById('settings-modal');
    dom.closeModalBtn = document.getElementById('close-modal-btn');
    dom.apiKeyInput = document.getElementById('api-key-input');
    dom.saveKeyBtn = document.getElementById('save-key-btn');
    dom.keyStatus = document.getElementById('key-status');
    dom.toggleKeyBtn = document.getElementById('toggle-key-visibility');

    dom.threadConfigBtn = document.getElementById('thread-config-btn');
    dom.threadsModal = document.getElementById('threads-modal');
    dom.closeThreadsBtn = document.getElementById('close-threads-btn');
    dom.saveThreadsBtn = document.getElementById('save-threads-btn');
    dom.threadsSlider = document.getElementById('threads-slider');
    dom.threadsDisplay = document.getElementById('threads-value-display');
    dom.maxCpuDisplay = document.getElementById('max-cpu-display');

    dom.authSection = document.getElementById('auth-section');
    dom.sessionSection = document.getElementById('session-section');
    dom.userLabel = document.getElementById('user-label');
    dom.logoutBtn = document.getElementById('logout-btn');

    dom.loginTab = document.getElementById('login-tab');
    dom.signupTab = document.getElementById('signup-tab');
    dom.loginForm = document.getElementById('login-form');
    dom.signupForm = document.getElementById('signup-form');

    dom.loginEyeBtn = document.getElementById('login-eye-btn');
    dom.signupEyeBtn = document.getElementById('signup-eye-btn');
    dom.loginPassword = document.getElementById('login-password');
    dom.signupPassword = document.getElementById('signup-password');

    dom.openKeySettingsBtn = document.getElementById('open-key-settings');
    dom.openThreadsSettingsBtn = document.getElementById('open-threads-settings');
  };

  app.getToken = function getToken() {
    return localStorage.getItem(app.config.TOKEN_KEY) || '';
  };

  app.getStoredUser = function getStoredUser() {
    const raw = localStorage.getItem(app.config.USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };

  app.setSession = function setSession(token, user) {
    localStorage.setItem(app.config.TOKEN_KEY, token);
    localStorage.setItem(app.config.USER_KEY, JSON.stringify(user));
  };

  app.clearSession = function clearSession() {
    localStorage.removeItem(app.config.TOKEN_KEY);
    localStorage.removeItem(app.config.USER_KEY);
  };

  app.showToast = function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const safeMessage = (() => {
      if (message === null || message === undefined) return '';
      if (typeof message === 'string') return message;
      if (message instanceof Error) return message.message || String(message);
      if (typeof message === 'object') {
        if (typeof message.message === 'string') return message.message;
        if (typeof message.detail === 'string') return message.detail;
        try {
          return JSON.stringify(message);
        } catch (_) {
          return String(message);
        }
      }
      return String(message);
    })();

    const existingToasts = container.querySelectorAll('.toast');
    for (const t of existingToasts) {
      if (t.innerText.includes(safeMessage)) return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'error') icon = '⚠️';
    if (type === 'success') icon = '✅';

    toast.innerHTML = `<span>${icon}</span> <span>${safeMessage}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      toast.addEventListener('animationend', () => {
        if (toast.parentElement) toast.remove();
      });
    }, 3000);
  };

  app.authFetch = async function authFetch(url, options = {}) {
    const token = app.getToken();
    const headers = new Headers(options.headers || {});

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      app.clearSession();
      if (typeof app.setAuthUI === 'function') {
        app.setAuthUI(false);
      }
      app.showToast('Session expired. Please login again.', 'error');
      throw new Error('Unauthorized');
    }

    return response;
  };
})();
