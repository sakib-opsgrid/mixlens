/**
 * MixLens — app.js  |  by Nickson Rizvi 2026
 * Application controller. Fixes decodeAudioData ArrayBuffer consumption.
 */

'use strict';

(() => {

  /* ── DOM ────────────────────────────────────── */
  const uploadSection  = document.getElementById('uploadSection');
  const loadingSection = document.getElementById('loadingSection');
  const resultsSection = document.getElementById('resultsSection');
  const dropZone       = document.getElementById('dropZone');
  const fileInput      = document.getElementById('fileInput');
  const loadingStep    = document.getElementById('loadingStep');
  const loadingBar     = document.getElementById('loadingBar');
  const dropError      = document.getElementById('dropError');
  const btnNew         = document.getElementById('btnNew');
  const waveCanvas     = document.getElementById('waveCanvas');
  const specCanvas     = document.getElementById('specCanvas');

  /* ── State ──────────────────────────────────── */
  let audioCtx = null;
  let report   = null;

  /* ── AudioContext ───────────────────────────── */
  function getCtx() {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint:'playback' });
    }
    // Resume if suspended (browser autoplay policy)
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  /* ── Progress ───────────────────────────────── */
  const STEPS = [
    [5,  'Reading file…'],
    [15, 'Decoding audio…'],
    [30, 'Computing LUFS…'],
    [50, 'Analysing spectrum…'],
    [70, 'Scoring mix…'],
    [85, 'Detecting issues…'],
    [95, 'Building report…'],
    [100,'Done.'],
  ];

  function setStep(idx) {
    const [pct, label] = STEPS[Math.min(idx, STEPS.length-1)];
    loadingStep.textContent = label;
    loadingBar.style.width  = pct+'%';
  }

  /* ── File entry point ───────────────────────── */
  async function handleFile(file) {
    if (!file) return;

    clearError();

    // Extension check
    const ext = file.name.split('.').pop().toLowerCase();
    const ok  = ['wav','mp3','aiff','aif','flac','ogg'];
    if (!ok.includes(ext)) {
      showError(`".${ext}" is not supported. Use WAV, MP3, FLAC, AIFF or OGG.`);
      return;
    }

    // File size sanity (warn above 300 MB)
    if (file.size > 300*1024*1024) {
      showError('File is larger than 300 MB. Analysis may be slow.');
    }

    showLoading();

    try {
      setStep(0);
      const rawBuffer = await readFile(file);

      setStep(1);
      // ── KEY FIX ──────────────────────────────────────────────────
      // decodeAudioData() CONSUMES (detaches) the ArrayBuffer.
      // We must slice a copy BEFORE calling decode, so we still have
      // the original bytes if we need them again.
      const bufferCopy = rawBuffer.slice(0);
      const ctx = getCtx();

      let audioBuffer;
      try {
        // Modern promise-based API
        audioBuffer = await ctx.decodeAudioData(bufferCopy);
      } catch (decodeErr) {
        // Some browsers need the old callback form; retry
        audioBuffer = await decodeAudioDataFallback(ctx, rawBuffer.slice(0));
      }
      // ─────────────────────────────────────────────────────────────

      setStep(2);
      await tick();

      setStep(3);
      await tick();

      setStep(4);
      const r = Analyzer.analyze(audioBuffer);
      report = r;

      setStep(5);
      await tick();

      setStep(6);
      renderReport(r, file);

      setStep(7);
    } catch (err) {
      console.error('[MixLens]', err);
      const msg = err.message || String(err);
      if (msg.toLowerCase().includes('decode') || msg.toLowerCase().includes('format')) {
        showError('Could not decode audio. Ensure the file is not corrupt and is a valid audio format. FLAC may not be supported in all browsers — try WAV or MP3.');
      } else {
        showError(`Analysis failed: ${msg}`);
      }
      showUpload();
    }
  }

  /* ── Read file as ArrayBuffer ───────────────── */
  function readFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = () => rej(new Error('FileReader failed'));
      r.readAsArrayBuffer(file);
    });
  }

  /* ── Fallback decode (callback form) ─────────── */
  function decodeAudioDataFallback(ctx, buf) {
    return new Promise((res, rej) => {
      ctx.decodeAudioData(buf, res, rej);
    });
  }

  function tick() { return new Promise(r => setTimeout(r, 20)); }

  /* ── Render ─────────────────────────────────── */
  function renderReport(r, file) {
    UI.renderFileInfo(file, r.meta);
    UI.renderScore(r.score);
    UI.renderQuickMetrics(r.m);
    UI.renderFreqBands(r.bands);
    UI.renderIssues(r.issues);
    UI.renderActions(r.actions);
    UI.renderPlatforms(r.platforms);

    showResults();

    // Canvases only render correctly once visible
    requestAnimationFrame(() => {
      UI.renderWaveform(waveCanvas, r.visual.waveEnv, r.m.clippedPct);
      UI.renderSpectrum(specCanvas, r.visual.freqs, r.visual.specDb);
    });
  }

  /* ── State transitions ──────────────────────── */
  function showUpload() {
    uploadSection.classList.remove('hidden');
    loadingSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    fileInput.value = '';
    report = null;
  }

  function showLoading() {
    uploadSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    loadingSection.classList.remove('hidden');
    loadingBar.style.width = '0%';
  }

  function showResults() {
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
  }

  /* ── Error display ──────────────────────────── */
  function showError(msg) {
    dropError.textContent = msg;
    dropError.classList.remove('hidden');
  }

  function clearError() {
    dropError.textContent = '';
    dropError.classList.add('hidden');
  }

  /* ── Drag & Drop ────────────────────────────── */
  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
  });

  ['dragleave','dragend'].forEach(ev => {
    dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-active'));
  });

  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  /* ── File input ─────────────────────────────── */
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) handleFile(f);
  });

  /* ── Drop zone click ────────────────────────── */
  dropZone.addEventListener('click', e => {
    if (!e.target.closest('label')) fileInput.click();
  });

  dropZone.addEventListener('keydown', e => {
    if (e.key==='Enter'||e.key===' ') { e.preventDefault(); fileInput.click(); }
  });

  /* ── Reset ──────────────────────────────────── */
  btnNew.addEventListener('click', showUpload);

  /* ── Resize: redraw canvases ─────────────────── */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (report && !resultsSection.classList.contains('hidden')) {
        UI.renderWaveform(waveCanvas, report.visual.waveEnv, report.m.clippedPct);
        UI.renderSpectrum(specCanvas, report.visual.freqs, report.visual.specDb);
      }
    }, 150);
  });

  /* ── Global drag-over on body (prevent browser open) ── */
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f && !loadingSection.classList.contains('hidden') === false) handleFile(f);
  });

})();
