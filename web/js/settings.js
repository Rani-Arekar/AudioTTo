(() => {
  const app = (window.AudioTTo = window.AudioTTo || {});

  const THEME_KEY = 'audiotto_theme';
  let modalMouseDownTarget = null;
  let threadsModalMouseDownTarget = null;

  // ── Theme management ─────────────────────────────────────────────────────

  app.applyTheme = function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      // System: use prefers-color-scheme
      root.removeAttribute('data-theme');
    }
  };

  app.loadTheme = function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'system';
    app.applyTheme(saved);
    // Sync selector UI if present
    const selector = document.getElementById('theme-selector');
    if (selector) selector.value = saved;
    const segs = document.querySelectorAll('.theme-seg');
    segs.forEach((s) => s.classList.toggle('active', s.dataset.theme === saved));
  };

  app.setTheme = function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    app.applyTheme(theme);
    const segs = document.querySelectorAll('.theme-seg');
    segs.forEach((s) => s.classList.toggle('active', s.dataset.theme === theme));
  };

  app.bindThemeSelector = function bindThemeSelector() {
    document.querySelectorAll('.theme-seg').forEach((btn) => {
      btn.addEventListener('click', () => app.setTheme(btn.dataset.theme));
    });
  };

  app.getKeyStatus = async function getKeyStatus() {
    const res = await app.authFetch('/api/key-status');
    return await res.json();
  };

  app.checkKeyStatus = async function checkKeyStatus() {
    const { keyStatus, apiKeyInput } = app.dom;
    const settingsStatus = document.getElementById('settings-key-status');
    const resetBtn = document.getElementById('reset-key-btn');

    try {
      const data = await app.getKeyStatus();
      const statusText = data.is_set ? 'API Key is set ✅' : 'API Key missing ❌';
      const statusClass = data.is_set ? 'key-status set' : 'key-status missing';

      if (keyStatus) {
        keyStatus.textContent = statusText;
        keyStatus.className = statusClass;
      }
      if (settingsStatus) {
        settingsStatus.textContent = statusText;
        settingsStatus.className = statusClass;
      }
      if (apiKeyInput && data.is_set) {
        apiKeyInput.placeholder = '••••••••••••••••';
      }
      if (resetBtn) {
        resetBtn.classList.toggle('hidden', !data.is_set);
      }
    } catch (_) {
      const expiredText = 'Session expired';
      if (keyStatus) {
        keyStatus.textContent = expiredText;
        keyStatus.className = 'key-status missing';
      }
      if (settingsStatus) {
        settingsStatus.textContent = expiredText;
        settingsStatus.className = 'key-status missing';
      }
    }
  };

  function updateToggleVisibility() {
    const { apiKeyInput, toggleKeyBtn } = app.dom;
    if (!apiKeyInput || !toggleKeyBtn) return;

    if (apiKeyInput.value.length > 0) {
      toggleKeyBtn.classList.add('visible');
    } else {
      toggleKeyBtn.classList.remove('visible');
      apiKeyInput.setAttribute('type', 'password');
      updateToggleIcon('password');
    }
  }

  function updateToggleIcon(type) {
    const { toggleKeyBtn } = app.dom;
    if (!toggleKeyBtn) return;

    if (type === 'text') {
      toggleKeyBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
    } else {
      toggleKeyBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    }
  }

  app.openSettingsModal = function openSettingsModal() {
    const { settingsModal } = app.dom;
    if (!settingsModal) return;

    settingsModal.classList.remove('hidden');
    app.checkKeyStatus();
  };

  app.closeSettingsModal = function closeSettingsModal() {
    const { settingsModal } = app.dom;
    if (!settingsModal) return;

    settingsModal.classList.add('hidden');
  };

  app.openThreadsModal = function openThreadsModal() {
    const { threadsModal } = app.dom;
    if (!threadsModal) return;

    threadsModal.classList.remove('hidden');
  };

  app.closeThreadsModal = function closeThreadsModal() {
    const { threadsModal } = app.dom;
    if (!threadsModal) return;

    threadsModal.classList.add('hidden');
  };

  app.initThreadsInfo = async function initThreadsInfo() {
    const { threadsSlider, threadsDisplay, maxCpuDisplay } = app.dom;
    if (!threadsSlider || !threadsDisplay || !maxCpuDisplay) return;

    try {
      const res = await app.authFetch('/api/info');
      const data = await res.json();

      const cpuCount = data.cpu_count || 4;
      const saved = data.saved_threads || 4;

      let maxThreads = Math.max(1, cpuCount - 1);
      if (cpuCount <= 1) maxThreads = 1;

      threadsSlider.max = String(maxThreads);
      threadsSlider.value = String(Math.min(saved, maxThreads));

      maxCpuDisplay.textContent = String(maxThreads);
      threadsDisplay.textContent = threadsSlider.value;
      app.state.currentThreads = parseInt(threadsSlider.value, 10);
    } catch (_) {
      // Silent fallback.
    }
  };

  app.bindSettings = function bindSettings() {
    const {
      settingsBtn,
      settingsModal,
      closeModalBtn,
      apiKeyInput,
      saveKeyBtn,
      toggleKeyBtn,
      threadConfigBtn,
      threadsModal,
      closeThreadsBtn,
      saveThreadsBtn,
      threadsSlider,
      threadsDisplay,
      openKeySettingsBtn,
      openThreadsSettingsBtn,
    } = app.dom;

    if (settingsBtn) settingsBtn.addEventListener('click', app.openSettingsModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', app.closeSettingsModal);

    if (openKeySettingsBtn) openKeySettingsBtn.addEventListener('click', app.openSettingsModal);

    // Dark mode toggle (legacy - keep for compatibility, prefer theme-seg)
    const darkToggle = document.getElementById('darkmode-toggle');
    if (darkToggle) {
      const saved = localStorage.getItem(THEME_KEY) || 'system';
      darkToggle.checked = saved === 'dark';
      darkToggle.addEventListener('change', () => {
        app.setTheme(darkToggle.checked ? 'dark' : 'light');
      });
    }

    app.bindThemeSelector();

    if (settingsModal) {
      settingsModal.addEventListener('mousedown', (e) => {
        modalMouseDownTarget = e.target;
      });
      settingsModal.addEventListener('mouseup', (e) => {
        if (e.target === settingsModal && modalMouseDownTarget === settingsModal) {
          app.closeSettingsModal();
        }
        modalMouseDownTarget = null;
      });
    }

    if (apiKeyInput) apiKeyInput.addEventListener('input', updateToggleVisibility);
    if (toggleKeyBtn && apiKeyInput) {
      toggleKeyBtn.addEventListener('click', () => {
        const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
        apiKeyInput.setAttribute('type', type);
        updateToggleIcon(type);
      });
    }

    if (saveKeyBtn && apiKeyInput) {
      saveKeyBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
          app.showToast('Please enter an API Key.', 'error');
          return;
        }

        saveKeyBtn.disabled = true;
        saveKeyBtn.textContent = 'Saving...';

        try {
          const res = await app.authFetch('/api/key', {
            method: 'POST',
            body: JSON.stringify({ api_key: key }),
          });

          if (res.ok) {
            app.showToast('API Key saved successfully!', 'success');
            apiKeyInput.value = '';
            updateToggleVisibility();
            await app.checkKeyStatus();
            app.closeSettingsModal();
          } else {
            app.showToast('Error saving API Key.', 'error');
          }
        } catch (_) {
          app.showToast('Error saving API Key.', 'error');
        } finally {
          saveKeyBtn.disabled = false;
          saveKeyBtn.textContent = 'Save';
        }
      });
    }

    const resetBtn = document.getElementById('reset-key-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to reset the API Key?')) return;

        try {
          const res = await app.authFetch('/api/key', {
            method: 'POST',
            body: JSON.stringify({ api_key: 'RESET' }), // We'll handle 'RESET' in backend or just empty string
          });

          if (res.ok) {
            app.showToast('API Key reset.', 'success');
            await app.checkKeyStatus();
          }
        } catch (_) {
          app.showToast('Error resetting API Key.', 'error');
        }
      });
    }

    if (threadConfigBtn) threadConfigBtn.addEventListener('click', app.openThreadsModal);
    if (closeThreadsBtn) closeThreadsBtn.addEventListener('click', app.closeThreadsModal);

    if (openThreadsSettingsBtn) openThreadsSettingsBtn.addEventListener('click', app.openThreadsModal);

    if (threadsModal) {
      threadsModal.addEventListener('mousedown', (e) => {
        threadsModalMouseDownTarget = e.target;
      });
      threadsModal.addEventListener('mouseup', (e) => {
        if (e.target === threadsModal && threadsModalMouseDownTarget === threadsModal) {
          app.closeThreadsModal();
        }
        threadsModalMouseDownTarget = null;
      });
    }

    if (threadsSlider && threadsDisplay) {
      threadsSlider.addEventListener('input', () => {
        threadsDisplay.textContent = threadsSlider.value;
      });
    }

    if (saveThreadsBtn && threadsSlider) {
      saveThreadsBtn.addEventListener('click', async () => {
        const val = parseInt(threadsSlider.value, 10);
        saveThreadsBtn.disabled = true;
        saveThreadsBtn.textContent = 'Saving...';

        try {
          const res = await app.authFetch('/api/save-threads', {
            method: 'POST',
            body: JSON.stringify({ threads: val }),
          });
          if (res.ok) {
            app.state.currentThreads = val;
            app.showToast(`Threads set to ${val}`, 'success');
            app.closeThreadsModal();
          } else {
            app.showToast('Error saving configuration', 'error');
          }
        } catch (_) {
          app.showToast('Error saving configuration', 'error');
        } finally {
          saveThreadsBtn.disabled = false;
          saveThreadsBtn.textContent = 'Save';
        }
      });
    }
  };
})();
