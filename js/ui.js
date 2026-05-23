/**
 * MixLens — ui.js
 * Handles all DOM rendering and canvas drawing.
 */

'use strict';

const UI = (() => {

  // ── Helpers ─────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function formatDb(db, decimals = 1) {
    return `${db >= 0 ? '+' : ''}${db.toFixed(decimals)} dBFS`;
  }

  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function badgeClass(level) {
    const map = { good: 'badge-good', warning: 'badge-warning', critical: 'badge-critical', info: 'badge-info' };
    return map[level] || 'badge-info';
  }

  function barColor(level) {
    const map = { good: '#c8ff00', warning: '#ffaa00', critical: '#ff4d4d', info: '#4da6ff' };
    return map[level] || '#4da6ff';
  }

  // ── Score Ring ───────────────────────────────────────────────
  function renderScore(score) {
    const circumference = 314;
    const offset = circumference - (score / 100) * circumference;
    const ring = $('ringFill');

    // Color based on score
    let color = '#c8ff00';
    if (score < 50) color = '#ff4d4d';
    else if (score < 70) color = '#ffaa00';

    ring.style.stroke = color;
    // Animate
    ring.style.strokeDashoffset = circumference;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ring.style.strokeDashoffset = offset;
      });
    });

    $('ringNum').textContent = score;
    $('scoreNumber').textContent = score;
    $('scoreNumber').style.color = color;

    let verdict = 'Excellent — release ready.';
    if (score < 40) verdict = 'Needs significant work before release.';
    else if (score < 60) verdict = 'Several issues to address.';
    else if (score < 75) verdict = 'Good progress — a few fixes needed.';
    else if (score < 90) verdict = 'Almost there — minor tweaks remaining.';
    $('scoreVerdict').textContent = verdict;
  }

  // ── File Info ────────────────────────────────────────────────
  function renderFileInfo(file, meta) {
    $('fileName').textContent = file.name;
    $('fileDuration').textContent = formatDuration(meta.duration);
    $('fileSampleRate').textContent = `${(meta.sampleRate / 1000).toFixed(1)} kHz`;
    $('fileChannels').textContent = meta.numChannels === 1 ? 'Mono' : 'Stereo';
    $('fileSize').textContent = formatSize(file.size);
  }

  // ── Issues ───────────────────────────────────────────────────
  function renderIssues(issues) {
    const list = $('issueList');
    list.innerHTML = '';

    const problems = issues.filter(i => i.severity !== 'good');
    $('issueCount').textContent = `${problems.length} issue${problems.length !== 1 ? 's' : ''}`;

    issues.forEach(issue => {
      const card = document.createElement('div');
      card.className = `issue-card severity-${issue.severity}`;
      card.setAttribute('role', 'listitem');

      card.innerHTML = `
        <div class="issue-icon" aria-hidden="true">${issue.icon}</div>
        <div class="issue-body">
          <div class="issue-title">${escapeHtml(issue.title)}</div>
          <div class="issue-desc">${escapeHtml(issue.desc)}</div>
          ${issue.fix ? `<div class="issue-fix">↳ ${escapeHtml(issue.fix)}</div>` : ''}
        </div>`;

      list.appendChild(card);
    });
  }

  // ── Metric Cards ─────────────────────────────────────────────
  function setMetric(id, { value, displayValue, barPct, level, tip }) {
    $(`val-${id}`).textContent = displayValue;
    const badge = $(`badge-${id}`);
    badge.textContent = level.toUpperCase();
    badge.className = `metric-badge ${badgeClass(level)}`;
    const bar = $(`bar-${id}`);
    bar.style.width = '0%';
    bar.style.background = barColor(level);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { bar.style.width = `${Math.max(2, Math.min(100, barPct))}%`; });
    });
    $(`tip-${id}`).textContent = tip;
  }

  function renderMetrics(metrics) {
    const { peakDb, rmsDb, dynamicRange, clippedSamples, correlation } = metrics;

    // Peak
    const peakLevel = peakDb > -0.5 ? 'critical' : peakDb > -3 ? 'warning' : 'good';
    setMetric('peak', {
      displayValue: formatDb(peakDb),
      barPct: Math.max(0, (peakDb + 60) / 60 * 100),
      level: peakLevel,
      tip: peakDb > -0.5
        ? 'Too close to 0 dBFS. Risk of true-peak clipping after codec conversion. Target ≤ -1.0 dBFS.'
        : peakDb > -3
        ? 'Acceptable peak level, but keep an eye on it.'
        : 'Good headroom. Peak is safe for streaming delivery.',
    });

    // RMS Loudness
    const rmsLevel = rmsDb < -20 ? 'critical' : rmsDb > -8 ? 'critical' : rmsDb < -16 ? 'warning' : 'good';
    setMetric('rms', {
      displayValue: formatDb(rmsDb),
      barPct: Math.max(0, (rmsDb + 40) / 32 * 100),
      level: rmsLevel,
      tip: rmsDb < -20
        ? `Too quiet. Need ~${Math.abs(rmsDb - (-14)).toFixed(1)} dB of gain to reach -14 LUFS streaming target.`
        : rmsDb > -8
        ? 'Over-compressed. Pull back limiting to preserve dynamics.'
        : rmsDb < -16
        ? `Slightly below target. Aim for -14 LUFS. Current: ~${Math.abs(rmsDb - (-14)).toFixed(1)} dB short.`
        : 'Loudness is in the professional streaming range.',
    });

    // Dynamic Range
    const drLevel = dynamicRange < 5 ? 'critical' : dynamicRange < 8 ? 'warning' : dynamicRange > 22 ? 'info' : 'good';
    setMetric('dr', {
      displayValue: `${dynamicRange.toFixed(1)} dB`,
      barPct: Math.min(100, (dynamicRange / 30) * 100),
      level: drLevel,
      tip: dynamicRange < 5
        ? 'Severely limited. Transients are squashed. Reduce compression and limiting.'
        : dynamicRange < 8
        ? 'Slightly compressed. Commercial but tight. Consider backing off the limiter by 1 dB.'
        : dynamicRange > 22
        ? 'Wide dynamic range — great for audiophile/classical, but may feel inconsistent on consumer devices.'
        : 'Healthy dynamic range. Good punch and life in the mix.',
    });

    // Stereo Correlation
    const stereoLevel = correlation < 0.3 ? 'critical' : correlation < 0.5 ? 'warning' : 'good';
    setMetric('stereo', {
      displayValue: correlation.toFixed(2),
      barPct: ((correlation + 1) / 2) * 100,
      level: stereoLevel,
      tip: correlation < 0.3
        ? 'Severe phase issues. Track will sound hollow or cancel in mono. Check for out-of-phase instruments.'
        : correlation < 0.5
        ? 'Some cancellation risk in mono. Keep low frequencies centred. Use a mono compatibility check.'
        : correlation > 0.95
        ? 'Very high correlation — mix may be slightly narrow in stereo image.'
        : 'Good stereo correlation. Mono-compatible with a healthy stereo width.',
    });

    // Clipping
    const clipLevel = clippedSamples > 1000 ? 'critical' : clippedSamples > 0 ? 'warning' : 'good';
    setMetric('clip', {
      displayValue: clippedSamples.toLocaleString(),
      barPct: Math.min(100, (clippedSamples / 5000) * 100),
      level: clipLevel,
      tip: clippedSamples > 1000
        ? 'Severe clipping — audible distortion. Must fix before any release.'
        : clippedSamples > 0
        ? `${clippedSamples} clipped sample(s). Reduce limiter ceiling by 0.3 dB.`
        : 'No clipping detected. Clean master.',
    });

    // Crest Factor
    const crestLevel = dynamicRange < 5 ? 'critical' : dynamicRange < 8 ? 'warning' : 'good';
    setMetric('crest', {
      displayValue: `${dynamicRange.toFixed(1)} dB`,
      barPct: Math.min(100, (dynamicRange / 25) * 100),
      level: crestLevel,
      tip: 'Crest factor = Peak − RMS. Higher = more dynamic. Commercial music typically 8–14 dB. EDM/Hip-hop 6–10 dB. Classical 15–25 dB.',
    });
  }

  // ── Frequency Bands ──────────────────────────────────────────
  function renderFreqBands(bands) {
    const grid = $('freqGrid');
    grid.innerHTML = '';

    bands.forEach(band => {
      const card = document.createElement('div');
      card.className = `freq-card status-${band.status}`;

      const rangeStr = band.low >= 1000
        ? `${(band.low/1000).toFixed(0)}k–${(band.high/1000).toFixed(0)}k Hz`
        : `${band.low}–${band.high >= 1000 ? (band.high/1000).toFixed(0)+'k' : band.high} Hz`;

      const statusLabel = band.status === 'ok' ? 'Balanced' : band.status === 'heavy' ? 'Too heavy' : 'Too thin';
      const dbStr = isFinite(band.energyDb) ? `${band.energyDb.toFixed(1)} dB` : '—';

      card.innerHTML = `
        <div class="freq-band">${escapeHtml(band.shortName)}</div>
        <div class="freq-range">${rangeStr}</div>
        <div class="freq-value">${dbStr}</div>
        <div class="freq-status">${statusLabel}</div>`;

      grid.appendChild(card);
    });
  }

  // ── Waveform Canvas ──────────────────────────────────────────
  function renderWaveform(canvas, waveformData) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 860;
    const h = 140;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const midY = h / 2;
    const n = waveformData.length;

    // Background grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach(frac => {
      const y = midY - frac * midY;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, midY + frac * midY); ctx.lineTo(w, midY + frac * midY); ctx.stroke();
    });

    // Centre line
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(w, midY); ctx.stroke();

    // Waveform fill
    const barW = Math.max(1, w / n);

    ctx.fillStyle = 'rgba(200,255,0,0.18)';
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w;
      const amp = waveformData[i] * midY * 0.95;
      ctx.fillRect(x, midY - amp, barW - 0.5, amp * 2);
    }

    // Waveform outline (top)
    ctx.beginPath();
    ctx.strokeStyle = '#c8ff00';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * w + barW / 2;
      const y = midY - waveformData[i] * midY * 0.95;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Clipping threshold lines
    ctx.strokeStyle = 'rgba(255,77,77,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, midY * 0.05); ctx.lineTo(w, midY * 0.05); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h - midY * 0.05); ctx.lineTo(w, h - midY * 0.05); ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '10px "DM Mono", monospace';
    ctx.fillText('0 dBFS', 6, 14);
    ctx.fillText('-inf', 6, h - 6);
  }

  // ── Spectrum Canvas ──────────────────────────────────────────
  function renderSpectrum(canvas, freqs, spectrum) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 860;
    const h = 200;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const minFreq = 20, maxFreq = 20000;
    const minDb = -100, maxDb = 0;
    const pad = { l: 40, r: 12, t: 12, b: 32 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    function freqToX(f) {
      return pad.l + (Math.log10(f / minFreq) / Math.log10(maxFreq / minFreq)) * plotW;
    }
    function dbToY(db) {
      return pad.t + (1 - (db - minDb) / (maxDb - minDb)) * plotH;
    }

    // Grid: frequency verticals
    const freqMarks = [20,50,100,200,500,1000,2000,5000,10000,20000];
    const freqLabels = ['20','50','100','200','500','1k','2k','5k','10k','20k'];
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    ctx.font = '9px "DM Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    freqMarks.forEach((f, idx) => {
      const x = freqToX(f);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      ctx.fillText(freqLabels[idx], x, h - 4);
    });

    // Grid: dB horizontals
    const dbMarks = [0, -20, -40, -60, -80];
    ctx.textAlign = 'right';
    dbMarks.forEach(db => {
      const y = dbToY(db);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText(`${db}`, pad.l - 4, y + 3);
    });

    // Band shading
    const bandColors = [
      { low:20,   high:60,    color:'rgba(255,77,77,0.06)'  },
      { low:60,   high:250,   color:'rgba(255,170,0,0.05)'  },
      { low:250,  high:500,   color:'rgba(77,166,255,0.04)' },
      { low:500,  high:2000,  color:'rgba(200,255,0,0.04)'  },
      { low:2000, high:6000,  color:'rgba(200,255,0,0.04)'  },
      { low:6000, high:20000, color:'rgba(200,255,0,0.03)'  },
    ];
    bandColors.forEach(b => {
      ctx.fillStyle = b.color;
      const x1 = freqToX(b.low), x2 = freqToX(b.high);
      ctx.fillRect(x1, pad.t, x2 - x1, plotH);
    });

    // Spectrum curve — fill
    ctx.beginPath();
    let firstPoint = true;
    for (let i = 1; i < freqs.length; i++) {
      const f = freqs[i];
      if (f < minFreq || f > maxFreq) continue;
      const x = freqToX(f);
      const y = dbToY(Math.max(minDb, spectrum[i]));
      if (firstPoint) { ctx.moveTo(x, y); firstPoint = false; }
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(freqToX(maxFreq), h - pad.b);
    ctx.lineTo(freqToX(minFreq), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = 'rgba(200,255,0,0.08)';
    ctx.fill();

    // Spectrum curve — line
    ctx.beginPath();
    firstPoint = true;
    for (let i = 1; i < freqs.length; i++) {
      const f = freqs[i];
      if (f < minFreq || f > maxFreq) continue;
      const x = freqToX(f);
      const y = dbToY(Math.max(minDb, spectrum[i]));
      if (firstPoint) { ctx.moveTo(x, y); firstPoint = false; }
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#c8ff00';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px "DM Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Frequency (Hz)', pad.l + plotW / 2, h);
    ctx.save();
    ctx.translate(10, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Level (dB)', 0, 0);
    ctx.restore();
  }

  // ── Actions ──────────────────────────────────────────────────
  function renderActions(actions) {
    const list = $('actionList');
    list.innerHTML = '';
    actions.forEach((action, i) => {
      const li = document.createElement('li');
      li.className = 'action-item';
      li.innerHTML = `
        <div class="action-num" aria-hidden="true">${i + 1}</div>
        <div class="action-body">
          <div class="action-title">${escapeHtml(action.title)}</div>
          <div class="action-desc">${escapeHtml(action.desc)}</div>
          <div class="action-tool">Suggested tool: <code>${escapeHtml(action.tool)}</code></div>
        </div>`;
      list.appendChild(li);
    });
  }

  // ── Platforms ────────────────────────────────────────────────
  function renderPlatforms(platforms, rmsDb) {
    const grid = $('platformGrid');
    grid.innerHTML = '';

    const statusColor = { ok: 'badge-good', quiet: 'badge-warning', loud: 'badge-critical', peak: 'badge-critical', close: 'badge-info' };

    platforms.forEach(p => {
      const card = document.createElement('div');
      card.className = 'platform-card';
      card.innerHTML = `
        <div class="platform-name">${escapeHtml(p.name)}</div>
        <div class="platform-row"><span>LUFS target</span><span>${p.lufsTarget} LUFS</span></div>
        <div class="platform-row"><span>True-peak max</span><span>${p.truePeak} dBFS</span></div>
        <div class="platform-row"><span>Your RMS</span><span>${rmsDb.toFixed(1)} dBFS</span></div>
        <span class="platform-status ${statusColor[p.status] || 'badge-info'}">${escapeHtml(p.statusLabel)}</span>`;
      grid.appendChild(card);
    });
  }

  // ── Security ─────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Public API ───────────────────────────────────────────────
  return { renderScore, renderFileInfo, renderIssues, renderMetrics, renderFreqBands, renderWaveform, renderSpectrum, renderActions, renderPlatforms };

})();
