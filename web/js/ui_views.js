(() => {
  const app = (window.AudioTTo = window.AudioTTo || {});

  function scrollToSection(sectionId) {
    if (!sectionId) return;
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  app.setActivePage = function setActivePage(pageName) {
    const { pages, menuItems, sidebar, burgerBtn, globalSearch } = app.dom;
    if (!pages || pages.length === 0) return;

    app.state.activePage = pageName;

    // Reset search on page change
    if (globalSearch) globalSearch.value = '';

    pages.forEach((page) => {
      page.classList.toggle('hidden', page.dataset.page !== pageName);
    });

    if (menuItems) {
      menuItems.forEach((item) => {
        item.classList.toggle('active', item.dataset.page === pageName);
      });
    }

    if (sidebar && sidebar.classList.contains('open')) sidebar.classList.remove('open');
    if (burgerBtn && burgerBtn.classList.contains('open')) burgerBtn.classList.remove('open');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  app.showLanding = function showLanding(targetSection = '') {
    const { viewLanding, viewAuth, publicNavbar, appShell } = app.dom;

    app.state.publicView = 'landing';
    if (viewLanding) viewLanding.classList.remove('hidden');
    if (viewAuth) viewAuth.classList.add('hidden');
    if (publicNavbar) publicNavbar.classList.remove('hidden');
    if (appShell) appShell.classList.add('hidden');

    if (targetSection) {
      setTimeout(() => scrollToSection(targetSection), 0);
    }
  };

  app.showAuth = function showAuth(mode = 'login') {
    const { viewLanding, viewAuth, publicNavbar, appShell } = app.dom;

    app.state.publicView = 'auth';
    if (viewLanding) viewLanding.classList.add('hidden');
    if (viewAuth) viewAuth.classList.remove('hidden');
    if (publicNavbar) publicNavbar.classList.remove('hidden');
    if (appShell) appShell.classList.add('hidden');

    if (mode === 'signup') {
      if (typeof app.showSignupForm === 'function') app.showSignupForm();
    } else {
      if (typeof app.showLoginForm === 'function') app.showLoginForm();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  app.showApp = function showApp() {
    const { viewLanding, viewAuth, publicNavbar, appShell } = app.dom;

    if (viewLanding) viewLanding.classList.add('hidden');
    if (viewAuth) viewAuth.classList.add('hidden');
    if (publicNavbar) publicNavbar.classList.add('hidden');
    if (appShell) appShell.classList.remove('hidden');
  };

  app.setAuthUI = function setAuthUI(authenticated) {
    const {
      authSection,
      authShell,
      sessionSection,
      sidebar,
      burgerBtn,
      notesPreview,
      notesSource,
      resultsList,
      historyList,
    } = app.dom;

    document.body.classList.toggle('auth-ready', authenticated);
    document.querySelectorAll('.requires-auth').forEach((el) => {
      el.classList.toggle('hidden', !authenticated);
    });

    if (authenticated) {
      app.showApp();
      if (authSection) authSection.classList.add('hidden');
      if (authShell) authShell.classList.add('hidden');
      if (sessionSection) sessionSection.classList.remove('hidden');

      const user = app.getStoredUser();
      if (app.dom.userLabel) {
        app.dom.userLabel.textContent = user ? `Logged in as ${user.username}` : 'Logged in';
      }
      app.setActivePage('dashboard');
    } else {
      if (authSection) authSection.classList.remove('hidden');
      if (authShell) authShell.classList.remove('hidden');
      if (sessionSection) sessionSection.classList.add('hidden');
      if (sidebar) sidebar.classList.remove('open');
      if (burgerBtn) burgerBtn.classList.remove('open');

      if (notesPreview) notesPreview.textContent = 'Generate notes to preview them here.';
      if (notesSource) notesSource.textContent = 'No notes loaded';
      if (resultsList) resultsList.innerHTML = '<div class="empty-state">No notes generated.</div>';
      if (historyList) historyList.innerHTML = '<div class="empty-state">No history yet.</div>';

      if (typeof app.updateStatus === 'function') app.updateStatus('idle');
      if (typeof app.updateProgress === 'function') app.updateProgress(0, 0);

      if (app.state.publicView === 'auth') {
        app.showAuth('login');
      } else {
        app.showLanding();
      }
    }
  };

  app.bindPublicNav = function bindPublicNav() {
    const { navLoginBtn, navSignupBtn, footerLoginBtn, footerSignupBtn, ctaUploadBtn, ctaDemoBtn, publicBrand } = app.dom;

    if (navLoginBtn) navLoginBtn.addEventListener('click', () => app.showAuth('login'));
    if (navSignupBtn) navSignupBtn.addEventListener('click', () => app.showAuth('signup'));
    if (footerLoginBtn) footerLoginBtn.addEventListener('click', () => app.showAuth('login'));
    if (footerSignupBtn) footerSignupBtn.addEventListener('click', () => app.showAuth('signup'));

    if (ctaUploadBtn) {
      ctaUploadBtn.addEventListener('click', () => {
        if (app.getToken()) {
          app.setAuthUI(true);
          app.setActivePage('upload');
        } else {
          app.showAuth('signup');
        }
      });
    }

    if (ctaDemoBtn) {
      ctaDemoBtn.addEventListener('click', () => {
        app.showLanding('features');
        history.replaceState(null, '', '#features');
      });
    }

    if (publicBrand) {
      publicBrand.addEventListener('click', () => {
        app.showLanding('home');
        history.replaceState(null, '', '#home');
      });
    }

    // Make navbar/footer anchor links work even when auth view is open.
    const scrollLinks = Array.from(document.querySelectorAll('[data-scroll]'));
    scrollLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href') || '';
        const sectionId = (href.startsWith('#') ? href.slice(1) : '') || link.dataset.scroll || '';
        if (!sectionId) return;

        e.preventDefault();
        app.showLanding(sectionId);
        history.replaceState(null, '', `#${sectionId}`);
      });
    });
  };

  app.bindAppNav = function bindAppNav() {
    const { burgerBtn, sidebar, menuItems, sidebarLogoutBtn, logoutBtn } = app.dom;

    if (burgerBtn && sidebar) {
      burgerBtn.addEventListener('click', () => {
        if (!app.getToken()) return;
        sidebar.classList.toggle('open');
        burgerBtn.classList.toggle('open');

        if (sidebar.classList.contains('open') && typeof app.loadOutputs === 'function') {
          app.loadOutputs();
        }
      });
    }

    if (menuItems) {
      menuItems.forEach((item) => {
        item.addEventListener('click', () => {
          const page = item.getAttribute('data-page');
          if (page) app.setActivePage(page);
        });
      });
    }

    const runLogout = async () => {
      try {
        await app.authFetch('/logout', { method: 'POST' });
      } catch (_) {
        // ignore
      } finally {
        app.clearSession();
        app.setAuthUI(false);
        app.showToast('Logged out', 'success');
      }
    };

    if (logoutBtn) logoutBtn.addEventListener('click', runLogout);
    if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', runLogout);
  };

  app.bindSearch = function bindSearch() {
    const { globalSearch } = app.dom;
    if (!globalSearch) return;

    globalSearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const activePage = app.state.activePage || 'dashboard';

      let targets = [];
      if (activePage === 'dashboard') {
        targets = Array.from(document.querySelectorAll('#recent-uploads .table-row:not(.table-head)'));
      } else if (activePage === 'history') {
        targets = Array.from(document.querySelectorAll('#history-list .table-row:not(.table-head)'));
      } else if (activePage === 'saved') {
        targets = Array.from(document.querySelectorAll('#results-list .result-item'));
      }

      targets.forEach((el) => {
        const text = el.textContent.toLowerCase();
        if (text.includes(query)) {
          el.style.display = '';
          el.classList.remove('hidden');
        } else {
          el.style.display = 'none';
          el.classList.add('hidden');
        }
      });

      // Show empty state if everything filtered out
      const containerId = activePage === 'dashboard' ? 'recent-uploads' : (activePage === 'history' ? 'history-list' : 'results-list');
      const container = document.getElementById(containerId);
      if (container) {
        const visible = targets.filter(t => !t.classList.contains('hidden')).length;
        let emptyMsg = container.querySelector('.search-empty-msg');
        
        if (visible === 0 && query !== '') {
          if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.className = 'empty-state search-empty-msg';
            emptyMsg.style.padding = '2rem';
            emptyMsg.textContent = `No results found for "${query}"`;
            container.appendChild(emptyMsg);
          } else {
            emptyMsg.textContent = `No results found for "${query}"`;
          }
        } else if (emptyMsg) {
          emptyMsg.remove();
        }
      }
    });
  };
})();
