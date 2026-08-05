(() => {
  const app = (window.AudioTTo = window.AudioTTo || {});

  app.updateStatus = function updateStatus(state) {
    const { statusIndicator, statusPill } = app.dom;

    if (!statusIndicator) return;

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
  };

  app.updateProgress = function updateProgress(percent, stepIndex = 0) {
    const { progressFill, progressLabel, progressSteps } = app.dom;
    const clamped = Math.min(100, Math.max(0, percent));

    if (progressFill) progressFill.style.width = `${clamped}%`;
    if (progressLabel) progressLabel.textContent = `${clamped}%`;

    if (progressSteps) {
      progressSteps.forEach((step, index) => {
        step.classList.toggle('active', index <= stepIndex);
      });
    }
  };

  app.log = function log(message) {
    const { terminalWindow } = app.dom;
    if (!terminalWindow) return;

    if (typeof message !== 'string') {
      message = String(message);
    }

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
  };

  app.bindTerminalToggle = function bindTerminalToggle() {
    const { terminalSection, terminalToggleBtn } = app.dom;
    if (!terminalSection || !terminalToggleBtn) return;

    terminalToggleBtn.addEventListener('click', () => {
      terminalSection.classList.toggle('collapsed');
      terminalToggleBtn.textContent = terminalSection.classList.contains('collapsed') ? 'Expand' : 'Collapse';
    });
  };
})();
