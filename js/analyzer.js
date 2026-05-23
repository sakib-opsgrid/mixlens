/**
 * MixLens — analyzer.js  |  by Nickson Rizvi 2026
 * High-accuracy audio analysis engine.
 * Uses Web Audio API OfflineAudioContext for proper signal processing.
 */

'use strict';

const Analyzer = (() => {

  /* ── Band definitions ───────────────────────── */
  const BANDS = [
    { key:'sub',     name:'Sub Bass',  short:'SUB',      lo:20,    hi:60    },
    { key:'bass',    name:'Bass',      short:'BASS',     lo:60,    hi:250   },
    { key:'lowmid',  name:'Low Mid',   short:'LO-MID',   lo:250,   hi:500   },
    { key:'mid',     name:'Mid',       short:'MID',      lo:500,   hi:2000  },
    { key:'himid',   name:'High Mid',  short:'HI-MID',   lo:2000,  hi:6000  },
    { key:'pres',    name:'Presence',  short:'PRESENCE', lo:6000,  hi:10000 },
    { key:'air',     name:'Air',       short:'AIR',      lo:10000, hi:20000 },
  ];

  const PLATFORMS = [
    { name:'Spotify',      lufs:-14, tp:-1.0 },
    { name:'YouTube',      lufs:-14, tp:-1.0 },
    { name:'Apple Music',  lufs:-16, tp:-1.0 },
    { name:'Amazon Music', lufs:-14, tp:-2.0 },
    { name:'Tidal',        lufs:-14, tp:-1.0 },
    { name:'SoundCloud',   lufs:-14, tp:-1.0 },
  ];

  /* ── Math helpers ───────────────────────────── */
  const toDb   = v => 20 * Math.log10(Math.max(Math.abs(v), 1e-10));
  const toDbP  = v => 10 * Math.log10(Math.max(v, 1e-20));   // power → dB

  function calcRms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  function calcPeak(buf) {
    let m = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = Math.abs(buf[i]);
      if (a > m) m = a;
    }
    return m;
  }

  function calcCorrelation(L, R) {
    const n = Math.min(L.length, R.length);
    // Use stride for performance on large files
    const stride = Math.max(1, Math.floor(n / 200000));
    let sl=0, sr=0, slr=0, sl2=0, sr2=0;
    for (let i = 0; i < n; i += stride) {
      sl  += L[i]; sr  += R[i];
      slr += L[i]*R[i];
      sl2 += L[i]*L[i]; sr2 += R[i]*R[i];
    }
    const count = Math.ceil(n / stride);
    const ml = sl/count, mr = sr/count;
    let num=0, dl=0, dr=0;
    for (let i = 0; i < n; i += stride) {
      num += (L[i]-ml)*(R[i]-mr);
      dl  += (L[i]-ml)**2;
      dr  += (R[i]-mr)**2;
    }
    const denom = Math.sqrt(dl*dr);
    return denom < 1e-10 ? 1 : Math.max(-1, Math.min(1, num/denom));
  }

  function countClipped(buf, threshold=0.9998) {
    let c = 0;
    for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) >= threshold) c++;
    return c;
  }

  /* ── K-weighting filter (ITU-R BS.1770) ──────
     Two-stage biquad: high-shelf pre-filter + high-pass
     Coefficients for 44100 Hz (auto-adapt for other rates)
  ─────────────────────────────────────────────── */
  function kWeightFilter(samples, sr) {
    // Stage 1: High-shelf pre-filter
    // For 44100 Hz; re-compute for other rates using bilinear transform
    const f0 = 1681.81;
    const Q  = 0.7071;
    const dBgain = 3.99984;
    const A  = Math.pow(10, dBgain/40);
    const w0 = 2*Math.PI*f0/sr;
    const cosw = Math.cos(w0), sinw = Math.sin(w0);
    const alpha = sinw/(2*Q);
    const sqA   = Math.sqrt(A);
    const hs_b0 = A*((A+1)+(A-1)*cosw+2*sqA*alpha);
    const hs_b1 = -2*A*((A-1)+(A+1)*cosw);
    const hs_b2 = A*((A+1)+(A-1)*cosw-2*sqA*alpha);
    const hs_a0 = (A+1)-(A-1)*cosw+2*sqA*alpha;
    const hs_a1 = 2*((A-1)-(A+1)*cosw);
    const hs_a2 = (A+1)-(A-1)*cosw-2*sqA*alpha;
    const hb0=hs_b0/hs_a0, hb1=hs_b1/hs_a0, hb2=hs_b2/hs_a0;
    const ha1=hs_a1/hs_a0, ha2=hs_a2/hs_a0;

    // Stage 2: High-pass 100 Hz
    const hp_f0 = 38.13547088;
    const hp_Q  = 0.5003270373;
    const hp_w0 = 2*Math.PI*hp_f0/sr;
    const hp_cos = Math.cos(hp_w0);
    const hp_sin = Math.sin(hp_w0);
    const hp_alpha = hp_sin/(2*hp_Q);
    const pb0 = 1+hp_cos/2, pb1 = -(1+hp_cos), pb2 = 1+hp_cos/2; // ??? re-derive
    // Correct HP biquad coefficients
    const hp_b0 =  (1+hp_cos)/2;
    const hp_b1 = -(1+hp_cos);
    const hp_b2 =  (1+hp_cos)/2;
    const hp_a0 =  1+hp_alpha;
    const hp_a1 = -2*hp_cos;
    const hp_a2 =  1-hp_alpha;
    const hpb0=hp_b0/hp_a0, hpb1=hp_b1/hp_a0, hpb2=hp_b2/hp_a0;
    const hpa1=hp_a1/hp_a0, hpa2=hp_a2/hp_a0;

    const out = new Float32Array(samples.length);
    // Stage 1
    let x1=0,x2=0,y1=0,y2=0;
    for (let i=0; i<samples.length; i++) {
      const x = samples[i];
      const y = hb0*x + hb1*x1 + hb2*x2 - ha1*y1 - ha2*y2;
      x2=x1; x1=x; y2=y1; y1=y;
      out[i] = y;
    }
    // Stage 2
    let a=0,b=0,c=0,d=0;
    for (let i=0; i<out.length; i++) {
      const x = out[i];
      const y = hpb0*x + hpb1*a + hpb2*b - hpa1*c - hpa2*d;
      b=a; a=x; d=c; c=y;
      out[i] = y;
    }
    return out;
  }

  /* ── LUFS (ITU-R BS.1770-4) ─────────────────── */
  function calcLUFS(channels, sr) {
    // K-weight each channel
    const weighted = channels.map(ch => kWeightFilter(ch, sr));

    // Mean square sum across channels
    const n = weighted[0].length;
    const ms = new Float32Array(n);
    for (let ch=0; ch<weighted.length; ch++) {
      for (let i=0; i<n; i++) ms[i] += weighted[ch][i]**2;
    }

    // Gating: 400ms blocks, 75ms hop
    const blockLen = Math.floor(0.4*sr);
    const hopLen   = Math.floor(0.075*sr);
    const blocks   = [];

    for (let start=0; start+blockLen<=n; start+=hopLen) {
      let s=0;
      for (let i=start; i<start+blockLen; i++) s += ms[i];
      blocks.push(s/blockLen);
    }

    if (blocks.length === 0) return -Infinity;

    // Absolute gate: -70 LUFS
    const absThresh = Math.pow(10, -70/10);
    const gated1 = blocks.filter(b => b > absThresh);
    if (gated1.length === 0) return -70;

    // Relative gate: -10 LU below ungated mean
    const ungatedMean = gated1.reduce((a,b)=>a+b,0)/gated1.length;
    const relThresh   = ungatedMean * Math.pow(10,-10/10);
    const gated2 = gated1.filter(b => b > relThresh);
    if (gated2.length === 0) return -70;

    const mean = gated2.reduce((a,b)=>a+b,0)/gated2.length;
    return toDbP(mean) - 0.691; // LUFS
  }

  /* ── True Peak (4× oversampling estimate) ────── */
  function calcTruePeak(buf) {
    // Cubic interpolation between samples gives a good estimate
    let maxVal = 0;
    for (let i=1; i<buf.length-2; i++) {
      const y0=buf[i-1], y1=buf[i], y2=buf[i+1], y3=buf[i+2];
      // Check interpolated values at t=0.25, 0.5, 0.75
      for (let t=0.25; t<1; t+=0.25) {
        const a0 = -0.5*y0 + 1.5*y1 - 1.5*y2 + 0.5*y3;
        const a1 =      y0 - 2.5*y1 + 2.0*y2 - 0.5*y3;
        const a2 = -0.5*y0             + 0.5*y2;
        const interp = Math.abs(((a0*t + a1)*t + a2)*t + y1);
        if (interp > maxVal) maxVal = interp;
      }
    }
    return Math.max(maxVal, calcPeak(buf));
  }

  /* ── Radix-2 Cooley-Tukey FFT (in-place) ─────── */
  function fft(re, im) {
    const n = re.length;
    // Bit-reversal
    for (let i=1, j=0; i<n; i++) {
      let bit = n>>1;
      for (; j&bit; bit>>=1) j^=bit;
      j^=bit;
      if (i<j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
    }
    // Butterfly
    for (let len=2; len<=n; len<<=1) {
      const ang = -2*Math.PI/len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i=0; i<n; i+=len) {
        let cRe=1, cIm=0;
        for (let j=0; j<len>>1; j++) {
          const uRe=re[i+j], uIm=im[i+j];
          const vRe=re[i+j+len/2]*cRe - im[i+j+len/2]*cIm;
          const vIm=re[i+j+len/2]*cIm + im[i+j+len/2]*cRe;
          re[i+j]=uRe+vRe; im[i+j]=uIm+vIm;
          re[i+j+len/2]=uRe-vRe; im[i+j+len/2]=uIm-vIm;
          const nRe=cRe*wRe-cIm*wIm; cIm=cRe*wIm+cIm*wRe; cRe=nRe;
        }
      }
    }
  }

  /* ── Spectrum (averaged Hann-windowed FFT) ───── */
  function calcSpectrum(mono, sr, fftSize=8192) {
    const half = fftSize>>1;
    const freqs = new Float32Array(half+1);
    for (let k=0; k<=half; k++) freqs[k] = k*sr/fftSize;

    const hann = new Float32Array(fftSize);
    for (let i=0; i<fftSize; i++) hann[i] = 0.5*(1-Math.cos(2*Math.PI*i/(fftSize-1)));

    const accum = new Float64Array(half+1);
    const hop   = fftSize>>1;
    let   count = 0;

    for (let s=0; s+fftSize<=mono.length; s+=hop) {
      const re = new Float32Array(fftSize);
      const im = new Float32Array(fftSize);
      for (let i=0; i<fftSize; i++) re[i] = mono[s+i]*hann[i];
      fft(re, im);
      for (let k=0; k<=half; k++) accum[k] += re[k]*re[k] + im[k]*im[k];
      count++;
    }

    const specDb = new Float32Array(half+1);
    for (let k=0; k<=half; k++) specDb[k] = count>0 ? toDbP(accum[k]/count) : -120;
    return { freqs, specDb };
  }

  /* ── Band energy (mean power in band) ───────── */
  function bandEnergy(freqs, specDb, lo, hi) {
    let s=0, c=0;
    for (let i=0; i<freqs.length; i++) {
      if (freqs[i]>=lo && freqs[i]<=hi) { s+=specDb[i]; c++; }
    }
    return c>0 ? s/c : -120;
  }

  /* ── Waveform envelope ───────────────────────── */
  function waveformEnv(mono, pts=1200) {
    const step = Math.max(1, Math.floor(mono.length/pts));
    const env  = new Float32Array(pts);
    for (let i=0; i<pts; i++) {
      let mx=0;
      const s=i*step, e=Math.min(s+step,mono.length);
      for (let j=s; j<e; j++) { const a=Math.abs(mono[j]); if(a>mx)mx=a; }
      env[i]=mx;
    }
    return env;
  }

  /* ── Dynamic Range (EBU R128 DR) ────────────── */
  function calcDR(mono, sr) {
    // 3-second blocks
    const blockLen = Math.floor(3*sr);
    const peaks=[], rmss=[];
    for (let s=0; s+blockLen<=mono.length; s+=blockLen) {
      const block = mono.subarray(s, s+blockLen);
      peaks.push(calcPeak(block));
      rmss.push(calcRms(block));
    }
    if (peaks.length===0) return 0;
    // 20th percentile peak, 20th percentile RMS
    peaks.sort((a,b)=>b-a); rmss.sort((a,b)=>b-a);
    const idx = Math.floor(peaks.length*0.2);
    const pPeak = toDb(peaks[Math.min(idx, peaks.length-1)]);
    const pRms  = toDb(rmss[Math.min(idx, rmss.length-1)]);
    return Math.max(0, pPeak - pRms);
  }

  /* ── Scoring ─────────────────────────────────── */
  function calcScore(m) {
    let s = 100;

    // Clipping (0–25 pts)
    if (m.clippedSamples > 5000) s -= 25;
    else if (m.clippedSamples > 500) s -= 18;
    else if (m.clippedSamples > 50)  s -= 10;
    else if (m.clippedSamples > 0)   s -= 4;

    // Peak (0–8 pts)
    if (m.truePeakDb > -0.1) s -= 8;
    else if (m.truePeakDb > -0.5) s -= 4;
    else if (m.truePeakDb > -1.0) s -= 1;

    // LUFS (0–22 pts)
    if (m.lufs < -24)      s -= 22;
    else if (m.lufs < -20) s -= 14;
    else if (m.lufs < -16) s -= 7;
    else if (m.lufs > -6)  s -= 22;
    else if (m.lufs > -8)  s -= 14;
    else if (m.lufs > -10) s -= 7;

    // Dynamic range (0–15 pts)
    if (m.dr < 3)       s -= 15;
    else if (m.dr < 6)  s -= 10;
    else if (m.dr < 9)  s -= 4;
    else if (m.dr > 30) s -= 3;

    // Stereo (0–10 pts)
    if (m.correlation < 0.2)      s -= 10;
    else if (m.correlation < 0.4) s -= 6;
    else if (m.correlation < 0.5) s -= 3;
    else if (m.correlation > 0.97 && m.numCh>1) s -= 2;

    // Freq balance (0–20 pts, max 4 per band)
    m.bands.forEach(b => {
      if (b.status !== 'ok') s -= 3;
    });

    return Math.max(0, Math.min(100, Math.round(s)));
  }

  /* ── Band status ──────────────────────────────── */
  function bandStatus(key, energyDb, allEnergies) {
    // Relative to mean of all bands
    const mean = allEnergies.reduce((a,b)=>a+b,0)/allEnergies.length;
    const diff = energyDb - mean;

    // Per-band thresholds
    const HEAVY = { sub:4, bass:5, lowmid:4, mid:5, himid:4, pres:4, air:5 };
    const LOW   = { sub:99, bass:10, lowmid:8, mid:8, himid:6, pres:7, air:8 };

    if (diff > (HEAVY[key]||5)) return 'heavy';
    if (diff < -(LOW[key]||8)) return 'low';
    return 'ok';
  }

  /* ── Issues ───────────────────────────────────── */
  function genIssues(m) {
    const issues = [];

    // Clipping
    if (m.clippedSamples > 500) {
      issues.push({ sev:'critical', title:'Severe Clipping', tag:'CRITICAL',
        desc:`${m.clippedSamples.toLocaleString()} clipped samples (${m.clippedPct.toFixed(2)}%). Causes harsh digital distortion. Must fix before release.`,
        fix:'Lower master bus gain. Re-export with limiter ceiling at -1 dBFS.' });
    } else if (m.clippedSamples > 0) {
      issues.push({ sev:'warning', title:'Minor Clipping Present', tag:'WARNING',
        desc:`${m.clippedSamples} clipped sample(s) found. Inaudible at low counts but should be eliminated.`,
        fix:'Reduce limiter ceiling by 0.3–0.5 dB and re-export.' });
    } else {
      issues.push({ sev:'good', title:'No Clipping Detected', tag:'PASS',
        desc:'Zero clipped samples. Clean digital headroom throughout the file.', fix:null });
    }

    // True peak
    if (m.truePeakDb > -0.5) {
      issues.push({ sev:'warning', title:'True-Peak Too High', tag:'WARNING',
        desc:`True-peak is ${m.truePeakDb.toFixed(2)} dBFS. Inter-sample peaks will exceed 0 dBFS after MP3/AAC encoding.`,
        fix:'Set true-peak limiter ceiling to -1.0 dBFS. Use an ISP-aware limiter.' });
    }

    // LUFS loudness
    if (m.lufs < -22) {
      issues.push({ sev:'critical', title:'Track Is Too Quiet', tag:'CRITICAL',
        desc:`Integrated LUFS: ${m.lufs.toFixed(1)}. Streaming platforms normalise to -14 LUFS — your track will sound noticeably soft.`,
        fix:`Add ~${Math.abs(m.lufs - (-14)).toFixed(1)} dB of gain via master limiter. Target -14 LUFS integrated.` });
    } else if (m.lufs < -16) {
      issues.push({ sev:'warning', title:'Loudness Below Streaming Target', tag:'WARNING',
        desc:`Integrated LUFS: ${m.lufs.toFixed(1)}. Target is -14 LUFS (Spotify/YouTube). Gap: ${Math.abs(m.lufs+14).toFixed(1)} LU.`,
        fix:'Increase makeup gain on master limiter. Use iZotope Ozone Maximizer or FabFilter Pro-L 2.' });
    } else if (m.lufs > -7) {
      issues.push({ sev:'critical', title:'Over-Compressed / Brickwalled', tag:'CRITICAL',
        desc:`Integrated LUFS: ${m.lufs.toFixed(1)}. Severely over-limited. Mix sounds fatiguing and lifeless.`,
        fix:'Remove or ease the limiter. Allow 8–14 dB of dynamic range. Reduce ratio on bus compressor.' });
    } else if (m.lufs > -9) {
      issues.push({ sev:'warning', title:'Loudness Slightly Hot', tag:'WARNING',
        desc:`${m.lufs.toFixed(1)} LUFS. Just above typical streaming targets. May be turned down by platforms.`,
        fix:'Pull back limiter makeup gain by 1–2 dB.' });
    } else {
      issues.push({ sev:'good', title:'Loudness Is in Target Range', tag:'PASS',
        desc:`${m.lufs.toFixed(1)} LUFS — within professional streaming standards (-16 to -9 LUFS). Well done.`, fix:null });
    }

    // Dynamic range
    if (m.dr < 4) {
      issues.push({ sev:'critical', title:'Extreme Compression', tag:'CRITICAL',
        desc:`Dynamic range: ${m.dr.toFixed(1)} dB. Transients are crushed. The mix has no punch or life.`,
        fix:'Ease bus compression and limiting. Target DR8 minimum. Compare to reference track.' });
    } else if (m.dr < 8) {
      issues.push({ sev:'warning', title:'Low Dynamic Range', tag:'WARNING',
        desc:`Dynamic range: ${m.dr.toFixed(1)} dB. On the compressed side. Kick and snare transients may feel dull.`,
        fix:'Pull back master limiter by 1–2 dB. Adjust bus compressor attack/release.' });
    } else {
      issues.push({ sev:'good', title:'Dynamic Range is Healthy', tag:'PASS',
        desc:`${m.dr.toFixed(1)} dB dynamic range. Good transient impact and musical dynamics.`, fix:null });
    }

    // Stereo
    if (m.numCh < 2) {
      issues.push({ sev:'info', title:'Mono File', tag:'INFO',
        desc:'This is a mono audio file. Stereo correlation is not applicable.',
        fix:null });
    } else if (m.correlation < 0.3) {
      issues.push({ sev:'critical', title:'Stereo Phase Issues', tag:'CRITICAL',
        desc:`Correlation: ${m.correlation.toFixed(2)}. Severe phase problems. Will produce cancellation in mono (phone speakers, PA systems).`,
        fix:'Check for out-of-phase elements. Keep bass below 200 Hz in mono. Use M/S EQ on master.' });
    } else if (m.correlation < 0.5) {
      issues.push({ sev:'warning', title:'Low Stereo Correlation', tag:'WARNING',
        desc:`Correlation: ${m.correlation.toFixed(2)}. Some elements may partially cancel in mono playback.`,
        fix:'Test in mono. High-pass your stereo bus below 100–150 Hz. Use SPAN Plus to monitor.' });
    } else {
      issues.push({ sev:'good', title:'Stereo Image is Solid', tag:'PASS',
        desc:`Correlation ${m.correlation.toFixed(2)} — mono-compatible with a healthy stereo field.`, fix:null });
    }

    // Frequency bands
    m.bands.forEach(b => {
      const loStr = b.lo >= 1000 ? `${(b.lo/1000).toFixed(0)}k` : `${b.lo}`;
      const hiStr = b.hi >= 1000 ? `${(b.hi/1000).toFixed(0)}k` : `${b.hi}`;
      if (b.status === 'heavy') {
        const desc_map = {
          sub:'Makes the mix boomy and muddy — especially on small speakers.',
          bass:'Low end is too heavy — may mask kick clarity and cause muddiness.',
          lowmid:'Boxy, nasal sound. Tends to make mixes sound "cardboard-y".',
          mid:'Can cause harshness if pushed too far. Vocal clarity may suffer.',
          himid:'May cause listener fatigue and harsh sibilance on extended listening.',
          pres:'Overly bright or harsh top-end. Tiring on the ears.',
          air:'Excessive air can sound fizzy or artificially bright.'
        };
        issues.push({ sev:'warning', title:`${b.name} Region Heavy (${loStr}–${hiStr} Hz)`, tag:'EQ',
          desc:`The ${b.name.toLowerCase()} band is elevated relative to the spectrum. ${desc_map[b.key]||''}`,
          fix:`Cut 2–4 dB at ${loStr}–${hiStr} Hz with a broad parametric EQ (Q ≈ 0.7). Use a reference track to guide cuts.` });
      } else if (b.status === 'low') {
        const desc_map = {
          bass:'Lacks low-end weight and warmth.',
          lowmid:'Sounds thin or hollow in the low mids.',
          mid:'Vocals and instruments may lack body and presence.',
          himid:'Lacks definition and articulation.',
          pres:'Sounds dull; lack of detail and presence.',
          air:`No sparkle or air — vocals and cymbals sound dull. This is your most notable EQ issue.`
        };
        issues.push({ sev:'info', title:`${b.name} Region Thin (${loStr}–${hiStr} Hz)`, tag:'EQ',
          desc:`The ${b.name.toLowerCase()} band is thin compared to the rest. ${desc_map[b.key]||''}`,
          fix:`Boost 2–3 dB around ${hiStr} Hz with a high shelf or gentle bell filter.` });
      }
    });

    return issues;
  }

  /* ── Action Plan ──────────────────────────────── */
  function genActions(issues, m) {
    const actions = [];
    const crits = issues.filter(i=>i.sev==='critical');
    const warns = issues.filter(i=>i.sev==='warning');

    crits.forEach(i => {
      if (i.title.includes('Clipping')) {
        actions.push({ title:'Fix Clipping First — Before All Else',
          desc:'Lower your master bus output. Clipping cannot be repaired post-export — you must re-render. Never fix clipping by adding more limiting on top.',
          tool:'Any limiter. Set ceiling to -1.0 dBFS true-peak. Reduce pre-limiter gain.' });
      }
      if (i.title.includes('Quiet') || i.title.includes('Loudness')) {
        actions.push({ title:'Increase Integrated Loudness to -14 LUFS',
          desc:`Your track is currently ${m.lufs.toFixed(1)} LUFS. You need ~${Math.abs(m.lufs+14).toFixed(1)} dB of gain. Use a transparent limiter with makeup gain. Monitor with a LUFS meter, not a peak meter.`,
          tool:'iZotope Ozone Maximizer, FabFilter Pro-L 2, Waves L3-LL, or Youlean Loudness Meter' });
      }
      if (i.title.includes('Brickwall') || i.title.includes('Over-Compressed')) {
        actions.push({ title:'Reduce Over-Compression',
          desc:'Bypass your master limiter temporarily. Ease the bus compressor ratio (target 2:1 max). Rebuild loudness gradually, targeting -14 LUFS integrated.',
          tool:'Reduce ratio on your bus compressor. Back off limiter makeup gain by 2–4 dB.' });
      }
      if (i.title.includes('Dynamic Range') || i.title.includes('Extreme')) {
        actions.push({ title:'Restore Dynamic Range',
          desc:`Current DR: ${m.dr.toFixed(1)} dB. Target at least 8 dB. Reduce limiting aggressiveness. Check bus compression settings.`,
          tool:'Compare your master to a commercial reference using Metric AB or Tonal Balance Control.' });
      }
    });

    warns.forEach(i => {
      if (i.title.includes('Phase') || i.title.includes('Correlation')) {
        actions.push({ title:'Fix Stereo Mono Compatibility',
          desc:'Listen to your mix in mono. Identify elements that disappear or phase-cancel. High-pass the master stereo bus below 100 Hz (sum to mono). Check with SPAN correlation meter.',
          tool:'SPAN Plus (free), Voxengo MSED, or Ozone Imager' });
      }
      if (i.title.includes('True-Peak')) {
        actions.push({ title:'Set True-Peak Limiter Ceiling',
          desc:'Use an inter-sample peak (ISP) aware limiter. Set ceiling to -1.0 dBFS true-peak. Normal sample-peak measurement misses inter-sample peaks that cause distortion after encoding.',
          tool:'FabFilter Pro-L 2, Elephant by Voxengo, or Waves L2' });
      }
    });

    // EQ action (consolidate)
    const eqIssues = issues.filter(i=>i.tag==='EQ');
    if (eqIssues.length > 0) {
      actions.push({ title:'Correct Frequency Balance with Master EQ',
        desc:`${eqIssues.length} frequency band issue(s) detected: ${eqIssues.map(i=>i.title.split(' ')[0]+' '+i.title.split(' ')[1]).join(', ')}. Make surgical cuts/boosts on the master EQ after referencing a commercial track.`,
        tool:'FabFilter Pro-Q 3, Ozone EQ, or DMG Audio EQuilibrium' });
    }

    // Always add reference check
    actions.push({ title:'Reference Check Before Final Delivery',
      desc:'A/B compare your master against 3 commercial tracks in the same genre at matched loudness. Listen on earphones, laptop speakers, and a mono Bluetooth speaker. If it sounds good everywhere, it\'s ready.',
      tool:'Metric AB, Reference 4 by Sonarworks, or manually null-compare in your DAW' });

    return actions;
  }

  /* ── Main analyze() ───────────────────────────── */
  function analyze(buffer) {
    const sr    = buffer.sampleRate;
    const dur   = buffer.duration;
    const numCh = buffer.numberOfChannels;

    // Extract channels
    const channels = [];
    for (let c=0; c<numCh; c++) channels.push(buffer.getChannelData(c));

    // Mono mix
    const mono = new Float32Array(channels[0].length);
    for (let c=0; c<numCh; c++) for (let i=0; i<mono.length; i++) mono[i] += channels[c][i]/numCh;

    const L = channels[0];
    const R = numCh>1 ? channels[1] : channels[0];

    // ─ Core measurements ─
    const peakAmp    = calcPeak(mono);
    const peakDb     = toDb(peakAmp);
    const truePeakDb = toDb(calcTruePeak(mono));
    const rmsAmp     = calcRms(mono);
    const rmsDb      = toDb(rmsAmp);
    const lufs       = calcLUFS(channels, sr);
    const dr         = calcDR(mono, sr);
    const correlation= numCh>1 ? calcCorrelation(L, R) : 1.0;
    const clippedSamples = countClipped(mono);
    const clippedPct = (clippedSamples/mono.length)*100;

    // ─ Spectrum ─
    const { freqs, specDb } = calcSpectrum(mono, sr);

    // ─ Band energies ─
    const energies = BANDS.map(b => bandEnergy(freqs, specDb, b.lo, b.hi));
    const bands = BANDS.map((b,i) => ({
      ...b,
      energyDb: energies[i],
      status: bandStatus(b.key, energies[i], energies),
      normalised: 0 // computed below
    }));

    // Normalise for bar heights (0–1)
    const maxE = Math.max(...energies), minE = Math.min(...energies);
    bands.forEach((b,i) => b.normalised = (energies[i]-minE)/Math.max(1, maxE-minE));

    // ─ Visuals ─
    const waveEnv = waveformEnv(mono);

    // ─ Metrics object ─
    const m = { peakDb, truePeakDb, rmsDb, lufs, dr, correlation, clippedSamples, clippedPct, numCh, sr, dur, bands };

    // ─ Score, issues, actions ─
    const score   = calcScore(m);
    const issues  = genIssues(m);
    const actions = genActions(issues, m);

    // ─ Platforms ─
    const platforms = PLATFORMS.map(p => {
      const diff = lufs - p.lufs;
      const tpOk = truePeakDb <= p.tp;
      let status, label;
      if (Math.abs(diff)<=1.5 && tpOk) { status='ok';    label='Ready ✓'; }
      else if (diff < -3)               { status='quiet'; label=`${Math.abs(diff).toFixed(1)} LU quiet`; }
      else if (diff > 3)                { status='loud';  label=`${diff.toFixed(1)} LU loud`; }
      else if (!tpOk)                   { status='loud';  label:'Peak too high'; }
      else                              { status='close'; label:'Close'; }
      return { ...p, diff, tpOk, status, label };
    });

    return { meta:{sr,dur,numCh}, m, bands, score, issues, actions, platforms, visual:{waveEnv, freqs, specDb} };
  }

  return { analyze, BANDS, PLATFORMS };
})();
