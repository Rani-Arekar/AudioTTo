document.addEventListener('DOMContentLoaded', () => {
    const TOKEN_KEY = 'audiotto_token';
    const USER_KEY = 'audiotto_user';

    const viewLanding = document.getElementById('view-landing');
    const viewAuth = document.getElementById('view-auth');
    const publicNavbar = document.getElementById('public-navbar');
    const appShell = document.getElementById('app-shell');

    const navLoginBtn = document.getElementById('nav-login');
    const navSignupBtn = document.getElementById('nav-signup');
    const footerLoginBtn = document.getElementById('footer-login');
    const footerSignupBtn = document.getElementById('footer-signup');
    const ctaUploadBtn = document.getElementById('cta-upload');
    const ctaDemoBtn = document.getElementById('cta-demo');

    const lectureDropZone = document.getElementById('lecture-drop-zone');
    const audioDropZone = document.getElementById('browse-audio') || document.getElementById('audio-drop-zone');
    const videoDropZone = document.getElementById('browse-video') || document.getElementById('video-drop-zone');
    const pdfDropZone = document.getElementById('browse-pdf') || document.getElementById('pdf-drop-zone');
    const audioInput = document.getElementById('audio-input');
    const videoInput = document.getElementById('video-input');
    const pdfInput = document.getElementById('pdf-input');
    const startBtn = document.getElementById('start-btn');
    const pagesInput = document.getElementById('pages-input');
    const terminalWindow = document.getElementById('terminal-window');
    const statusIndicator = document.getElementById('status-indicator');
    const resultsList = document.getElementById('results-list');
    const historyList = document.getElementById('history-list');
    const notesPreview = document.getElementById('notes-preview');
    const notesSource = document.getElementById('notes-source');
    const burgerBtn = document.getElementById('burger-btn');
    const sidebar = document.getElementById('sidebar-left') || document.querySelector('.sidebar-left') || document.querySelector('.sidebar');
    const authShell = document.getElementById('auth-shell');
    const statusPill = document.getElementById('status-pill');
    const progressFill = document.getElementById('progress-fill');
    const progressLabel = document.getElementById('progress-label');
    const progressSteps = Array.from(document.querySelectorAll('#progress-steps .step'));
    const terminalSection = document.getElementById('terminal-section');
    const terminalToggleBtn = document.getElementById('terminal-toggle');
    const sideLinks = Array.from(document.querySelectorAll('.sidebar-menu .menu-item[data-page]'));
    const sidebarLogoutBtn = document.getElementById('sidebar-logout-btn');

    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keyStatus = document.getElementById('key-status');
    const toggleKeyBtn = document.getElementById('toggle-key-visibility');

    const threadConfigBtn = document.getElementById('thread-config-btn');
    const threadsModal = document.getElementById('threads-modal');
    const closeThreadsBtn = document.getElementById('close-threads-btn');
    const saveThreadsBtn = document.getElementById('save-threads-btn');
    const threadsSlider = document.getElementById('threads-slider');
    const threadsDisplay = document.getElementById('threads-value-display');
    const maxCpuDisplay = document.getElementById('max-cpu-display');

    const authSection = document.getElementById('auth-section');
    const sessionSection = document.getElementById('session-section');
    const userLabel = document.getElementById('user-label');
    const logoutBtn = document.getElementById('logout-btn');
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const authBackBtn = document.getElementById('auth-back-btn');

    let audioFile = null;
    let videoFile = null;
    let pdfFile = null;
    let ws = null;
    let isProcessing = false;
    let latestOutputLoaded = false;
    let currentThreads = 4;

    let publicView = 'landing';

    function setBodyView(view) {
        document.body.dataset.view = view;
    }

    function showLandingView(sectionId) {
        if (!sectionId) return;

        // Ensure landing is visible
        if (publicView !== 'landing') {
            showLanding();
        }

        const target = document.getElementById(sectionId);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', `#${sectionId}`);
    }

    const pages = Array.from(document.querySelectorAll('.page-host .page[data-page]'));
    const menuItems = Array.from(document.querySelectorAll('.sidebar-menu .menu-item[data-page]'));

    function setActivePage(pageName) {
        if (!pages.length) return;

        pages.forEach((page) => {
            page.classList.toggle('hidden', page.dataset.page !== pageName);
        });

        menuItems.forEach((item) => {
            item.classList.toggle('active', item.dataset.page === pageName);
        });

        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
        if (burgerBtn && burgerBtn.classList.contains('open')) {
            burgerBtn.classList.remove('open');
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showLanding() {
        publicView = 'landing';
        setBodyView('landing');
        if (viewLanding) viewLanding.classList.remove('hidden');
        if (viewAuth) viewAuth.classList.add('hidden');
        if (publicNavbar) publicNavbar.classList.remove('hidden');
    }

    function showAuth(mode = 'login') {
        publicView = 'auth';
        setBodyView('auth');
        if (viewLanding) viewLanding.classList.add('hidden');
        if (viewAuth) viewAuth.classList.remove('hidden');
        if (publicNavbar) publicNavbar.classList.remove('hidden');
        if (mode === 'signup') {
            showSignupForm();
        } else {
            showLoginForm();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function showApp() {
        setBodyView('app');
        if (viewLanding) viewLanding.classList.add('hidden');
        if (viewAuth) viewAuth.classList.add('hidden');
        if (publicNavbar) publicNavbar.classList.add('hidden');
        if (appShell) appShell.classList.remove('hidden');
    }

    function getToken() {
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    function getStoredUser() {
        const raw = localStorage.getItem(USER_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function setSession(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    }

    function setAuthUI(authenticated) {
        document.body.classList.toggle('auth-ready', authenticated);
        document.querySelectorAll('.requires-auth').forEach((el) => {
            if (authenticated) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        if (authenticated) {
            showApp();
            if (authSection) authSection.classList.add('hidden');
            if (authShell) authShell.classList.add('hidden');
            if (sessionSection) sessionSection.classList.remove('hidden');
            const user = getStoredUser();
            if (userLabel) userLabel.textContent = user ? `Logged in as ${user.username}` : 'Logged in';
            setActivePage('dashboard');
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
            updateStatus('idle');
            updateProgress(0, 0);

            if (publicView === 'auth') {
                showAuth('login');
            } else {
                showLanding();
            }
        }
    }

    function updateStatus(state) {
        if (state === 'processing') {
            statusIndicator.textContent = 'Processing';
            statusIndicator.style.color = '#38bdf8';
            if (statusPill) {
                statusPill.textContent = 'Processing';
                statusPill.className = 'status-pill processing';
            }
        } else if (state === 'completed') {
            statusIndicator.textContent = 'Completed';
            statusIndicator.style.color = '#10b981';
            if (statusPill) {
                statusPill.textContent = 'Completed';
                statusPill.className = 'status-pill completed';
            }
        } else if (state === 'error') {
            statusIndicator.textContent = 'Error';
            statusIndicator.style.color = '#ef4444';
            if (statusPill) {
                statusPill.textContent = 'Error';
                statusPill.className = 'status-pill error';
            }
        } else {
            statusIndicator.textContent = 'Waiting...';
            statusIndicator.style.color = '#94a3b8';
            if (statusPill) {
                statusPill.textContent = 'Idle';
                statusPill.className = 'status-pill';
            }
        }
    }

    function updateProgress(percent, stepIndex = 0) {
        if (progressFill) {
            progressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        }
        if (progressLabel) {
            progressLabel.textContent = `${Math.min(100, Math.max(0, percent))}%`;
        }
        progressSteps.forEach((step, index) => {
            step.classList.toggle('active', index <= stepIndex);
        });
    }

    async function authFetch(url, options = {}) {
        const token = getToken();
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
            clearSession();
            setAuthUI(false);
            showToast('Session expired. Please login again.', 'error');
            throw new Error('Unauthorized');
        }

        return response;
    }

    async function validateSession() {
        const token = getToken();
        if (!token) {
            setAuthUI(false);
            return;
        }

        try {
            const res = await authFetch('/me');
            if (!res.ok) {
                let msg = 'Invalid token';
                try {
                    const err = await res.json();
                    msg = err && err.detail ? err.detail : JSON.stringify(err);
                } catch (_) {
                    try { msg = await res.text(); } catch (_) {}
                }
                throw new Error(msg);
            }

            const user = await res.json();
            setSession(token, user);
            setAuthUI(true);
            await afterLoginInit();
        } catch (_) {
            clearSession();
            setAuthUI(false);
        }
    }

    async function afterLoginInit() {
        await initThreadsInfo();
        await loadOutputs();
        await loadHistory();
    }

    function showLoginForm() {
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        loginForm.classList.remove('hidden');
        signupForm.classList.add('hidden');
    }

    function showSignupForm() {
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
        signupForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    }

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
            // Non-JSON response (e.g. plain text or HTML). We'll fallback to text for errors.
            if (!res.ok) {
                const txt = await res.text().catch(() => 'Authentication failed');
                throw new Error(txt || 'Authentication failed');
            }
            data = {};
        }

        if (!res.ok) {
            throw new Error(formatAuthError(data && data.detail));
        }

        setSession(data.access_token, data.user);
        setAuthUI(true);
        await afterLoginInit();
    }

    loginTab.addEventListener('click', showLoginForm);
    signupTab.addEventListener('click', showSignupForm);

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        if (!username || !password) {
            showToast('Username and password are required.', 'error');
            return;
        }

        try {
            await handleAuthSubmit('/login', username, password);
            showToast('Login successful!', 'success');
            loginForm.reset();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value.trim();
        const password = document.getElementById('signup-password').value;

        if (!username || !password) {
            showToast('Username and password are required.', 'error');
            return;
        }

        try {
            await handleAuthSubmit('/signup', username, password);
            showToast('Account created successfully!', 'success');
            signupForm.reset();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    async function runLogout() {
        try {
            await authFetch('/logout', { method: 'POST' });
        } catch (_) {
            // Ignore server-side logout errors for stateless JWT.
        }

        clearSession();
        setAuthUI(false);
        showLoginForm();
        showToast('Logged out.', 'success');
    }

    logoutBtn.addEventListener('click', runLogout);
    if (sidebarLogoutBtn) sidebarLogoutBtn.addEventListener('click', runLogout);

    if (burgerBtn && sidebar) {
        burgerBtn.addEventListener('click', () => {
            if (!getToken()) return;
            sidebar.classList.toggle('open');
            burgerBtn.classList.toggle('open');

            if (sidebar.classList.contains('open')) {
                loadOutputs();
            }
        });
    }

    sideLinks.forEach((link) => {
        link.addEventListener('click', () => {
            const page = link.getAttribute('data-page');
            if (page) setActivePage(page);
        });
    });

    if (navLoginBtn) navLoginBtn.addEventListener('click', () => showAuth('login'));
    if (navSignupBtn) navSignupBtn.addEventListener('click', () => showAuth('signup'));
    if (footerLoginBtn) footerLoginBtn.addEventListener('click', () => showAuth('login'));
    if (footerSignupBtn) footerSignupBtn.addEventListener('click', () => showAuth('signup'));

    // Smooth-scroll internal landing links (works whether body or a container is scrolling)
    const scrollLinks = Array.from(document.querySelectorAll('a[data-scroll]'));
    scrollLinks.forEach((link) => {
        link.addEventListener('click', (e) => {
            const href = link.getAttribute('href') || '';
            const targetId = (href.startsWith('#') ? href.slice(1) : link.dataset.scroll) || '';
            if (!targetId) return;
            e.preventDefault();
            showLandingView(targetId);
        });
    });

    if (ctaUploadBtn) {
        ctaUploadBtn.addEventListener('click', () => {
            if (getToken()) {
                setAuthUI(true);
                setActivePage('upload');
            } else {
                showAuth('signup');
            }
        });
    }

    if (ctaDemoBtn) {
        ctaDemoBtn.addEventListener('click', () => {
            showLandingView('features');
            history.replaceState(null, '', '#features');
        });
    }

    if (terminalToggleBtn && terminalSection) {
        terminalToggleBtn.addEventListener('click', () => {
            terminalSection.classList.toggle('collapsed');
            terminalToggleBtn.textContent = terminalSection.classList.contains('collapsed') ? 'Expand' : 'Collapse';
        });
    }

    function openModal() {
        settingsModal.classList.remove('hidden');
        checkKeyStatus();
    }

    function closeModal() {
        settingsModal.classList.add('hidden');
    }

    settingsBtn.addEventListener('click', openModal);
    closeModalBtn.addEventListener('click', closeModal);

    let modalMouseDownTarget = null;
    settingsModal.addEventListener('mousedown', (e) => {
        modalMouseDownTarget = e.target;
    });
    settingsModal.addEventListener('mouseup', (e) => {
        if (e.target === settingsModal && modalMouseDownTarget === settingsModal) {
            closeModal();
        }
        modalMouseDownTarget = null;
    });

    function updateToggleVisibility() {
        if (apiKeyInput.value.length > 0) {
            toggleKeyBtn.classList.add('visible');
        } else {
            toggleKeyBtn.classList.remove('visible');
            apiKeyInput.setAttribute('type', 'password');
            updateToggleIcon('password');
        }
    }

    function updateToggleIcon(type) {
        if (type === 'text') {
            toggleKeyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        } else {
            toggleKeyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-eye"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        }
    }

    apiKeyInput.addEventListener('input', updateToggleVisibility);
    toggleKeyBtn.addEventListener('click', () => {
        const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
        apiKeyInput.setAttribute('type', type);
        updateToggleIcon(type);
    });

    async function getKeyStatus() {
        const res = await authFetch('/api/key-status');
        return await res.json();
    }

    async function checkKeyStatus() {
        try {
            const data = await getKeyStatus();
            if (data.is_set) {
                keyStatus.textContent = 'API Key is set ✅';
                keyStatus.className = 'key-status set';
                apiKeyInput.placeholder = '••••••••••••••••';
            } else {
                keyStatus.textContent = 'API Key missing ❌';
                keyStatus.className = 'key-status missing';
            }
        } catch (_) {
            keyStatus.textContent = 'Session expired';
            keyStatus.className = 'key-status missing';
        }
    }

    saveKeyBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            showToast('Please enter an API Key.', 'error');
            return;
        }

        saveKeyBtn.disabled = true;
        saveKeyBtn.textContent = 'Saving...';

        try {
            const res = await authFetch('/api/key', {
                method: 'POST',
                body: JSON.stringify({ api_key: key }),
            });

            if (res.ok) {
                showToast('API Key saved successfully!', 'success');
                apiKeyInput.value = '';
                updateToggleVisibility();
                checkKeyStatus();
                closeModal();
            } else {
                showToast('Error saving API Key.', 'error');
            }
        } catch (_) {
            showToast('Error saving API Key.', 'error');
        } finally {
            saveKeyBtn.disabled = false;
            saveKeyBtn.textContent = 'Save';
        }
    });

    function openThreadsModal() {
        threadsModal.classList.remove('hidden');
    }

    function closeThreadsModal() {
        threadsModal.classList.add('hidden');
    }

    threadConfigBtn.addEventListener('click', openThreadsModal);
    closeThreadsBtn.addEventListener('click', closeThreadsModal);

    let threadsModalMouseDownTarget = null;
    threadsModal.addEventListener('mousedown', (e) => {
        threadsModalMouseDownTarget = e.target;
    });
    threadsModal.addEventListener('mouseup', (e) => {
        if (e.target === threadsModal && threadsModalMouseDownTarget === threadsModal) {
            closeThreadsModal();
        }
        threadsModalMouseDownTarget = null;
    });

    threadsSlider.addEventListener('input', () => {
        threadsDisplay.textContent = threadsSlider.value;
    });

    saveThreadsBtn.addEventListener('click', async () => {
        const val = parseInt(threadsSlider.value, 10);
        saveThreadsBtn.disabled = true;
        saveThreadsBtn.textContent = 'Saving...';

        try {
            const res = await authFetch('/api/save-threads', {
                method: 'POST',
                body: JSON.stringify({ threads: val }),
            });
            if (res.ok) {
                currentThreads = val;
                showToast(`Threads set to ${val}`, 'success');
                closeThreadsModal();
            } else {
                showToast('Error saving configuration', 'error');
            }
        } catch (_) {
            showToast('Error saving configuration', 'error');
        } finally {
            saveThreadsBtn.disabled = false;
            saveThreadsBtn.textContent = 'Save';
        }
    });

    async function initThreadsInfo() {
        try {
            const res = await authFetch('/api/info');
            const data = await res.json();

            const cpuCount = data.cpu_count || 4;
            const saved = data.saved_threads || 4;

            let maxThreads = Math.max(1, cpuCount - 1);
            if (cpuCount <= 1) maxThreads = 1;

            threadsSlider.max = maxThreads;
            threadsSlider.value = Math.min(saved, maxThreads);

            maxCpuDisplay.textContent = maxThreads;
            threadsDisplay.textContent = threadsSlider.value;
            currentThreads = parseInt(threadsSlider.value, 10);
        } catch (_) {
            // Silent fallback.
        }
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function setupDragDrop(zone, input, fileType, callback) {
        if (!zone || !input) return;
        zone.addEventListener('click', () => {
            if (isProcessing) return;
            if (zone.classList.contains('disabled')) return;
            input.click();
        });
        input.addEventListener('change', (e) => handleFiles(e.target.files, fileType, callback));

        ['dragenter', 'dragover'].forEach((eventName) => {
            zone.addEventListener(eventName, (e) => {
                zone.classList.add('dragover');
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'copy';
                }
            }, false);
        });

        ['dragleave', 'drop'].forEach((eventName) => {
            zone.addEventListener(eventName, () => {
                zone.classList.remove('dragover');
            }, false);
        });

        zone.addEventListener('drop', (e) => {
            if (isProcessing) return;
            if (zone.classList.contains('disabled')) return;
            if (!e.dataTransfer) return;
            handleFiles(e.dataTransfer.files, fileType, callback);
        });
    }

    function setZoneDisabled(zone, disabled) {
        if (!zone) return;
        zone.classList.toggle('disabled', disabled);
        if ('disabled' in zone) {
            zone.disabled = disabled;
        }
        if (disabled) {
            zone.setAttribute('aria-disabled', 'true');
        } else {
            zone.removeAttribute('aria-disabled');
        }
    }

    function handleFiles(files, type, callback) {
        if (files.length <= 0) return;

        const file = files[0];
        const fileName = file.name.toLowerCase();
        let isValid = false;

        if (type === 'audio') {
            const allowedExtensions = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.opus'];
            if (file.type.startsWith('audio/') || allowedExtensions.some((ext) => fileName.endsWith(ext))) {
                isValid = true;
            } else {
                showToast('Please upload a valid audio file (mp3, wav, m4a, ...).', 'error');
            }
        } else if (type === 'video') {
            const allowedExtensions = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv'];
            if (file.type.startsWith('video/') || allowedExtensions.some((ext) => fileName.endsWith(ext))) {
                isValid = true;
            } else {
                showToast('Please upload a valid video file (mp4, mov, mkv, ...).', 'error');
            }
        } else if (type === 'pdf') {
            if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
                isValid = true;
            } else {
                showToast('Please upload a valid PDF file.', 'error');
            }
        }

        if (isValid) callback(file);
    }

    function onAudioSelected(file) {
        if (videoFile) {
            showToast('Remove the video file to upload audio.', 'error');
            return;
        }
        audioFile = file;
        const info = document.getElementById('audio-file-info');
        info.innerHTML = `Selected: ${file.name} <span class="remove-file" id="remove-audio">&times;</span>`;
        document.getElementById('remove-audio').onclick = (e) => {
            e.stopPropagation();
            audioFile = null;
            audioInput.value = '';
            info.innerHTML = '';
            checkStartReady();
        };
        checkStartReady();
    }

    function onVideoSelected(file) {
        if (audioFile) {
            showToast('Remove the audio file to upload video.', 'error');
            return;
        }
        videoFile = file;
        const info = document.getElementById('video-file-info');
        info.innerHTML = `Selected: ${file.name} <span class="remove-file" id="remove-video">&times;</span>`;
        document.getElementById('remove-video').onclick = (e) => {
            e.stopPropagation();
            videoFile = null;
            videoInput.value = '';
            info.innerHTML = '';
            checkStartReady();
        };
        checkStartReady();
    }

    function onPdfSelected(file) {
        pdfFile = file;
        const info = document.getElementById('pdf-file-info');
        info.innerHTML = `Selected: ${file.name} <span class="remove-file" id="remove-pdf">&times;</span>`;

        document.getElementById('remove-pdf').onclick = (e) => {
            e.stopPropagation();
            pdfFile = null;
            pdfInput.value = '';
            info.innerHTML = '';
            pagesInput.value = '';
            pagesInput.disabled = true;
            pagesInput.placeholder = 'All';
            checkStartReady();
        };

        pagesInput.disabled = false;
        pagesInput.placeholder = 'e.g., 1-5 (Optional)';
        checkStartReady();
    }

    setupDragDrop(audioDropZone, audioInput, 'audio', onAudioSelected);
    setupDragDrop(videoDropZone, videoInput, 'video', onVideoSelected);
    setupDragDrop(pdfDropZone, pdfInput, 'pdf', onPdfSelected);

    function detectTypeForDrop(file) {
        if (!file) return '';
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';

        const audioExt = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.opus'];
        const videoExt = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv'];
        if (file.type.startsWith('audio/') || audioExt.some((ext) => name.endsWith(ext))) return 'audio';
        if (file.type.startsWith('video/') || videoExt.some((ext) => name.endsWith(ext))) return 'video';
        return '';
    }

    if (lectureDropZone) {
        ['dragenter', 'dragover'].forEach((eventName) => {
            lectureDropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                lectureDropZone.classList.add('dragover');
            });
        });
        ['dragleave', 'drop'].forEach((eventName) => {
            lectureDropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                lectureDropZone.classList.remove('dragover');
            });
        });
        lectureDropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer ? e.dataTransfer.files : null;
            if (!files || files.length <= 0) return;
            const file = files[0];
            const kind = detectTypeForDrop(file);
            if (!kind) {
                showToast('Unsupported file type. Upload audio, video, or PDF.', 'error');
                return;
            }

            if (kind === 'audio') handleFiles(files, 'audio', onAudioSelected);
            else if (kind === 'video') handleFiles(files, 'video', onVideoSelected);
            else handleFiles(files, 'pdf', onPdfSelected);
        });
    }

    function checkStartReady() {
        if (isProcessing) {
            startBtn.disabled = true;
            return;
        }

        startBtn.disabled = !(audioFile || videoFile || pdfFile);

        setZoneDisabled(videoDropZone, Boolean(audioFile));
        setZoneDisabled(audioDropZone, Boolean(videoFile));
    }

    function setProcessingState(active) {
        isProcessing = active;
        const uploadSection = document.querySelector('.upload-section');

        if (!uploadSection) {
            return;
        }

        if (active) {
            uploadSection.classList.add('is-processing');
            setZoneDisabled(audioDropZone, true);
            setZoneDisabled(videoDropZone, true);
            setZoneDisabled(pdfDropZone, true);
            pagesInput.disabled = true;
            startBtn.disabled = true;
        } else {
            uploadSection.classList.remove('is-processing');
            setZoneDisabled(pdfDropZone, false);
            if (pdfFile) pagesInput.disabled = false;
            checkStartReady();
        }
    }

    startBtn.addEventListener('click', async () => {
        if (!audioFile && !videoFile && !pdfFile) return;

        const token = getToken();
        if (!token) {
            showToast('Please login first.', 'error');
            return;
        }

        const keyData = await getKeyStatus();
        if (!keyData.is_set) {
            showToast('Gemini API Key is missing! Please configure it in Settings.', 'error');
            openModal();
            return;
        }

        setProcessingState(true);
        setActivePage('processing');
        updateStatus('processing');
        updateProgress(12, 0);
        log('Starting file upload...');

        try {
            let audioFilename = null;
            if (audioFile) {
                const audioData = new FormData();
                audioData.append('file', audioFile);
                const audioRes = await authFetch('/upload', { method: 'POST', body: audioData });
                if (!audioRes.ok) throw new Error('Audio upload error');
                const audioJson = await audioRes.json();
                audioFilename = audioJson.filename;
                log(`Audio uploaded: ${audioFilename}`);
            }

            let videoFilename = null;
            if (videoFile) {
                const videoData = new FormData();
                videoData.append('file', videoFile);
                const videoRes = await authFetch('/upload', { method: 'POST', body: videoData });
                if (!videoRes.ok) throw new Error('Video upload error');
                const videoJson = await videoRes.json();
                videoFilename = videoJson.filename;
                log(`Video uploaded: ${videoFilename}`);
            }

            let pdfFilename = null;
            if (pdfFile) {
                const pdfData = new FormData();
                pdfData.append('file', pdfFile);
                const pdfRes = await authFetch('/upload', { method: 'POST', body: pdfData });
                if (!pdfRes.ok) throw new Error('PDF upload error');
                const pdfJson = await pdfRes.json();
                pdfFilename = pdfJson.filename;
                log(`PDF uploaded: ${pdfFilename}`);
            }

            startWebSocket(audioFilename, videoFilename, pdfFilename, pagesInput.value);
        } catch (err) {
            log(`❌ Error: ${err.message}`);
            setProcessingState(false);
            updateStatus('error');
            updateProgress(0, 0);
        }
    });

    function startWebSocket(audioName, videoName, pdfName, pages) {
        const token = getToken();
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/process?token=${encodeURIComponent(token)}`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            updateStatus('processing');
            updateProgress(30, 1);

            ws.send(JSON.stringify({
                audio_filename: audioName,
                video_filename: videoName,
                slides_filename: pdfName,
                pages: pages,
                threads: currentThreads,
            }));
        };

        ws.onmessage = (event) => {
            const msg = event.data;
            if (msg.startsWith('PROCESS_FAILED::')) {
                const reason = msg.replace('PROCESS_FAILED::', '').trim() || 'Processing failed.';
                updateStatus('error');
                updateProgress(100, 3);
                showToast(reason, 'error');
                setProcessingState(false);
                checkStartReady();
            } else if (msg === 'REFRESH_OUTPUTS') {
                loadOutputs(true);
                loadHistory();

                if (statusIndicator.textContent !== 'Error') {
                    updateStatus('completed');
                    updateProgress(100, 3);
                }

                const shouldClearInputs = statusIndicator.textContent !== 'Error';
                if (shouldClearInputs) {
                    audioFile = null;
                    videoFile = null;
                    pdfFile = null;
                    audioInput.value = '';
                    videoInput.value = '';
                    pdfInput.value = '';
                    pagesInput.value = '';
                    pagesInput.disabled = true;
                    document.getElementById('audio-file-info').textContent = '';
                    document.getElementById('video-file-info').textContent = '';
                    document.getElementById('pdf-file-info').textContent = '';

                    setProcessingState(false);
                    startBtn.disabled = true;
                    log('Inputs cleared. Ready for new task.');
                    setActivePage('notes');
                } else {
                    // Keep user-selected files so they can retry quickly.
                    setProcessingState(false);
                    checkStartReady();
                    log('Processing failed; inputs kept so you can retry.');
                    setActivePage('upload');
                }
            } else {
                if (/transcrib/i.test(msg)) {
                    updateProgress(55, 1);
                } else if (/generat|latex|review|notes/i.test(msg)) {
                    updateProgress(78, 2);
                } else if (/compil|pdf|cleanup|done/i.test(msg)) {
                    updateProgress(92, 3);
                }
                log(msg);
            }
        };

        ws.onclose = () => {
            log('Connection closed.');
            if (statusIndicator.textContent !== 'Completed') {
                setProcessingState(false);
            }
        };

        ws.onerror = () => {
            log('WebSocket error.');
        };
    }

    function log(message) {
        if (message.startsWith('\r')) {
            const cleanMessage = message.replace(/^\r+/, '');
            const lastLine = terminalWindow.lastElementChild;
            if (lastLine) {
                lastLine.textContent = `> ${cleanMessage}`;
            } else {
                const div = document.createElement('div');
                div.className = 'log-line';
                div.textContent = `> ${cleanMessage}`;
                terminalWindow.appendChild(div);
            }
        } else {
            const div = document.createElement('div');
            div.className = 'log-line';
            div.textContent = `> ${message}`;
            terminalWindow.appendChild(div);
        }
        terminalWindow.scrollTop = terminalWindow.scrollHeight;
    }

    async function loadNotes(folder, notesFilename) {
        if (!folder || !notesFilename) {
            notesPreview.textContent = 'No notes file available for this entry.';
            notesSource.textContent = 'No notes file';
            return;
        }

        try {
            const url = `/notes/${encodeURIComponent(folder)}/${encodeURIComponent(notesFilename)}`;
            const res = await authFetch(url);
            if (!res.ok) throw new Error('Unable to fetch notes');

            const data = await res.json();
            notesPreview.textContent = data.content || 'Notes file is empty.';
            notesSource.textContent = `${folder}/${notesFilename}`;
        } catch (err) {
            notesPreview.textContent = `Failed to load notes: ${err.message}`;
            notesSource.textContent = 'Load error';
        }
    }

    async function loadOutputs(selectLatest = false) {
        try {
            const res = await authFetch('/outputs');
            const files = await res.json();

            resultsList.innerHTML = '';
            if (files.length === 0) {
                resultsList.innerHTML = '<div class="empty-state">No notes generated.</div>';
                notesPreview.textContent = 'Generate notes to preview them here.';
                notesSource.textContent = 'No notes loaded';
                latestOutputLoaded = false;
                return;
            }

            files.forEach((file) => {
                const item = document.createElement('div');
                item.className = 'result-item';

                const title = document.createElement('h4');
                title.textContent = file.folder;

                const subtitle = document.createElement('p');
                const createdAt = file.created_at ? ` • ${file.created_at}` : '';
                subtitle.textContent = `${file.filename}${createdAt}`;

                const actions = document.createElement('div');
                actions.className = 'actions-row';

                const openBtn = document.createElement('a');
                openBtn.href = `/view/${encodeURIComponent(file.folder)}/${encodeURIComponent(file.filename)}?token=${encodeURIComponent(getToken())}`;
                openBtn.className = 'download-btn';
                openBtn.target = '_blank';
                openBtn.textContent = 'Open PDF';

                const downloadBtn = document.createElement('a');
                downloadBtn.href = `/download/${encodeURIComponent(file.folder)}/${encodeURIComponent(file.filename)}?token=${encodeURIComponent(getToken())}`;
                downloadBtn.className = 'download-btn secondary';
                downloadBtn.textContent = 'Download PDF';

                const downloadNotesBtn = document.createElement('a');
                downloadNotesBtn.href = file.notes_filename
                    ? `/download/${encodeURIComponent(file.folder)}/${encodeURIComponent(file.notes_filename)}?token=${encodeURIComponent(getToken())}`
                    : '#';
                downloadNotesBtn.className = 'download-btn secondary';
                downloadNotesBtn.textContent = 'Download Notes TXT';
                if (!file.notes_filename) {
                    downloadNotesBtn.classList.add('action-btn');
                    downloadNotesBtn.setAttribute('aria-disabled', 'true');
                    downloadNotesBtn.style.pointerEvents = 'none';
                    downloadNotesBtn.style.opacity = '0.45';
                }

                const notesBtn = document.createElement('button');
                notesBtn.className = 'download-btn secondary action-btn';
                notesBtn.textContent = 'View Notes';
                notesBtn.disabled = !file.notes_filename;
                notesBtn.onclick = () => {
                    setActivePage('notes');
                    loadNotes(file.folder, file.notes_filename);
                };

                actions.appendChild(openBtn);
                actions.appendChild(downloadBtn);
                actions.appendChild(downloadNotesBtn);
                actions.appendChild(notesBtn);

                item.appendChild(title);
                item.appendChild(subtitle);
                item.appendChild(actions);
                resultsList.appendChild(item);
            });

            if ((selectLatest || !latestOutputLoaded) && files[0].notes_filename) {
                latestOutputLoaded = true;
                loadNotes(files[0].folder, files[0].notes_filename);
                setActivePage('notes');
            }
        } catch (err) {
            console.error('Output loading error:', err);
        }
    }

    async function loadHistory() {
        try {
            const res = await authFetch('/history');
            const history = await res.json();

            historyList.innerHTML = '';
            if (!Array.isArray(history) || history.length === 0) {
                historyList.innerHTML = '<div class="empty-state">No history yet.</div>';
                return;
            }

            history.forEach((entry) => {
                const item = document.createElement('div');
                item.className = 'result-item history-item';

                const title = document.createElement('h4');
                title.textContent = entry.folder || 'Unknown';

                const subtitle = document.createElement('p');
                subtitle.textContent = `${entry.created_at || 'Unknown date'} • ${entry.succeeded ? 'Success' : 'Failed'}`;

                const actions = document.createElement('div');
                actions.className = 'actions-row';

                if (entry.pdf) {
                    const pdfBtn = document.createElement('a');
                    pdfBtn.href = `/view/${encodeURIComponent(entry.folder)}/${encodeURIComponent(entry.pdf)}?token=${encodeURIComponent(getToken())}`;
                    pdfBtn.className = 'download-btn';
                    pdfBtn.target = '_blank';
                    pdfBtn.textContent = 'Open';
                    actions.appendChild(pdfBtn);
                }

                if (entry.notes) {
                    const notesDownloadBtn = document.createElement('a');
                    notesDownloadBtn.href = `/download/${encodeURIComponent(entry.folder)}/${encodeURIComponent(entry.notes)}?token=${encodeURIComponent(getToken())}`;
                    notesDownloadBtn.className = 'download-btn secondary';
                    notesDownloadBtn.textContent = 'Download TXT';

                    const notesBtn = document.createElement('button');
                    notesBtn.className = 'download-btn secondary action-btn';
                    notesBtn.textContent = 'Notes';
                    notesBtn.onclick = () => {
                        setActivePage('notes');
                        loadNotes(entry.folder, entry.notes);
                    };
                    actions.appendChild(notesDownloadBtn);
                    actions.appendChild(notesBtn);
                }

                item.appendChild(title);
                item.appendChild(subtitle);
                item.appendChild(actions);
                historyList.appendChild(item);
            });
        } catch (err) {
            console.error('History loading error:', err);
        }
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
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
            if (t.innerText.includes(safeMessage)) {
                return;
            }
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
    }

    showLanding();
    // Default landing view, supporting deep links like /#contact
    const initialHash = (window.location.hash || '').replace('#', '');
    if (initialHash) {
        showLandingView(initialHash);
    } else {
        showLandingView('home');
    }
    showLoginForm();
    setAuthUI(false);
    validateSession();
});
