(() => {
  const app = (window.AudioTTo = window.AudioTTo || {});

  // ── helpers ──────────────────────────────────────────────────────────────

  function fmtDate(raw) {
    if (!raw) return '—';
    try {
      const d = new Date(raw);
      if (isNaN(d)) return raw;
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (_) {
      return raw;
    }
  }

  function actionBtn(label, cls, onClick) {
    const btn = document.createElement('button');
    btn.className = cls;
    btn.textContent = label;
    btn.onclick = onClick;
    return btn;
  }

  // ── Notes viewer ─────────────────────────────────────────────────────────

  app.loadNotes = async function loadNotes(folder, notesFilename) {
    const { notesPreview, notesSource } = app.dom;

    if (!folder || !notesFilename) {
      if (notesPreview) notesPreview.textContent = 'No notes file available for this entry.';
      if (notesSource) notesSource.textContent = 'No notes file';
      return;
    }

    try {
      const url = `/notes/${encodeURIComponent(folder)}/${encodeURIComponent(notesFilename)}`;
      const res = await app.authFetch(url);
      if (!res.ok) throw new Error('Unable to fetch notes');

      const data = await res.json();
      if (notesPreview) notesPreview.textContent = data.content || 'Notes file is empty.';
      if (notesSource) notesSource.textContent = `${folder}/${notesFilename}`;

      // Store for share / save / PDF download
      app.state.currentNotesFolder = folder;
      app.state.currentNotesFile = notesFilename;
    } catch (err) {
      if (notesPreview) notesPreview.textContent = `Failed to load notes: ${err.message || err}`;
      if (notesSource) notesSource.textContent = 'Load error';
    }
  };

  // ── Dashboard KPIs + Weekly chart ────────────────────────────────────────

  app.loadDashboardKPIs = async function loadDashboardKPIs() {
    try {
      const res = await app.authFetch('/history');
      const history = await res.json();

      if (!Array.isArray(history)) return;

      const totalLectures = history.length;
      const notesGenerated = history.filter((h) => h.succeeded).length;
      const hoursSaved = Math.round(notesGenerated * 1.5 * 10) / 10; // ~1.5 hrs saved per lecture

      const kpiTotal = document.getElementById('kpi-total-lectures');
      const kpiNotes = document.getElementById('kpi-notes-generated');
      const kpiHours = document.getElementById('kpi-hours-saved');

      if (kpiTotal) animateCounter(kpiTotal, totalLectures);
      if (kpiNotes) animateCounter(kpiNotes, notesGenerated);
      if (kpiHours) animateCounter(kpiHours, hoursSaved, true);

      drawWeeklyChart(history);
    } catch (err) {
      console.error('KPI load error:', err);
    }
  };

  function animateCounter(el, target, isFloat = false) {
    const duration = 700;
    const start = performance.now();
    const from = 0;
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const val = from + (target - from) * easeOut(t);
      el.textContent = isFloat ? val.toFixed(1) : Math.round(val);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function drawWeeklyChart(history) {
    const chart = document.getElementById('weekly-chart');
    if (!chart) return;

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const counts = new Array(7).fill(0);
    const now = new Date();

    history.forEach((h) => {
      if (!h.created_at) return;
      try {
        const d = new Date(h.created_at);
        const diff = Math.floor((now - d) / 86400000);
        if (diff >= 0 && diff < 7) {
          const idx = (now.getDay() - diff + 7) % 7;
          counts[idx]++;
        }
      } catch (_) {}
    });

    const maxVal = Math.max(...counts, 1);
    chart.innerHTML = '';

    // Build in display order: oldest → today
    const orderedIndices = [];
    for (let i = 6; i >= 0; i--) {
      orderedIndices.push((now.getDay() - i + 7) % 7);
    }

    orderedIndices.forEach((dayIdx) => {
      const col = document.createElement('div');
      col.className = 'bar-col';

      const barWrap = document.createElement('div');
      barWrap.className = 'bar-wrap';

      const bar = document.createElement('div');
      bar.className = 'bar';
      const pct = Math.round((counts[dayIdx] / maxVal) * 100);
      bar.style.height = '0%';
      bar.title = `${counts[dayIdx]} lecture${counts[dayIdx] !== 1 ? 's' : ''}`;
      setTimeout(() => { bar.style.height = `${Math.max(pct, counts[dayIdx] > 0 ? 8 : 2)}%`; }, 50);

      const label = document.createElement('span');
      label.className = 'bar-label';
      label.textContent = days[dayIdx];

      barWrap.appendChild(bar);
      col.appendChild(barWrap);
      col.appendChild(label);
      chart.appendChild(col);
    });
  }

  // ── Dashboard Recent Uploads ──────────────────────────────────────────────

  app.loadRecentUploads = async function loadRecentUploads() {
    const container = document.getElementById('recent-uploads');
    if (!container) return;

    try {
      const res = await app.authFetch('/history');
      const history = await res.json();

      container.innerHTML = '';

      if (!Array.isArray(history) || history.length === 0) {
        container.innerHTML = '<div class="empty-state table-empty">No uploads yet.</div>';
        return;
      }

      const recent = history.slice(0, 5);
      recent.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'table-row';

        const nameCell = document.createElement('span');
        nameCell.textContent = entry.folder || 'Unknown';
        nameCell.title = entry.folder || '';

        const dateCell = document.createElement('span');
        dateCell.textContent = fmtDate(entry.created_at);

        const statusCell = document.createElement('span');
        const chip = document.createElement('span');
        chip.className = entry.succeeded ? 'status-chip success' : 'status-chip failed';
        chip.textContent = entry.succeeded ? 'Success' : 'Failed';
        statusCell.appendChild(chip);

        const actionCell = document.createElement('span');
        if (entry.notes && entry.succeeded) {
          const viewBtn = actionBtn('View Notes', 'action-link-btn', () => {
            app.state.currentNotesFolder = entry.folder;
            app.state.currentNotesPdf = entry.pdf || '';
            app.state.currentNotesFile = entry.notes;
            app.setActivePage('notes');
            app.loadNotes(entry.folder, entry.notes);
          });
          actionCell.appendChild(viewBtn);
        } else {
          actionCell.textContent = '—';
        }

        row.appendChild(nameCell);
        row.appendChild(dateCell);
        row.appendChild(statusCell);
        row.appendChild(actionCell);
        container.appendChild(row);
      });
    } catch (err) {
      console.error('Recent uploads error:', err);
    }
  };

  // ── Saved Notes page ─────────────────────────────────────────────────────

  app.loadOutputs = async function loadOutputs(selectLatest = false) {
    // Load saved notes from API instead of raw file scan
    await app.loadSavedNotes(selectLatest);
  };

  app.loadSavedNotes = async function loadSavedNotes(selectLatest = false) {
    const { resultsList, notesPreview, notesSource } = app.dom;

    try {
      const res = await app.authFetch('/api/saved-notes');
      const saved = await res.json();

      if (resultsList) resultsList.innerHTML = '';

      if (!Array.isArray(saved) || saved.length === 0) {
        if (resultsList) resultsList.innerHTML = '<div class="empty-state">No saved notes yet. Open a lecture from History and click "Save Note".</div>';
        if (!selectLatest) return;
        // fallback: try outputs scan for auto-load after processing
        await loadLatestFromOutputs(notesPreview, notesSource);
        return;
      }

      saved.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'result-item';

        const title = document.createElement('h4');
        title.textContent = item.title || item.folder;

        const subtitle = document.createElement('p');
        subtitle.textContent = `Saved ${fmtDate(item.saved_at)}`;

        const actions = document.createElement('div');
        actions.className = 'actions-row';

        if (item.pdf) {
          const openBtn = document.createElement('a');
          openBtn.href = `/view/${encodeURIComponent(item.folder)}/${encodeURIComponent(item.pdf)}?token=${encodeURIComponent(app.getToken())}`;
          openBtn.className = 'download-btn';
          openBtn.target = '_blank';
          openBtn.textContent = 'Open PDF';
          actions.appendChild(openBtn);
        }

        if (item.notes) {
          const dlBtn = document.createElement('a');
          dlBtn.href = `/download/${encodeURIComponent(item.folder)}/${encodeURIComponent(item.notes)}?token=${encodeURIComponent(app.getToken())}`;
          dlBtn.className = 'download-btn secondary';
          dlBtn.textContent = 'Download TXT';
          actions.appendChild(dlBtn);

          const viewBtn = actionBtn('View Notes', 'download-btn secondary action-btn', () => {
            app.state.currentNotesFolder = item.folder;
            app.state.currentNotesPdf = item.pdf || '';
            app.state.currentNotesFile = item.notes;
            app.setActivePage('notes');
            app.loadNotes(item.folder, item.notes);
          });
          actions.appendChild(viewBtn);
        }

        const removeBtn = actionBtn('Remove', 'download-btn danger action-btn', async () => {
          try {
            await app.authFetch(`/api/saved-notes/${encodeURIComponent(item.folder)}`, { method: 'DELETE' });
            app.showToast('Note removed from saved list.', 'success');
            app.loadSavedNotes();
          } catch (_) {
            app.showToast('Failed to remove note.', 'error');
          }
        });
        actions.appendChild(removeBtn);

        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(actions);
        if (resultsList) resultsList.appendChild(card);
      });

      if (selectLatest && saved[0] && saved[0].notes) {
        app.state.latestOutputLoaded = true;
        app.setActivePage('notes');
        app.loadNotes(saved[0].folder, saved[0].notes);
      }
    } catch (err) {
      console.error('Saved notes load error:', err);
    }
  };

  async function loadLatestFromOutputs(notesPreview, notesSource) {
    try {
      const res = await app.authFetch('/outputs');
      const files = await res.json();
      if (Array.isArray(files) && files.length > 0 && files[0].notes_filename) {
        app.state.latestOutputLoaded = true;
        app.setActivePage('notes');
        app.loadNotes(files[0].folder, files[0].notes_filename);
        app.state.currentNotesFolder = files[0].folder;
        app.state.currentNotesPdf = files[0].filename;
        app.state.currentNotesFile = files[0].notes_filename;
      }
    } catch (_) {}
  }

  // ── History page ──────────────────────────────────────────────────────────

  app.loadHistory = async function loadHistory() {
    const { historyList } = app.dom;

    try {
      const res = await app.authFetch('/history');
      const history = await res.json();

      if (historyList) historyList.innerHTML = '';
      if (!Array.isArray(history) || history.length === 0) {
        if (historyList) historyList.innerHTML = '<div class="empty-state">No history yet.</div>';
        return;
      }

      history.forEach((entry) => {
        const row = document.createElement('div');
        row.className = 'table-row history-table-row';

        const nameCell = document.createElement('span');
        nameCell.className = 'history-name';
        nameCell.textContent = entry.folder || 'Unknown';
        nameCell.title = entry.folder || '';

        const dateCell = document.createElement('span');
        dateCell.textContent = fmtDate(entry.created_at);

        const statusCell = document.createElement('span');
        const chip = document.createElement('span');
        chip.className = entry.succeeded ? 'status-chip success' : 'status-chip failed';
        chip.textContent = entry.succeeded ? 'Success' : 'Failed';
        statusCell.appendChild(chip);

        const actionsCell = document.createElement('span');
        actionsCell.className = 'actions-row inline-actions';

        if (entry.pdf) {
          const openBtn = document.createElement('a');
          openBtn.href = `/view/${encodeURIComponent(entry.folder)}/${encodeURIComponent(entry.pdf)}?token=${encodeURIComponent(app.getToken())}`;
          openBtn.className = 'download-btn small';
          openBtn.target = '_blank';
          openBtn.textContent = 'PDF';
          actionsCell.appendChild(openBtn);
        }

        if (entry.notes) {
          const notesBtn = actionBtn('Notes', 'download-btn secondary small action-btn', () => {
            app.state.currentNotesFolder = entry.folder;
            app.state.currentNotesPdf = entry.pdf || '';
            app.state.currentNotesFile = entry.notes;
            app.setActivePage('notes');
            app.loadNotes(entry.folder, entry.notes);
          });
          actionsCell.appendChild(notesBtn);

          const saveBtn = actionBtn('Save Note', 'download-btn accent small action-btn', async () => {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving…';
            try {
              const r = await app.authFetch('/api/save-note', {
                method: 'POST',
                body: JSON.stringify({
                  folder: entry.folder,
                  pdf: entry.pdf || '',
                  notes: entry.notes || '',
                  transcript: entry.transcript || '',
                  title: entry.folder,
                }),
              });
              const data = await r.json();
              if (r.ok) {
                app.showToast(data.message === 'Already saved' ? 'Already in Saved Notes.' : 'Note saved! ✅', 'success');
                saveBtn.textContent = 'Saved ✓';
              } else {
                throw new Error('Failed');
              }
            } catch (_) {
              app.showToast('Failed to save note.', 'error');
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save Note';
            }
          });
          actionsCell.appendChild(saveBtn);
        }

        if (!entry.notes && !entry.pdf) {
          actionsCell.textContent = '—';
        }

        row.appendChild(nameCell);
        row.appendChild(dateCell);
        row.appendChild(statusCell);
        row.appendChild(actionsCell);
        if (historyList) historyList.appendChild(row);
      });
    } catch (err) {
      console.error('History loading error:', err);
    }
  };

  // ── Share button ──────────────────────────────────────────────────────────

  app.shareNotes = async function shareNotes() {
    const notesEl = document.getElementById('notes-preview');
    const sourceEl = document.getElementById('notes-source');
    const content = notesEl ? notesEl.textContent.trim() : '';
    const title = sourceEl ? sourceEl.textContent.trim() : 'AudioTTo Notes';

    if (!content || content === 'Generate notes to preview them here.') {
      app.showToast('No notes to share yet.', 'error');
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({ title, text: content });
        app.showToast('Shared successfully!', 'success');
        return;
      } catch (err) {
        if (err.name !== 'AbortError') {
          // Fall through to clipboard
        } else {
          return;
        }
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(content);
      app.showToast('Notes copied to clipboard!', 'success');
    } catch (_) {
      app.showToast('Could not share or copy notes.', 'error');
    }
  };
})();
