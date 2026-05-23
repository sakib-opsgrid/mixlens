/**
 * MixLens — app.js
 * Main application controller.
 * Wires together file input, Web Audio decoding, analysis, and UI rendering.
 */

'use strict';

(() => {

  // ── DOM refs ─────────────────────────────────────────────────
  const dropZone      = document.getElementById('dropZone');
  const fileInput     = document.getElementById('fileInput');
  const loadingState  = document.getElementById('loadingState');
  const loadingText   = document.getElementById('loadingText');
  const results       = document.getElementById('results');
  const btnReset      = document.getElementById('btnReset');
  const waveformCanvas = document.getElementById('waveformCanvas');
  const spectrumCanvas = document.getElementById('spectrumCanvas');

  // ── State ────────────────────────────────────────────────────
  let audioCtx = null;
  let currentFile = null;
  let analysisReport = null;

  // ── Audio Context (lazy init) ────────────────────────────────
  function getAudioContext() {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  // ── Loading Steps ────────────────────────────────────────────
  const STEPS = [
    'Reading file…',
    'Decoding audio…',
    'Analysing waveform…',
    'Computing spectrum…',
    'Scoring mix…',
    'Building report…',
  ];

  function setLoading(stepIndex) {
    loadingText.textContent = STEPS[Math.min(stepIndex, STEPS.length - 1)];
  }

  // ── File Handling ─────────────────────────────────────────────
  async function handleFile(file) {
    if (!file) return;

    // Validate type
    const allowed = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3',
                     'audio/flac', 'audio/x-flac', 'audio/ogg', 'audio/aiff',
                     'audio/x-aiff', 'audio/aif'];
    const ext = file.name.split('.').pop().toLowerCase();
    const allowedExts = ['wav','mp3','flac','ogg','aiff','aif'];

    if (!allowedExts.includes(ext)) {
      showError(`Unsupported file type ".${ext}". Please use WAV, MP3, FLAC, AIFF, or OGG.`);
      return;
    }

    currentFile = file;
    showLoading();

    try {
      setLoading(0);
      const arrayBuffer = await readFileAsArrayBuffer(file);

      setLoading(1);
      const ctx = getAudioContext();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      setLoading(2);
      await tick(); // yield to browser

      setLoading(3);
      const report = Analyzer.analyze(audioBuffer);
      analysisReport = report;

      setLoading(4);
      await tick();

      setLoading(5);
      renderReport(report, file);

    } catch (err) {
      console.error('[MixLens] Analysis error:', err);
      showError('Could not decode audio file. Make sure the file is not corrupt and is a supported format.');
    }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  function tick() {
    return new Promise(r => setTimeout(r, 16));
  }

  // ── Render Report ────────────────────────────────────────────
  function renderReport(report, file) {
    UI.renderFileInfo(file, report.meta);
    UI.renderScore(report.score);
    UI.renderIssues(report.issues);
    UI.renderMetrics(report.metrics);
    UI.renderFreqBands(report.bands);
    UI.renderActions(report.actions);
    UI.renderPlatforms(report.platforms, report.metrics.rmsDb);

    showResults();

    // Canvases need the element to be visible first
    requestAnimationFrame(() => {
      UI.renderWaveform(waveformCanvas, report.visual.waveformData);
      UI.renderSpectrum(spectrumCanvas, report.visual.freqs, report.visual.spectrum);
    });
  }

  // ── State Transitions ────────────────────────────────────────
  function showLoading() {
    dropZone.classList.add('hidden');
    results.classList.add('hidden');
    loadingState.classList.remove('hidden');
  }

  function showResults() {
    loadingState.classList.add('hidden');
    results.classList.remove('hidden');
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showDropZone() {
    results.classList.add('hidden');
    loadingState.classList.add('hidden');
    dropZone.classList.remove('hidden');
    fileInput.value = '';
    currentFile = null;
    analysisReport = null;
  }

  function showError(message) {
    loadingState.classList.add('hidden');
    dropZone.classList.remove('hidden');

    // Show inline error
    const existing = document.getElementById('errorMsg');
    if (existing) existing.remove();

    const err = document.createElement('p');
    err.id = 'errorMsg';
    err.style.cssText = 'color:#ff4d4d;font-size:13px;margin-top:1rem;';
    err.textContent = '⚠ ' + message;
    dropZone.querySelector('.drop-inner').appendChild(err);

    setTimeout(() => err.remove(), 6000);
  }

  // ── Drag & Drop ──────────────────────────────────────────────
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  dropZone.addEventListener('click', e => {
    if (e.target === dropZone || e.target.closest('.drop-inner')) {
      // Don't re-trigger if user clicked the label (it handles its own input)
      if (!e.target.closest('label')) fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });

  // ── Reset ────────────────────────────────────────────────────
  btnReset.addEventListener('click', showDropZone);

  // ── Resize: re-draw canvases ─────────────────────────────────
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (analysisReport && !results.classList.contains('hidden')) {
        UI.renderWaveform(waveformCanvas, analysisReport.visual.waveformData);
        UI.renderSpectrum(spectrumCanvas, analysisReport.visual.freqs, analysisReport.visual.spectrum);
      }
    }, 200);
  });

  // ── Keyboard accessibility for drop zone ─────────────────────
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropZone.setAttribute('tabindex', '0');
  dropZone.setAttribute('role', 'button');
  dropZone.setAttribute('aria-label', 'Click or drag an audio file to analyse');

})();
