/**
 * MixLens — ui.js  |  by Nickson Rizvi 2026
 * DOM rendering and canvas drawing.
 */

'use strict';

const UI = (() => {

  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ── Format helpers ─────────────────────────── */
  const fmtDb  = (v,d=1) => `${v>=0?'+':''}${v.toFixed(d)} dBFS`;
  const fmtDur = s => { const m=Math.floor(s/60); return `${m}:${String(Math.floor(s%60)).padStart(2,'0')}`; };
  const fmtSz  = b => b<1e6 ? `${(b/1024).toFixed(0)} KB` : `${(b/1048576).toFixed(1)} MB`;

  const COLORS = {
    lime:'#b8ff3c', amber:'#ffb224', red:'#ff4545', blue:'#4f9eff', green:'#3dd68c'
  };

  function levelColor(v, good_lo, good_hi, warn_lo, warn_hi) {
    if (v>=good_lo && v<=good_hi) return COLORS.lime;
    if (v>=warn_lo && v<=warn_hi) return COLORS.amber;
    return COLORS.red;
  }

  /* ── File info ──────────────────────────────── */
  function renderFileInfo(file, meta) {
    $('rFileName').textContent = file.name;
    $('rMeta').textContent =
      `${fmtDur(meta.dur)} · ${(meta.sr/1000).toFixed(1)} kHz · ${meta.numCh===1?'Mono':'Stereo'} · ${fmtSz(file.size)}`;
  }

  /* ── Score ──────────────────────────────────── */
  function renderScore(score) {
    const circ = 289;
    const offset = circ - (score/100)*circ;
    const arc = $('scoreArc');

    let color = COLORS.lime;
    if (score < 50) color = COLORS.red;
    else if (score < 70) color = COLORS.amber;

    arc.style.stroke = color;
    arc.style.strokeDashoffset = circ;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      arc.style.strokeDashoffset = offset;
    }));

    $('scoreNum').textContent = score;
    $('scoreNum').style.color = color;

    const grade =
      score >= 90 ? 'Excellent — Release Ready' :
      score >= 80 ? 'Good — Minor Fixes Needed' :
      score >= 65 ? 'Fair — Several Issues' :
      score >= 50 ? 'Poor — Needs Work' :
                    'Critical — Do Not Release';
    $('scoreGrade').textContent = grade;
    $('scoreGrade').style.color = color;
  }

  /* ── Quick metrics ──────────────────────────── */
