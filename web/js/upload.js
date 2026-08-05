(() => {
  const app = (window.AudioTTo = window.AudioTTo || {});

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
    if (!files || files.length <= 0) return;

    const file = files[0];
    const fileName = (file.name || '').toLowerCase();
    let isValid = false;

    if (type === 'audio') {
      const allowedExtensions = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.wma', '.opus'];
      if (file.type.startsWith('audio/') || allowedExtensions.some((ext) => fileName.endsWith(ext))) {
        isValid = true;
      } else {
        app.showToast('Please upload a valid audio file (mp3, wav, m4a, ...).', 'error');
      }
    } else if (type === 'video') {
      const allowedExtensions = ['.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv'];
      if (file.type.startsWith('video/') || allowedExtensions.some((ext) => fileName.endsWith(ext))) {
        isValid = true;
      } else {
        app.showToast('Please upload a valid video file (mp4, mov, mkv, ...).', 'error');
      }
    } else if (type === 'pdf') {
      if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
        isValid = true;
      } else {
        app.showToast('Please upload a valid PDF file.', 'error');
      }
    }

    if (isValid) callback(file);
  }

  function setupDragDrop(zone, input, fileType, callback) {
    if (!zone || !input) return;

    zone.addEventListener('click', () => {
      if (app.state.isProcessing) return;
      if (zone.classList.contains('disabled')) return;
      input.click();
    });

    input.addEventListener('change', (e) => handleFiles(e.target.files, fileType, callback));

    ['dragenter', 'dragover'].forEach((eventName) => {
      zone.addEventListener(
        eventName,
        (e) => {
          if (app.state.isProcessing) return;
          if (zone.classList.contains('disabled')) return;
          zone.classList.add('dragover');
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
          }
        },
        false,
      );
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      zone.addEventListener(
        eventName,
        () => {
          zone.classList.remove('dragover');
        },
        false,
      );
    });

    zone.addEventListener('drop', (e) => {
      if (app.state.isProcessing) return;
      if (zone.classList.contains('disabled')) return;
      if (!e.dataTransfer) return;
      handleFiles(e.dataTransfer.files, fileType, callback);
    });
  }

  function clearYoutube() {
    if (app.dom.youtubeInput) app.dom.youtubeInput.value = '';
    app.state.youtubeUrl = '';
  }

  function clearAudio() {
    app.state.audioFile = null;
    if (app.dom.audioInput) app.dom.audioInput.value = '';
    if (app.dom.audioFileInfo) app.dom.audioFileInfo.innerHTML = '';
  }

  function clearVideo() {
    app.state.videoFile = null;
    if (app.dom.videoInput) app.dom.videoInput.value = '';
    if (app.dom.videoFileInfo) app.dom.videoFileInfo.innerHTML = '';
  }

  function clearPdf() {
    app.state.pdfFile = null;
    if (app.dom.pdfInput) app.dom.pdfInput.value = '';
    if (app.dom.pdfFileInfo) app.dom.pdfFileInfo.innerHTML = '';
    if (app.dom.pagesInput) {
      app.dom.pagesInput.value = '';
      app.dom.pagesInput.disabled = true;
      app.dom.pagesInput.placeholder = 'All';
    }
  }

  function onAudioSelected(file) {
    // If YouTube was chosen, switch source to file.
    clearYoutube();

    if (app.state.videoFile) {
      app.showToast('Remove the video file to upload audio.', 'error');
      return;
    }

    app.state.audioFile = file;
    if (app.dom.audioFileInfo) {
      app.dom.audioFileInfo.innerHTML = `Selected: ${file.name} <span class="remove-file" id="remove-audio">&times;</span>`;
      const removeBtn = document.getElementById('remove-audio');
      if (removeBtn) {
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          clearAudio();
          checkStartReady();
        };
      }
    }

    checkStartReady();
  }

  function onVideoSelected(file) {
    clearYoutube();

    if (app.state.audioFile) {
      app.showToast('Remove the audio file to upload video.', 'error');
      return;
    }

    app.state.videoFile = file;
    if (app.dom.videoFileInfo) {
      app.dom.videoFileInfo.innerHTML = `Selected: ${file.name} <span class="remove-file" id="remove-video">&times;</span>`;
      const removeBtn = document.getElementById('remove-video');
      if (removeBtn) {
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          clearVideo();
          checkStartReady();
        };
      }
    }

    checkStartReady();
  }

  function onPdfSelected(file) {
    app.state.pdfFile = file;

    if (app.dom.pdfFileInfo) {
      app.dom.pdfFileInfo.innerHTML = `Selected: ${file.name} <span class="remove-file" id="remove-pdf">&times;</span>`;
      const removeBtn = document.getElementById('remove-pdf');
      if (removeBtn) {
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          clearPdf();
          checkStartReady();
        };
      }
    }

    if (app.dom.pagesInput) {
      app.dom.pagesInput.disabled = false;
      app.dom.pagesInput.placeholder = 'e.g., 1-5 (Optional)';
    }

    checkStartReady();
  }

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

  function updateYoutubeState() {
    const youtubeUrl = (app.dom.youtubeInput ? app.dom.youtubeInput.value : '').trim();
    app.state.youtubeUrl = youtubeUrl;

    const hasYoutube = Boolean(youtubeUrl);

    // If user typed a YouTube link, prevent conflicting audio/video file choices.
    if (hasYoutube) {
      if (app.state.audioFile) clearAudio();
      if (app.state.videoFile) clearVideo();
    }

    setZoneDisabled(app.dom.audioDropZone, hasYoutube);
    setZoneDisabled(app.dom.videoDropZone, hasYoutube);
    setZoneDisabled(app.dom.lectureDropZone, hasYoutube);

    checkStartReady();
  }

  function checkStartReady() {
    const { startBtn } = app.dom;

    if (!startBtn) return;

    if (app.state.isProcessing) {
      startBtn.disabled = true;
      return;
    }

    const hasSource = Boolean(app.state.audioFile || app.state.videoFile || app.state.youtubeUrl);
    const hasSlides = Boolean(app.state.pdfFile);

    startBtn.disabled = !(hasSource || hasSlides);

    // Mutually exclusive file source rules.
    setZoneDisabled(app.dom.videoDropZone, Boolean(app.state.audioFile));
    setZoneDisabled(app.dom.audioDropZone, Boolean(app.state.videoFile));
  }

  function setProcessingState(active) {
    app.state.isProcessing = active;

    const uploadSection = document.querySelector('.upload-section');
    if (!uploadSection) return;

    if (active) {
      uploadSection.classList.add('is-processing');
      setZoneDisabled(app.dom.audioDropZone, true);
      setZoneDisabled(app.dom.videoDropZone, true);
      setZoneDisabled(app.dom.pdfDropZone, true);
      setZoneDisabled(app.dom.lectureDropZone, true);
      if (app.dom.youtubeInput) app.dom.youtubeInput.disabled = true;
      if (app.dom.pagesInput) app.dom.pagesInput.disabled = true;
      if (app.dom.startBtn) app.dom.startBtn.disabled = true;
    } else {
      uploadSection.classList.remove('is-processing');
      setZoneDisabled(app.dom.pdfDropZone, false);
      setZoneDisabled(app.dom.lectureDropZone, Boolean(app.state.youtubeUrl));
      if (app.dom.youtubeInput) app.dom.youtubeInput.disabled = false;
      if (app.state.pdfFile && app.dom.pagesInput) app.dom.pagesInput.disabled = false;
      checkStartReady();
    }
  }

  function startWebSocket(audioName, videoName, pdfName, pages) {
    const token = app.getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/process?token=${encodeURIComponent(token)}`;

    app.state.ws = new WebSocket(wsUrl);

    app.state.ws.onopen = () => {
      app.updateStatus('processing');
      app.updateProgress(30, 1);

      app.state.ws.send(
        JSON.stringify({
          audio_filename: audioName,
          video_filename: videoName,
          slides_filename: pdfName,
          pages: pages,
          threads: app.state.currentThreads,
        }),
      );
    };

    app.state.ws.onmessage = (event) => {
      const msg = event.data;

      if (msg.startsWith('PROCESS_FAILED::')) {
        const reason = msg.replace('PROCESS_FAILED::', '').trim() || 'Processing failed.';
        app.updateStatus('error');
        app.updateProgress(100, 3);
        app.showToast(reason, 'error');
        setProcessingState(false);
        checkStartReady();
        return;
      }

      if (msg === 'REFRESH_OUTPUTS') {
        app.loadOutputs(true);
        app.loadHistory();

        if (app.dom.statusIndicator && app.dom.statusIndicator.textContent !== 'Error') {
          app.updateStatus('completed');
          app.updateProgress(100, 3);
        }

        const shouldClearInputs = !app.dom.statusIndicator || app.dom.statusIndicator.textContent !== 'Error';

        if (shouldClearInputs) {
          clearAudio();
          clearVideo();
          clearPdf();
          clearYoutube();

          setProcessingState(false);
          if (app.dom.startBtn) app.dom.startBtn.disabled = true;
          app.log('Inputs cleared. Ready for new task.');
          app.setActivePage('notes');
        } else {
          setProcessingState(false);
          checkStartReady();
          app.log('Processing failed; inputs kept so you can retry.');
          app.setActivePage('upload');
        }

        return;
      }

      if (/transcrib/i.test(msg)) {
        app.updateProgress(55, 1);
      } else if (/generat|latex|review|notes/i.test(msg)) {
        app.updateProgress(78, 2);
      } else if (/compil|pdf|cleanup|done/i.test(msg)) {
        app.updateProgress(92, 3);
      }

      app.log(msg);
    };

    app.state.ws.onclose = () => {
      app.log('Connection closed.');
      if (app.dom.statusIndicator && app.dom.statusIndicator.textContent !== 'Completed') {
        setProcessingState(false);
      }
    };

    app.state.ws.onerror = () => {
      app.log('WebSocket error.');
    };
  }

  async function uploadYoutubeToServer(url) {
    const res = await app.authFetch('/upload/youtube', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || 'YouTube download failed');
    }

    return data.filename;
  }

  async function uploadFileToServer(file) {
    const form = new FormData();
    form.append('file', file);

    const res = await app.authFetch('/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Upload error');

    const data = await res.json();
    return data.filename;
  }

  app.bindUpload = function bindUpload() {
    const { audioDropZone, videoDropZone, pdfDropZone, audioInput, videoInput, pdfInput, lectureDropZone, youtubeInput, startBtn } = app.dom;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      document.body.addEventListener(
        eventName,
        (e) => {
          e.preventDefault();
          e.stopPropagation();
        },
        false,
      );
    });

    setupDragDrop(audioDropZone, audioInput, 'audio', onAudioSelected);
    setupDragDrop(videoDropZone, videoInput, 'video', onVideoSelected);
    setupDragDrop(pdfDropZone, pdfInput, 'pdf', onPdfSelected);

    if (youtubeInput) {
      youtubeInput.addEventListener('input', updateYoutubeState);
      youtubeInput.addEventListener('change', updateYoutubeState);
    }

    if (lectureDropZone) {
      ['dragenter', 'dragover'].forEach((eventName) => {
        lectureDropZone.addEventListener(eventName, (e) => {
          if (app.state.isProcessing) return;
          if (lectureDropZone.classList.contains('disabled')) return;
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
        if (app.state.isProcessing) return;
        if (lectureDropZone.classList.contains('disabled')) return;

        const files = e.dataTransfer ? e.dataTransfer.files : null;
        if (!files || files.length <= 0) return;
        const file = files[0];
        const kind = detectTypeForDrop(file);
        if (!kind) {
          app.showToast('Unsupported file type. Upload audio, video, or PDF.', 'error');
          return;
        }

        if (kind === 'audio') handleFiles(files, 'audio', onAudioSelected);
        else if (kind === 'video') handleFiles(files, 'video', onVideoSelected);
        else handleFiles(files, 'pdf', onPdfSelected);
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        const hasSlides = Boolean(app.state.pdfFile);
        const hasSource = Boolean(app.state.audioFile || app.state.videoFile || app.state.youtubeUrl);
        if (!hasSlides && !hasSource) return;

        const token = app.getToken();
        if (!token) {
          app.showToast('Please login first.', 'error');
          return;
        }

        let keyData = null;
        try {
          if (typeof app.getKeyStatus === 'function') {
            keyData = await app.getKeyStatus();
          }
        } catch (_) {
          // ignore
        }

        if (keyData && !keyData.is_set) {
          app.showToast('Gemini API Key is missing! Please configure it in Settings.', 'error');
          if (typeof app.openSettingsModal === 'function') app.openSettingsModal();
          return;
        }

        setProcessingState(true);
        app.setActivePage('processing');
        app.updateStatus('processing');
        app.updateProgress(12, 0);
        app.log('Starting upload...');

        try {
          let audioFilename = null;
          let videoFilename = null;
          let pdfFilename = null;

          if (app.state.youtubeUrl) {
            app.log('Downloading YouTube audio...');
            audioFilename = await uploadYoutubeToServer(app.state.youtubeUrl);
            app.log(`YouTube audio ready: ${audioFilename}`);
          } else if (app.state.audioFile) {
            audioFilename = await uploadFileToServer(app.state.audioFile);
            app.log(`Audio uploaded: ${audioFilename}`);
          }

          if (app.state.videoFile) {
            videoFilename = await uploadFileToServer(app.state.videoFile);
            app.log(`Video uploaded: ${videoFilename}`);
          }

          if (app.state.pdfFile) {
            pdfFilename = await uploadFileToServer(app.state.pdfFile);
            app.log(`PDF uploaded: ${pdfFilename}`);
          }

          startWebSocket(audioFilename, videoFilename, pdfFilename, app.dom.pagesInput ? app.dom.pagesInput.value : '');
        } catch (err) {
          app.log(`❌ Error: ${err.message || err}`);
          setProcessingState(false);
          app.updateStatus('error');
          app.updateProgress(0, 0);
        }
      });
    }

    checkStartReady();
  };
})();
