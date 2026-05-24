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

/* ═══════════════════════════════════════════════
   Smart Mix Advisor — inline slider engine
═══════════════════════════════════════════════ */
(() => {

  const ADV_BANDS = [
    { key:'sub',    label:'Sub Bass',  range:'20–60 Hz',   ideal:[-5,-2],
      heavy:'Makes the mix boom and sound muddy — especially bad on earbuds and car speakers.',
      low:  'Missing sub-bass weight. Sounds thin on large speakers and club systems.',
      tool: 'Low-cut below 30 Hz + narrow notch at 50–60 Hz' },
    { key:'bass',   label:'Bass',      range:'60–250 Hz',  ideal:[-3,1],
      heavy:'Too much bass — kick and bass will clash. Mix sounds boomy and loses definition.',
      low:  'Lacks warmth and body. Sounds thin on any decent playback system.',
      tool: 'Parametric EQ: gentle cut at 120–180 Hz, Q = 0.8' },
    { key:'lowmid', label:'Low Mid',   range:'250–500 Hz', ideal:[-3,1],
      heavy:'Boxy, nasal, cardboard-y. The most common mastering problem — easy to over-do.',
      low:  'Mix sounds hollow and scooped. Lacks the warmth that fills out a commercial sound.',
      tool: 'Parametric EQ: narrow cut at 300–400 Hz, Q = 1.2' },
    { key:'mid',    label:'Mid',       range:'500 Hz–2k',  ideal:[-1,3],
      heavy:'Honky and harsh midrange. Extended listening becomes fatiguing quickly.',
      low:  'Vocals and instruments lack body and cut-through. Mix sounds distant.',
      tool: 'Broad bell boost/cut at 800 Hz–1.2 kHz, Q = 0.7' },
    { key:'himid',  label:'High Mid',  range:'2–6 kHz',    ideal:[0,4],
      heavy:'Harsh and aggressive. Sibilance becomes painful on headphones and earbuds.',
      low:  'Lack of definition and presence. Mix sounds veiled or behind glass.',
      tool: 'De-esser on harsh elements + gentle shelf cut at 3–4 kHz' },
    { key:'air',    label:'Air',       range:'10–20 kHz',  ideal:[2,5],
      heavy:'Fizzy, artificially hyped top-end. Fatiguing on good headphones.',
      low:  'No sparkle or air. Vocals sound dull, cymbals sound dead. This is your biggest EQ gap.',
      tool: 'High shelf boost: +2 to +3 dB at 12 kHz, Pultec-style' },
  ];

  function $ (id) { return document.getElementById(id); }

  function pillClass(status) {
    return 'adv-pill adv-pill-' + status;
  }

  function tipClass(status) {
    return 'adv-tip adv-tip-' + status;
  }

  /* Build band sliders */
  function buildBands() {
    const wrap = $('adv-bands-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    ADV_BANDS.forEach(b => {
      const sec = document.createElement('div');
      sec.className = 'adv-section';
      sec.innerHTML = `
        <div class="adv-sec-title">${b.label.toUpperCase()} &mdash; ${b.range}</div>
        <div class="adv-row">
          <span class="adv-label">${b.label} <span class="adv-pill adv-pill-good" id="adv-badge-${b.key}">✓ Balanced</span></span>
          <input type="range" id="adv-sl-${b.key}" min="-12" max="8" step="0.5" value="0"/>
          <span class="adv-val" id="adv-val-${b.key}">0.0 dB</span>
        </div>
        <div class="adv-tip adv-tip-good" id="adv-tip-${b.key}">
          <div class="adv-tip-main" id="adv-tip-${b.key}-main">Balanced — ${b.range} is sitting well in the spectrum.</div>
          <div class="adv-tip-why" id="adv-tip-${b.key}-why"></div>
          <div class="adv-tip-tool">Tool: <code>${b.tool}</code></div>
        </div>`;
      wrap.appendChild(sec);
      $(`adv-sl-${b.key}`).addEventListener('input', () => updateBand(b));
    });
  }

  function updateBand(b) {
    const v = parseFloat($(`adv-sl-${b.key}`).value);
    const valEl = $(`adv-val-${b.key}`);
    valEl.textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';

    let status, pillTxt;
    if (v >= b.ideal[0] && v <= b.ideal[1]) {
      status = 'good'; pillTxt = '✓ Balanced';
    } else if (v < b.ideal[0] - 4 || v > b.ideal[1] + 4) {
      status = 'bad';  pillTxt = v < b.ideal[0] ? '↑ Too thin' : '↓ Too heavy';
    } else {
      status = 'warn'; pillTxt = v < b.ideal[0] ? '↑ Boost' : '↓ Cut';
    }

    $(`adv-badge-${b.key}`).className = pillClass(status);
    $(`adv-badge-${b.key}`).textContent = pillTxt;
    $(`adv-tip-${b.key}`).className = tipClass(status);

    const main = $(`adv-tip-${b.key}-main`);
    const why  = $(`adv-tip-${b.key}-why`);

    if (status === 'good') {
      main.textContent = `${b.label} (${b.range}) is balanced — no correction needed here.`;
      why.textContent  = 'Move on to the next band. Trust your ears and reference a commercial track.';
    } else if (v < b.ideal[0]) {
      const gap = (b.ideal[0] - v).toFixed(1);
      main.textContent = `${b.label} is ${gap} dB too thin. ${b.low}`;
      why.textContent  = `Boost ${gap} dB toward the centre of the ${b.range} band with a broad shelf or gentle bell (Q ≈ 0.8). Do it in 0.5 dB increments.`;
    } else {
      const over = (v - b.ideal[1]).toFixed(1);
      main.textContent = `${b.label} is ${over} dB too heavy. ${b.heavy}`;
      why.textContent  = `Cut ${over} dB with a broad parametric (Q ≈ 0.7–1.0). Cuts should feel subtle — if you notice them immediately, you went too far.`;
    }

    calcAdvScore();
  }

  function updateLufs() {
    const v = parseFloat($('adv-sl-lufs').value);
    const sign = v < 0 ? '−' : '';
    $('adv-val-lufs').textContent = sign + Math.abs(v).toFixed(1);

    let status, pillTxt, main, why;
    if (v >= -16 && v <= -12) {
      status='good'; pillTxt='✓ Perfect';
      main = `${sign}${Math.abs(v).toFixed(1)} LUFS — perfect for streaming. Spotify, YouTube, and Apple Music will not adjust your track.`;
      why  = 'This is the professional sweet spot. Your track will compete loudness-wise with commercial releases without sounding compressed.';
    } else if (v < -20) {
      const gap = (Math.abs(v) - 14).toFixed(1);
      status='bad'; pillTxt='↑ Too quiet';
      main = `${gap} LUFS below target — critical issue. Your track will sound noticeably softer than everything else in a playlist.`;
      why  = 'Add makeup gain on your master limiter in 0.5 dB increments. Monitor with a LUFS meter (not a peak meter). Target −14 LUFS integrated.';
    } else if (v < -16) {
      const gap = (Math.abs(v) - 14).toFixed(1);
      status='warn'; pillTxt='↑ Raise it';
      main = `${gap} LUFS below target. Streaming platforms may turn you up, which can expose noise floor issues.`;
      why  = 'Gently increase limiter makeup gain. Check for artefacts at each step — transparency is more important than hitting the number exactly.';
    } else if (v > -8) {
      status='bad'; pillTxt='↓ Brickwalled';
      main = `${sign}${Math.abs(v).toFixed(1)} LUFS — severely over-limited. Dynamic range is crushed. Sounds flat, lifeless, and fatiguing.`;
      why  = 'Pull back makeup gain. Ease bus compression. Reduce limiting aggressiveness. Target at least 8 dB of dynamic range before worrying about loudness.';
    } else {
      status='warn'; pillTxt='↓ Slightly hot';
      main = `Slightly above ideal. Platforms may apply minor normalisation downward — dynamic range may start to suffer here.`;
      why  = 'Pull back 1–2 dB on your limiter. Confirm dynamic range is still above 8 dB.';
    }

    $('adv-badge-lufs').className = pillClass(status);
    $('adv-badge-lufs').textContent = pillTxt;
    $('adv-tip-lufs').className = tipClass(status);
    $('adv-tip-lufs-main').textContent = main;
    $('adv-tip-lufs-why').textContent  = why;
    calcAdvScore();
  }

  function updateComp() {
    const v = parseFloat($('adv-sl-comp').value);
    $('adv-val-comp').textContent = v.toFixed(1) + ':1';

    let status, pillTxt, main, why;
    if (v >= 2 && v <= 4) {
      status='good'; pillTxt='✓ Ideal';
      main = `${v.toFixed(1)}:1 — ideal for mastering. Gentle enough to preserve dynamics, strong enough to glue the mix.`;
      why  = 'Set attack slow (30–50ms) so transients pass through. Release auto or 200–400ms. Aim for 2–4 dB of gain reduction on peaks only.';
    } else if (v < 2) {
      status='warn'; pillTxt='↑ Add more';
      main = `${v.toFixed(1)}:1 — too light. Loudest peaks are uncontrolled, which limits how loud you can master without distortion.`;
      why  = 'Start at 2:1 with slow attack (30ms) and auto release. Check gain reduction meter — you want 2–3 dB of GR on the loudest hits.';
    } else if (v <= 5) {
      status='warn'; pillTxt='⚠ Getting heavy';
      main = `${v.toFixed(1)}:1 — transient punch is starting to suffer. Kick and snare may sound softer than they should.`;
      why  = 'Ease back to 3–4:1. If you need this much compression, something in the mix may need addressing first.';
    } else {
      status='bad'; pillTxt='↓ Too heavy';
      main = `${v.toFixed(1)}:1 — far too heavy for mastering. The mix will sound flat and lifeless.`;
      why  = 'Master bus compression should be invisible — the listener should not be able to tell it is there. Drop to 2–3:1.';
    }

    $('adv-badge-comp').className = pillClass(status);
    $('adv-badge-comp').textContent = pillTxt;
    $('adv-tip-comp').className = tipClass(status);
    $('adv-tip-comp-main').textContent = main;
    $('adv-tip-comp-why').textContent  = why;
    calcAdvScore();
  }

  function updateWidth() {
    const v = parseInt($('adv-sl-width').value);
    $('adv-val-width').textContent = (v >= 0 ? '+' : '') + v + '%';

    let status, pillTxt, main;
    if (v >= -15 && v <= 25) {
      status='good'; pillTxt='✓ Safe';
      main = `Width at ${v >= 0 ? '+' : ''}${v}% — mono-compatible and safe for all playback systems including phone speakers and club PA.`;
    } else if (v < -15) {
      status='warn'; pillTxt='↓ Narrowing';
      main = `Narrowing the stereo image. Can feel more focused, but too much sounds unnatural and small — like it is coming from a single point.`;
    } else if (v <= 55) {
      status='warn'; pillTxt='⚠ Check mono';
      main = `At +${v}% you may encounter phase cancellation on mono playback. Test with a mono speaker before finalising.`;
    } else {
      status='bad'; pillTxt='↓ Phase risk';
      main = `+${v}% — excessive widening. Severe phase cancellation in mono. Club PA and phone speakers will sound broken or hollow.`;
    }

    $('adv-badge-width').className = pillClass(status);
    $('adv-badge-width').textContent = pillTxt;
    $('adv-tip-width').className = tipClass(status);
    $('adv-tip-width-main').textContent = main;
    calcAdvScore();
  }

  function calcAdvScore() {
    let s = 100;
    const lufs  = parseFloat($('adv-sl-lufs').value);
    const comp  = parseFloat($('adv-sl-comp').value);
    const width = parseInt($('adv-sl-width').value);

    if      (lufs < -20)          s -= 22;
    else if (lufs < -16)          s -= 12;
    else if (lufs > -8)           s -= 22;
    else if (lufs > -10)          s -= 8;

    if      (comp < 2)            s -= 8;
    else if (comp > 6)            s -= 12;

    if      (width > 60 || width < -30) s -= 10;
    else if (width > 30)          s -= 4;

    ADV_BANDS.forEach(b => {
      const v = parseFloat($(`adv-sl-${b.key}`).value);
      if      (v < b.ideal[0] - 5 || v > b.ideal[1] + 5) s -= 8;
      else if (v < b.ideal[0] - 2 || v > b.ideal[1] + 2) s -= 4;
      else if (v < b.ideal[0]     || v > b.ideal[1])      s -= 1;
    });

    s = Math.max(0, Math.min(100, Math.round(s)));

    const color =
      s >= 80 ? '#3dd68c' :
      s >= 60 ? '#ffb224' : '#ff4545';

    $('advScore').textContent = s;
    $('advScore').style.color = color;
    $('advBar').style.width   = s + '%';
    $('advBar').style.background = color;

    const grade =
      s >= 90 ? 'Excellent — release ready' :
      s >= 80 ? 'Good — minor fixes needed' :
      s >= 65 ? 'Fair — several issues' :
      s >= 50 ? 'Poor — needs significant work' :
               'Critical — do not release yet';

    $('advGrade').textContent = grade;
    $('advGrade').style.color = color;

    const issues = [lufs<-16||lufs>-8, comp<2||comp>6, width>50].filter(Boolean).length
      + ADV_BANDS.filter(b => {
          const v = parseFloat($(`adv-sl-${b.key}`).value);
          return v < b.ideal[0]-2 || v > b.ideal[1]+2;
        }).length;

    $('advVerdict').textContent =
      s >= 80
        ? 'Looking solid. Final step: A/B compare against 3 commercial tracks at matched loudness. Listen on earbuds, laptop speakers, and a mono Bluetooth speaker.'
        : s >= 65
        ? 'Getting there. Address the red and amber items above — start with loudness, then frequency balance.'
        : `${issues} issue${issues !== 1 ? 's' : ''} flagged. Work through them top to bottom — loudness and clipping first, EQ last.`;
  }

  /* Init */
  buildBands();

  $('adv-sl-lufs').addEventListener('input', updateLufs);
  $('adv-sl-comp').addEventListener('input', updateComp);
  $('adv-sl-width').addEventListener('input', updateWidth);
  ADV_BANDS.forEach(b => $(`adv-sl-${b.key}`).addEventListener('input', () => updateBand(b)));

  updateLufs(); updateComp(); updateWidth();
  ADV_BANDS.forEach(b => updateBand(b));

})();