function renderQuickMetrics(m) {
    // Peak
    const pColor = m.truePeakDb > -0.5 ? COLORS.red : m.truePeakDb > -1.0 ? COLORS.amber : COLORS.lime;
    $('qmPeak').textContent = `${m.truePeakDb.toFixed(2)}`;
    $('qmPeakS').textContent = m.truePeakDb > -0.5 ? 'Too high' : m.truePeakDb > -1.0 ? 'Borderline' : 'Clean';
    $('qmPeakS').style.color = pColor;

    // LUFS
    const lColor = m.lufs<-20||m.lufs>-7 ? COLORS.red : m.lufs<-16||m.lufs>-9 ? COLORS.amber : COLORS.lime;
    $('qmRms').textContent = `${m.lufs.toFixed(1)} L`;
    $('qmRmsS').textContent = m.lufs<-16 ? 'Too quiet' : m.lufs>-9 ? 'Too loud' : 'In range';
    $('qmRmsS').style.color = lColor;

    // DR
    const dColor = m.dr<4 ? COLORS.red : m.dr<8 ? COLORS.amber : COLORS.lime;
    $('qmDr').textContent = `${m.dr.toFixed(1)} dB`;
    $('qmDrS').textContent = m.dr<4 ? 'Crushed' : m.dr<8 ? 'Tight' : 'Healthy';
    $('qmDrS').style.color = dColor;

    // Stereo
    const sColor = m.numCh<2 ? COLORS.blue : m.correlation<0.3 ? COLORS.red : m.correlation<0.5 ? COLORS.amber : COLORS.lime;
    $('qmStereo').textContent = m.numCh<2 ? 'Mono' : m.correlation.toFixed(2);
    $('qmStereoS').textContent = m.numCh<2 ? 'Mono file' : m.correlation<0.3 ? 'Phase issue' : m.correlation<0.5 ? 'Low corr.' : 'Mono safe';
    $('qmStereoS').style.color = sColor;

    // Clipping
    const cColor = m.clippedSamples>500 ? COLORS.red : m.clippedSamples>0 ? COLORS.amber : COLORS.lime;
    $('qmClip').textContent = m.clippedSamples > 999 ? `${(m.clippedSamples/1000).toFixed(1)}k` : m.clippedSamples;
    $('qmClipS').textContent = m.clippedSamples===0 ? 'None ✓' : m.clippedSamples>500 ? 'Severe' : 'Minor';
    $('qmClipS').style.color = cColor;
  }

  /* ── Waveform canvas ────────────────────────── */
  function renderWaveform(canvas, waveEnv, clippedPct) {
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const w = canvas.offsetWidth || 960;
    const h = 120;
    canvas.width  = w*dpr; canvas.height = h*dpr;
    canvas.style.height = h+'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr,dpr);

    const mid = h/2;
    const n = waveEnv.length;
    const bw = w/n;

    // Background subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth=0.5;
    [-0.5,-0.25,0.25,0.5].forEach(f => {
      const y = mid + f*mid*1.8;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
    });

    // Clip zone fill
    ctx.fillStyle = 'rgba(255,69,69,0.04)';
    ctx.fillRect(0, 0, w, mid*0.05);
    ctx.fillRect(0, h-mid*0.05, w, mid*0.05);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0,   'rgba(184,255,60,0.5)');
    grad.addColorStop(0.5, 'rgba(184,255,60,0.15)');
    grad.addColorStop(1,   'rgba(184,255,60,0.5)');
    ctx.fillStyle = grad;

    for (let i=0; i<n; i++) {
      const x = i*bw;
      const amp = waveEnv[i]*mid*0.92;
      const isClip = waveEnv[i] >= 0.9998;
      if (isClip) {
        ctx.fillStyle = 'rgba(255,69,69,0.8)';
        ctx.fillRect(x, mid-amp, Math.max(1,bw-0.5), amp*2);
        ctx.fillStyle = grad;
      } else {
        ctx.fillRect(x, mid-amp, Math.max(1,bw-0.5), amp*2);
      }
    }

    // Top outline
    ctx.beginPath(); ctx.strokeStyle='#b8ff3c'; ctx.lineWidth=1.2;
    for (let i=0; i<n; i++) {
      const x=i*bw+bw/2, y=mid-waveEnv[i]*mid*0.92;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.stroke();

    // Clip threshold lines
    ctx.strokeStyle='rgba(255,69,69,0.45)'; ctx.lineWidth=1; ctx.setLineDash([3,5]);
    ctx.beginPath(); ctx.moveTo(0,mid*0.08); ctx.lineTo(w,mid*0.08); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,h-mid*0.08); ctx.lineTo(w,h-mid*0.08); ctx.stroke();
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.font='9px JetBrains Mono,monospace';
    ctx.fillText('0 dBFS',5,13); ctx.fillText('-∞',5,h-5);

    $('waveHint').textContent = clippedPct > 0 ? `${clippedPct.toFixed(2)}% clipped` : 'No clipping';
    $('waveHint').style.color = clippedPct > 0 ? '#ff4545' : '#3dd68c';
  }

  /* ── Spectrum canvas ────────────────────────── */
  function renderSpectrum(canvas, freqs, specDb) {
    const dpr = Math.min(window.devicePixelRatio||1, 2);
    const w = canvas.offsetWidth || 960;
    const h = 180;
    canvas.width=w*dpr; canvas.height=h*dpr;
    canvas.style.height=h+'px';
    const ctx=canvas.getContext('2d');
    ctx.scale(dpr,dpr);

    const fMin=20, fMax=20000;
    const dMin=-110, dMax=0;
    const pad={l:38,r:12,t:10,b:28};
    const pw=w-pad.l-pad.r, ph=h-pad.t-pad.b;

    const fx = f => pad.l + Math.log10(f/fMin)/Math.log10(fMax/fMin)*pw;
    const dy = d => pad.t + (1-(d-dMin)/(dMax-dMin))*ph;

    // Band shading
    const bandShades=[
      {lo:20,  hi:60,    c:'rgba(255,69,69,0.05)'},
      {lo:60,  hi:250,   c:'rgba(255,178,36,0.04)'},
      {lo:250, hi:2000,  c:'rgba(184,255,60,0.03)'},
      {lo:2000,hi:6000,  c:'rgba(79,158,255,0.03)'},
      {lo:6000,hi:20000, c:'rgba(184,255,60,0.03)'},
    ];
    bandShades.forEach(b => {
      ctx.fillStyle=b.c;
      const x1=fx(b.lo), x2=fx(b.hi);
      ctx.fillRect(x1,pad.t,x2-x1,ph);
    });

    // Freq grid
    const fTicks=[20,50,100,200,500,1000,2000,5000,10000,20000];
    const fLabels=['20','50','100','200','500','1k','2k','5k','10k','20k'];
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=0.5;
    ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.font='9px JetBrains Mono,monospace';
    ctx.textAlign='center';
    fTicks.forEach((f,i)=>{
      const x=fx(f);
      ctx.beginPath(); ctx.moveTo(x,pad.t); ctx.lineTo(x,h-pad.b); ctx.stroke();
      ctx.fillText(fLabels[i],x,h-4);
    });

    // dB grid
    const dTicks=[0,-20,-40,-60,-80,-100];
    ctx.textAlign='right';
    dTicks.forEach(d=>{
      const y=dy(d);
      ctx.strokeStyle='rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(w-pad.r,y); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,0.25)';
      ctx.fillText(`${d}`,pad.l-3,y+3);
    });

    // Spectrum fill
    ctx.beginPath();
    let first=true;
    for (let i=1;i<freqs.length;i++){
      const f=freqs[i];
      if(f<fMin||f>fMax)continue;
      const x=fx(f), y=dy(Math.max(dMin,specDb[i]));
      first?(ctx.moveTo(x,y),first=false):ctx.lineTo(x,y);
    }
    ctx.lineTo(fx(fMax),dy(dMin)); ctx.lineTo(fx(fMin),dy(dMin)); ctx.closePath();
    const grad=ctx.createLinearGradient(0,pad.t,0,h);
    grad.addColorStop(0,'rgba(184,255,60,0.2)');
    grad.addColorStop(1,'rgba(184,255,60,0.01)');
    ctx.fillStyle=grad; ctx.fill();

    // Spectrum line
    ctx.beginPath(); first=true;
    for(let i=1;i<freqs.length;i++){
      const f=freqs[i];
      if(f<fMin||f>fMax)continue;
      const x=fx(f),y=dy(Math.max(dMin,specDb[i]));
      first?(ctx.moveTo(x,y),first=false):ctx.lineTo(x,y);
    }
    ctx.strokeStyle='#b8ff3c'; ctx.lineWidth=1.5; ctx.stroke();

    // Band labels
    const bandLabels=[
      {f:35,label:'SUB'},{f:130,label:'BASS'},{f:370,label:'LO-MID'},
      {f:1000,label:'MID'},{f:3500,label:'HI-MID'},{f:8000,label:'PRES'},{f:14000,label:'AIR'}
    ];
    ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.font='8px JetBrains Mono,monospace'; ctx.textAlign='center';
    bandLabels.forEach(b=>{ if(b.f>fMin&&b.f<fMax) ctx.fillText(b.label,fx(b.f),pad.t+10); });
  }

  /* ── Freq bands ─────────────────────────────── */
  function renderFreqBands(bands) {
    const row = $('freqRow');
    row.innerHTML = '';
    bands.forEach(b => {
      const cell = document.createElement('div');
      cell.className = `freq-cell fc-${b.status}`;

      const barH = Math.round(b.normalised*52);
      const statusLabel = b.status==='ok'?'Balanced':b.status==='heavy'?'Heavy':'Thin';
      const loStr = b.lo>=1000?`${(b.lo/1000).toFixed(0)}k`:b.lo;
      const hiStr = b.hi>=1000?`${(b.hi/1000).toFixed(0)}k`:b.hi;

      cell.innerHTML = `
        <div class="freq-cell-top">
          <div class="freq-cell-name">${esc(b.short)}</div>
          <div class="freq-cell-range">${loStr}–${hiStr} Hz</div>
        </div>
        <div class="freq-bar-wrap">
          <div class="freq-bar" style="height:${barH}px"></div>
        </div>
        <div class="freq-cell-val">${b.energyDb.toFixed(1)} dB</div>
        <div class="freq-cell-status">${statusLabel}</div>`;
      row.appendChild(cell);
    });
  }

  /* ── Issues ─────────────────────────────────── */
  function renderIssues(issues) {
    const list = $('issueList');
    list.innerHTML = '';
    const problems = issues.filter(i=>i.sev!=='good');
    $('issueBadge').textContent = problems.length;
    $('issueBadge').style.background = problems.length===0?'var(--green-dim)':'var(--red-dim)';
    $('issueBadge').style.color = problems.length===0?'var(--green)':'var(--red)';

    issues.forEach(i => {
      const el = document.createElement('div');
      el.className = `issue-item sev-${i.sev}`;
      el.setAttribute('role','listitem');
      el.innerHTML = `
        <div class="issue-sev"></div>
        <div class="issue-body">
          <div class="issue-top">
            <span class="issue-title">${esc(i.title)}</span>
            <span class="issue-tag tag-${i.sev}">${esc(i.tag)}</span>
          </div>
          <div class="issue-desc">${esc(i.desc)}</div>
          ${i.fix?`<div class="issue-fix">↳ Fix: ${esc(i.fix)}</div>`:''}
        </div>`;
      list.appendChild(el);
    });
  }

  /* ── Actions ────────────────────────────────── */
  function renderActions(actions) {
    const ol = $('actionList');
    ol.innerHTML = '';
    actions.forEach((a,i) => {
      const li = document.createElement('li');
      li.className = 'action-item';
      li.innerHTML = `
        <div class="action-n">${i+1}</div>
        <div class="action-body">
          <div class="action-title">${esc(a.title)}</div>
          <div class="action-desc">${esc(a.desc)}</div>
          <div class="action-tool">Tool: <code>${esc(a.tool)}</code></div>
        </div>`;
      ol.appendChild(li);
    });
  }

  /* ── Platforms ──────────────────────────────── */
  function renderPlatforms(platforms) {
    const row = $('platformRow');
    row.innerHTML = '';
    platforms.forEach(p => {
      const cell = document.createElement('div');
      cell.className = 'plat-cell';
      cell.innerHTML = `
        <div class="plat-name">${esc(p.name)}</div>
        <div class="plat-target">Target: ${p.lufs} LUFS</div>
        <div class="plat-target">TP max: ${p.tp} dBFS</div>
        <span class="plat-status ps-${p.status}">${esc(p.label)}</span>`;
      row.appendChild(cell);
    });
  }

  return { renderFileInfo, renderScore, renderQuickMetrics, renderWaveform, renderSpectrum, renderFreqBands, renderIssues, renderActions, renderPlatforms };
})();
