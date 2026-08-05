document.addEventListener('DOMContentLoaded', async () => {
  const app = window.AudioTTo;
  if (!app) return;

  app.initDom();

  // Apply saved theme immediately (before render)
  if (typeof app.loadTheme === 'function') app.loadTheme();

  if (typeof app.bindPublicNav === 'function') app.bindPublicNav();
  if (typeof app.bindAppNav === 'function') app.bindAppNav();
  if (typeof app.bindTerminalToggle === 'function') app.bindTerminalToggle();
  if (typeof app.bindSettings === 'function') app.bindSettings();
  if (typeof app.bindAuth === 'function') app.bindAuth();
  if (typeof app.bindUpload === 'function') app.bindUpload();
  if (typeof app.bindSearch === 'function') app.bindSearch();

  // Wire share button
  const shareBtn = document.getElementById('notes-share-btn');
  if (shareBtn && typeof app.shareNotes === 'function') {
    shareBtn.addEventListener('click', app.shareNotes);
  }

  // Wire PDF download button for the currently viewed notes
  const pdfDownloadBtn = document.getElementById('notes-download-pdf');
  if (pdfDownloadBtn) {
    pdfDownloadBtn.addEventListener('click', () => {
      const folder = app.state.currentNotesFolder;
      const pdf = app.state.currentNotesPdf || '';

      if (!folder || !pdf) {
        app.showToast('No PDF available for this note.', 'error');
        return;
      }

      const url = `/download/${encodeURIComponent(folder)}/${encodeURIComponent(pdf)}?token=${encodeURIComponent(app.getToken())}`;
      window.location.href = url;
    });
  }

  // Wire save-notes button (saves currently viewed notes to Saved Notes)
  const saveBtn = document.getElementById('notes-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const folder = app.state.currentNotesFolder;
      const notes = app.state.currentNotesFile;
      const pdf = app.state.currentNotesPdf || '';

      if (!folder || !notes) {
        app.showToast('No notes loaded to save.', 'error');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      try {
        const r = await app.authFetch('/api/save-note', {
          method: 'POST',
          body: JSON.stringify({ folder, pdf, notes, transcript: '', title: folder }),
        });
        const data = await r.json();
        if (r.ok) {
          app.showToast(data.message === 'Already saved' ? 'Already in Saved Notes.' : 'Note saved! ✅', 'success');
        } else {
          throw new Error('Failed');
        }
      } catch (_) {
        app.showToast('Failed to save note.', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Notes';
      }
    });
  }

  // Load dashboard data when switching to dashboard page
  const origSetActivePage = app.setActivePage;
  app.setActivePage = function(pageName) {
    origSetActivePage.call(app, pageName);
    if (pageName === 'dashboard') {
      if (typeof app.loadDashboardKPIs === 'function') app.loadDashboardKPIs();
      if (typeof app.loadRecentUploads === 'function') app.loadRecentUploads();
    } else if (pageName === 'history') {
      if (typeof app.loadHistory === 'function') app.loadHistory();
    } else if (pageName === 'saved') {
      if (typeof app.loadSavedNotes === 'function') app.loadSavedNotes();
    }
  };

  // Default view.
  if (typeof app.showLanding === 'function') {
     app.showLanding();
  }
  if (typeof app.showLoginForm === 'function') app.showLoginForm();
  if (typeof app.setAuthUI === 'function') app.setAuthUI(false);

  // Restore session if token exists.
  if (typeof app.validateSession === 'function') await app.validateSession();
});
