/**
 * MixLens — analyzer.js
 * Core audio analysis engine using Web Audio API.
 * All processing is done client-side; no audio leaves the browser.
 */

'use strict';

const Analyzer = (() => {

  // ── Constants ──────────────────────────────────────────────
  const FREQ_BANDS = [
    { name: 'Sub Bass',  shortName: 'Sub',       low: 20,    high: 60,    ideal: [-Infinity, -6],  unit: 'Hz'  },
    { name: 'Bass',      shortName: 'Bass',       low: 60,    high: 250,   ideal: [-3, 3],          unit: 'Hz'  },
    { name: 'Low Mid',   shortName: 'Low Mid',    low: 250,   high: 500,   ideal: [-3, 2],          unit: 'Hz'  },
    { name: 'Mid',       shortName: 'Mid',        low: 500,   high: 2000,  ideal: [-2, 4],          unit: 'kHz' },
    { name: 'High Mid',  shortName: 'High Mid',   low: 2000,  high: 6000,  ideal: [0, 4],           unit: 'kHz' },
    { name: 'Presence',  shortName: 'Presence',   low: 6000,  high: 10000, ideal: [0, 3],           unit: 'kHz' },
    { name: 'Air',       shortName: 'Air',        low: 10000, high: 20000, ideal: [0, 4],           unit: 'kHz' },
  ];

  const PLATFORMS = [
    { name: 'Spotify',       lufsTarget: -14, truePeak: -1.0 },
    { name: 'YouTube',       lufsTarget: -14, truePeak: -1.0 },
    { name: 'Apple Music',   lufsTarget: -16, truePeak: -1.0 },
    { name: 'Amazon Music',  lufsTarget: -14, truePeak: -2.0 },
    { name: 'Tidal',         lufsTarget: -14, truePeak: -1.0 },
    { name: 'SoundCloud',    lufsTarget: -14, truePeak: -1.0 },
  ];

  // ── Helpers ─────────────────────────────────────────────────
  function toDb(amplitude) {
    return 20 * Math.log10(Math.max(amplitude, 1e-9));
  }

  function rms(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function peak(samples) {
    let max = 0;
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > max) max = a;
    }
    return max;
  }

  function stereoCorrelation(left, right) {
    const n = Math.min(left.length, right.length);
    let sum_lr = 0, sum_l2 = 0, sum_r2 = 0;
    for (let i = 0; i < n; i++) {
      sum_lr += left[i] * right[i];
      sum_l2 += left[i] * left[i];
      sum_r2 += right[i] * right[i];
    }
    const denom = Math.sqrt(sum_l2 * sum_r2);
    return denom === 0 ? 0 : sum_lr / denom;
  }

  function countClipped(samples, threshold = 0.999) {
    let count = 0;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) >= threshold) count++;
    }
    return count;
  }

  /**
   * Compute average power spectrum using overlapping FFT windows.
   * Returns { freqs, spectrum } where spectrum values are in dB.
   */
  function computeSpectrum(mono, sampleRate, fftSize = 4096) {
    const half = fftSize / 2;
    const freqs = new Float32Array(half + 1);
    for (let k = 0; k <= half; k++) freqs[k] = (k / fftSize) * sampleRate;

    const accumulator = new Float32Array(half + 1);
    let windowCount = 0;
    const hop = fftSize / 2;

    // Hann window coefficients
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }

    for (let start = 0; start + fftSize <= mono.length; start += hop) {
      // Apply windowing
      const real = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) real[i] = mono[start + i] * window[i];

      // Cooley-Tukey FFT (radix-2 DIT)
      const imag = new Float32Array(fftSize);
      fft(real, imag);

      for (let k = 0; k <= half; k++) {
        accumulator[k] += real[k] * real[k] + imag[k] * imag[k];
      }
      windowCount++;
    }

    const spectrumDb = new Float32Array(half + 1);
    for (let k = 0; k <= half; k++) {
      const power = accumulator[k] / windowCount;
      spectrumDb[k] = 10 * Math.log10(Math.max(power, 1e-18));
    }

    return { freqs, spectrum: spectrumDb };
  }

  /** Cooley-Tukey in-place FFT on real/imag arrays (length must be power of 2) */
  function fft(re, im) {
    const n = re.length;
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curRe = 1, curIm = 0;
        for (let j = 0; j < len / 2; j++) {
          const uRe = re[i+j], uIm = im[i+j];
          const vRe = re[i+j+len/2]*curRe - im[i+j+len/2]*curIm;
          const vIm = re[i+j+len/2]*curIm + im[i+j+len/2]*curRe;
          re[i+j] = uRe+vRe; im[i+j] = uIm+vIm;
          re[i+j+len/2] = uRe-vRe; im[i+j+len/2] = uIm-vIm;
          const newCurRe = curRe*wRe - curIm*wIm;
          curIm = curRe*wIm + curIm*wRe; curRe = newCurRe;
        }
      }
    }
  }

  /** Band energy: mean dB over freq range */
  function bandEnergy(freqs, spectrum, low, high) {
    let sum = 0, count = 0;
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] >= low && freqs[i] <= high) { sum += spectrum[i]; count++; }
    }
    return count > 0 ? sum / count : -Infinity;
  }

  /**
   * Classify band status.
   * Returns 'ok' | 'heavy' | 'low'
   */
  function bandStatus(energyDb, idealRange) {
    // We compare relative levels. The spectrum values are not calibrated to
    // absolute dBFS, so we use relative thresholds based on deviation.
    if (energyDb > idealRange[1]) return 'heavy';
    if (energyDb < idealRange[0]) return 'low';
    return 'ok';
  }

  /** Generate waveform envelope data (peaks per pixel-column, downsampled). */
  function buildWaveformData(mono, numPoints = 800) {
    const step = Math.floor(mono.length / numPoints);
    const peaks = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(start + step, mono.length);
      for (let j = start; j < end; j++) {
        const a = Math.abs(mono[j]);
        if (a > max) max = a;
      }
      peaks[i] = max;
    }
    return peaks;
  }

  /** Build RMS envelope (smoothed loudness over time). */
  function buildRmsEnvelope(mono, sampleRate, windowMs = 100, hopMs = 50) {
    const winSamples = Math.floor((windowMs / 1000) * sampleRate);
    const hopSamples = Math.floor((hopMs / 1000) * sampleRate);
    const out = [];
    for (let start = 0; start + winSamples <= mono.length; start += hopSamples) {
      const slice = mono.subarray(start, start + winSamples);
      out.push(toDb(rms(slice)));
    }
    return out;
  }

  // ── Main Analysis Function ───────────────────────────────────
  /**
   * Analyze an AudioBuffer and return a structured report.
   * @param {AudioBuffer} buffer
   * @returns {Object} report
   */
  function analyze(buffer) {
    const sampleRate = buffer.sampleRate;
    const duration   = buffer.duration;
    const numCh      = buffer.numberOfChannels;

    // Extract channels
    const leftRaw  = buffer.getChannelData(0);
    const rightRaw = numCh > 1 ? buffer.getChannelData(1) : leftRaw;

    // Mono mix
    const mono = new Float32Array(leftRaw.length);
    for (let i = 0; i < mono.length; i++) mono[i] = (leftRaw[i] + rightRaw[i]) * 0.5;

    // ─ Core metrics ─
    const peakAmp  = peak(mono);
    const peakDb   = toDb(peakAmp);
    const rmsAmp   = rms(mono);
    const rmsDb    = toDb(rmsAmp);
    const peakDbL  = toDb(peak(leftRaw));
    const peakDbR  = toDb(peak(rightRaw));
    const dynamicRange = peakDb - rmsDb;
    const crestFactor  = dynamicRange; // same as DR for our purposes
    const clippedSamples = countClipped(mono);
    const clippedPercent = (clippedSamples / mono.length) * 100;
    const correlation  = numCh > 1 ? stereoCorrelation(leftRaw, rightRaw) : 1.0;

    // Rough LUFS approximation (RMS-based, not true LUFS measurement)
    const approxLUFS = rmsDb;

    // ─ Spectrum ─
    const { freqs, spectrum } = computeSpectrum(mono, sampleRate);

    // ─ Freq bands ─
    const bands = FREQ_BANDS.map(band => {
      const energyDb = bandEnergy(freqs, spectrum, band.low, band.high);
      const status   = bandStatus(energyDb, band.ideal);
      return { ...band, energyDb, status };
    });

    // Normalise band energies for display (relative to max band)
    const maxEnergy = Math.max(...bands.map(b => b.energyDb));
    bands.forEach(b => { b.normalised = Math.max(0, (b.energyDb - (maxEnergy - 50)) / 50); });

    // ─ Visual data ─
    const waveformData = buildWaveformData(mono);
    const rmsEnvelope  = buildRmsEnvelope(mono, sampleRate);

    // ─ Score ─
    const score = computeScore({ peakDb, rmsDb, dynamicRange, clippedSamples, correlation, bands });

    // ─ Issues ─
    const issues = generateIssues({ peakDb, rmsDb, dynamicRange, clippedSamples, clippedPercent, correlation, bands, sampleRate });

    // ─ Actions ─
    const actions = generateActions(issues, { rmsDb, dynamicRange, bands });

    // ─ Platform comparison ─
    const platforms = PLATFORMS.map(p => {
      const diff = approxLUFS - p.lufsTarget;
      const peakOk = peakDb <= p.truePeak;
      let status, statusLabel;
      if (Math.abs(diff) <= 1.5 && peakOk) { status = 'ok'; statusLabel = 'Ready'; }
      else if (diff < -3) { status = 'quiet'; statusLabel = `${Math.abs(diff).toFixed(1)} dB too quiet`; }
      else if (diff > 3)  { status = 'loud';  statusLabel = `${diff.toFixed(1)} dB too loud`; }
      else if (!peakOk)   { status = 'peak';  statusLabel = 'Peak too high'; }
      else { status = 'close'; statusLabel = 'Close — minor adjust'; }
      return { ...p, diff, peakOk, status, statusLabel };
    });

    return {
      meta: { sampleRate, duration, numChannels: numCh },
      metrics: { peakDb, rmsDb, dynamicRange, crestFactor, clippedSamples, clippedPercent, correlation, approxLUFS, peakDbL, peakDbR },
      bands,
      score,
      issues,
      actions,
      platforms,
      visual: { waveformData, rmsEnvelope, freqs, spectrum },
    };
  }

  // ── Scoring ──────────────────────────────────────────────────
  function computeScore({ peakDb, rmsDb, dynamicRange, clippedSamples, correlation, bands }) {
    let score = 100;

    // Clipping: severe penalty
    if (clippedSamples > 1000) score -= 25;
    else if (clippedSamples > 100) score -= 15;
    else if (clippedSamples > 0)   score -= 5;

    // Peak headroom
    if (peakDb > -0.1) score -= 10;
    else if (peakDb > -0.5) score -= 3;

    // Loudness
    if (rmsDb < -22)      score -= 20;
    else if (rmsDb < -18) score -= 12;
    else if (rmsDb < -16) score -= 6;
    else if (rmsDb > -8)  score -= 15;
    else if (rmsDb > -10) score -= 8;

    // Dynamic range
    if (dynamicRange < 4)  score -= 15;
    else if (dynamicRange < 7) score -= 7;
    else if (dynamicRange > 25) score -= 5;

    // Stereo correlation
    if (correlation < 0.3)       score -= 10;
    else if (correlation < 0.5)  score -= 5;
    else if (correlation > 0.98) score -= 3;

    // Freq balance: penalise heavy/low bands
    bands.forEach(b => {
      if (b.status === 'heavy') score -= 5;
      if (b.status === 'low')   score -= 4;
    });

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ── Issue Generation ─────────────────────────────────────────
  function generateIssues({ peakDb, rmsDb, dynamicRange, clippedSamples, clippedPercent, correlation, bands, sampleRate }) {
    const issues = [];

    // Clipping
    if (clippedSamples > 1000) {
      issues.push({
        severity: 'critical',
        icon: '⚡',
        title: 'Severe Clipping Detected',
        desc: `${clippedSamples.toLocaleString()} clipped samples found (${clippedPercent.toFixed(2)}% of audio). This causes harsh digital distortion that cannot be repaired post-export.`,
        fix: 'Lower your master bus gain or limiter ceiling. Export again at a lower level and re-master.',
      });
    } else if (clippedSamples > 0) {
      issues.push({
        severity: 'warning',
        icon: '⚠️',
        title: 'Minor Clipping Present',
        desc: `${clippedSamples} clipped sample(s) detected. May be inaudible but should be eliminated for a clean master.`,
        fix: 'Reduce the output ceiling by 0.3–0.5 dB on your limiter.',
      });
    } else {
      issues.push({
        severity: 'good',
        icon: '✓',
        title: 'No Clipping',
        desc: 'No clipped samples detected. The headroom is clean.',
        fix: null,
      });
    }

    // Peak level
    if (peakDb > -0.3) {
      issues.push({
        severity: 'warning',
        icon: '📊',
        title: 'Peak Too Close to 0 dBFS',
        desc: `Peak is ${peakDb.toFixed(2)} dBFS. Streaming platforms may apply true-peak limiting, causing unexpected distortion.`,
        fix: 'Set your limiter's true-peak ceiling to -1.0 dBFS or lower.',
      });
    }

    // Loudness
    if (rmsDb < -20) {
      issues.push({
        severity: 'critical',
        icon: '🔇',
        title: 'Track Is Too Quiet',
        desc: `RMS level is ${rmsDb.toFixed(1)} dBFS. This will sound noticeably softer than other songs on streaming platforms.`,
        fix: `Bring RMS to around -14 dBFS. Use a limiter with makeup gain, targeting -14 LUFS integrated.`,
      });
    } else if (rmsDb < -16) {
      issues.push({
        severity: 'warning',
        icon: '🔉',
        title: 'Loudness Below Streaming Target',
        desc: `RMS level is ${rmsDb.toFixed(1)} dBFS. Spotify, YouTube, and most platforms normalise to -14 LUFS — your track may be turned up and sound inconsistent.`,
        fix: 'Increase makeup gain on your master limiter or use iZotope Ozone's Maximizer.',
      });
    } else if (rmsDb > -8) {
      issues.push({
        severity: 'critical',
        icon: '📢',
        title: 'Over-Compressed / Brickwalled',
        desc: `RMS of ${rmsDb.toFixed(1)} dBFS is extremely high. Dynamic range is crushed, making the mix fatiguing and lifeless.`,
        fix: 'Reduce limiting, allow more dynamic range. Target -14 to -10 LUFS for most genres.',
      });
    } else {
      issues.push({
        severity: 'good',
        icon: '✓',
        title: 'Loudness Is in Good Range',
        desc: `RMS level ${rmsDb.toFixed(1)} dBFS is within professional streaming targets.`,
        fix: null,
      });
    }

    // Dynamic range
    if (dynamicRange < 4) {
      issues.push({
        severity: 'critical',
        icon: '📉',
        title: 'Extreme Compression / Loudness War',
        desc: `Dynamic range is only ${dynamicRange.toFixed(1)} dB. The track has no breathing room — transients are squashed, and the mix sounds flat.`,
        fix: 'Ease up on bus compression and limiting. Aim for at least 8 dB of dynamic range.',
      });
    } else if (dynamicRange < 7) {
      issues.push({
        severity: 'warning',
        icon: '📉',
        title: 'Dynamic Range Is Tight',
        desc: `${dynamicRange.toFixed(1)} dB dynamic range. Usable, but on the compressed side. Kick and snare punch may feel reduced.`,
        fix: 'Consider pulling back 1–2 dB of makeup gain on the master limiter.',
      });
    } else if (dynamicRange > 22) {
      issues.push({
        severity: 'info',
        icon: 'ℹ️',
        title: 'High Dynamic Range',
        desc: `${dynamicRange.toFixed(1)} dB dynamic range. Great for audiophile releases, but quiet sections may feel too soft on consumer devices.`,
        fix: 'For streaming, consider gentle bus compression (2:1 ratio) to smooth out extremes.',
      });
    }

    // Stereo correlation
    if (correlation < 0.3) {
      issues.push({
        severity: 'critical',
        icon: '🔀',
        title: 'Stereo Phase Issues (Mono Incompatibility)',
        desc: `Stereo correlation is ${correlation.toFixed(2)}. Very low correlation means the track may produce cancellations in mono playback (phone speakers, club PA systems).`,
        fix: 'Check for out-of-phase elements. Use a correlation meter plugin. Avoid extreme stereo width on low-frequency content.',
      });
    } else if (correlation < 0.5) {
      issues.push({
        severity: 'warning',
        icon: '🔀',
        title: 'Low Stereo Correlation',
        desc: `Correlation ${correlation.toFixed(2)} — some bass elements may partially cancel in mono. Test your mix through a mono speaker.`,
        fix: 'Keep bass and kick in the center (mono below 200 Hz). Use M/S EQ if available.',
      });
    }

    // Freq bands
    bands.forEach(b => {
      if (b.status === 'heavy') {
        issues.push({
          severity: 'warning',
          icon: '🎛️',
          title: `${b.name} Is Heavy (${b.low >= 1000 ? (b.low/1000).toFixed(0)+'k' : b.low}–${b.high >= 1000 ? (b.high/1000).toFixed(0)+'k' : b.high} Hz)`,
          desc: `The ${b.name.toLowerCase()} region has elevated energy relative to the rest of the spectrum. This can make the mix sound ${b.name === 'Sub Bass' || b.name === 'Bass' ? 'muddy and boomy' : b.name === 'Low Mid' ? 'boxy and nasal' : 'harsh and fatiguing'}.`,
          fix: `Apply a gentle cut (2–4 dB) around ${b.low >= 1000 ? (b.low/1000).toFixed(0)+'k' : b.low}–${b.high >= 1000 ? (b.high/1000).toFixed(0)+'k' : b.high} Hz using a parametric EQ with a broad Q.`,
        });
      } else if (b.status === 'low') {
        issues.push({
          severity: 'info',
          icon: '🎛️',
          title: `${b.name} Is Lacking (${b.low >= 1000 ? (b.low/1000).toFixed(0)+'k' : b.low}–${b.high >= 1000 ? (b.high/1000).toFixed(0)+'k' : b.high} Hz)`,
          desc: `The ${b.name.toLowerCase()} region is relatively thin. This may result in a ${b.name === 'Air' ? 'dull, airless sound with no sparkle on vocals/cymbals' : 'thin or hollow mix'}.`,
          fix: `Boost ${2}–${4} dB around ${b.high >= 1000 ? (b.high/1000).toFixed(0)+'k' : b.high} Hz with a shelving EQ.`,
        });
      }
    });

    // Sample rate
    if (sampleRate < 44100) {
      issues.push({
        severity: 'warning',
        icon: '⚙️',
        title: 'Low Sample Rate',
        desc: `Sample rate is ${sampleRate} Hz. Standard for streaming and distribution is 44100 Hz (44.1 kHz) or higher.`,
        fix: 'Re-export at 44.1 kHz or 48 kHz for distribution.',
      });
    }

    return issues;
  }

  // ── Action Plan ──────────────────────────────────────────────
  function generateActions(issues, { rmsDb, dynamicRange, bands }) {
    const actions = [];

    // Priority order based on issue severity
    const critical = issues.filter(i => i.severity === 'critical');
    const warnings = issues.filter(i => i.severity === 'warning');

    critical.forEach(issue => {
      if (issue.title.includes('Clipping')) {
        actions.push({
          title: 'Fix Clipping First',
          desc: 'Lower the master bus output by 1–2 dB. Re-run your entire signal chain before limiting again. Never address clipping by turning up the limiter.',
          tool: 'Any limiter (FabFilter Pro-L 2, Ozone Maximizer, or stock DAW limiter)',
        });
      }
      if (issue.title.includes('Quiet') || issue.title.includes('Loudness')) {
        actions.push({
          title: 'Increase Master Loudness',
          desc: `Your track needs roughly ${Math.abs(rmsDb - (-14)).toFixed(1)} dB of gain to reach -14 LUFS (streaming standard). Add a limiter at the very end of your chain with true-peak set to -1.0 dBFS and gradually increase makeup gain until integrated LUFS reads -14.`,
          tool: 'iZotope Ozone Maximizer, FabFilter Pro-L 2, or Waves L3',
        });
      }
      if (issue.title.includes('Compressed') || issue.title.includes('Brickwall')) {
        actions.push({
          title: 'Reduce Over-Compression',
          desc: 'Remove or bypass your master limiter temporarily. Reduce bus compressor ratio. Your target dynamic range should be 8–14 dB for most commercial genres.',
          tool: 'Check your compressor settings — ratio should be no more than 4:1 on the master bus.',
        });
      }
    });

    // EQ actions
    const heavyBands = bands.filter(b => b.status === 'heavy');
    const lowBands   = bands.filter(b => b.status === 'low');

    if (heavyBands.length > 0) {
      actions.push({
        title: 'Balance the Frequency Spectrum',
        desc: `Cut ${heavyBands.map(b => b.name).join(', ')} region(s) by 2–4 dB using a broad parametric EQ (Q = 0.7–1.0). Make cuts subtle — trust your ears. Reference a commercial track in the same genre.`,
        tool: 'FabFilter Pro-Q 3, Ozone EQ, or stock DAW EQ',
      });
    }

    if (lowBands.some(b => b.name === 'Air' || b.name === 'Presence')) {
      actions.push({
        title: 'Add High-Frequency Air',
        desc: 'Apply a high-shelf boost of +1.5 to +3 dB starting at 10 kHz. This adds sparkle, air, and presence to vocals and cymbals without harshening the mix.',
        tool: 'Any EQ with a high-shelf filter. Pultec-style EQs are great for this.',
      });
    }

    warnings.forEach(issue => {
      if (issue.title.includes('Phase') || issue.title.includes('Correlation')) {
        actions.push({
          title: 'Fix Stereo Phase / Mono Compatibility',
          desc: 'Use a stereo correlation meter while listening. Identify any elements that go out of phase. High-pass filter bass elements in your stereo bus (below 200 Hz) to keep low end mono.',
          tool: 'SPAN Plus (free), Ozone Imager, or any M/S EQ',
        });
      }
      if (issue.title.includes('Peak')) {
        actions.push({
          title: 'Set True-Peak Ceiling',
          desc: 'Ensure your final limiter is set to a true-peak ceiling of -1.0 dBFS, not just sample peak. True-peak limiting protects against inter-sample peaks that arise during codec conversion (MP3/AAC).',
          tool: 'Any ISP-aware (true-peak) limiter — FabFilter Pro-L 2, Elephant by Voxengo',
        });
      }
    });

    // Final check action
    actions.push({
      title: 'Reference Check Before Delivery',
      desc: 'A/B compare your master with 3 commercially released tracks in the same genre. Listen at the same perceived loudness. Check on earphones, laptop speakers, and a mono Bluetooth speaker.',
      tool: 'Reference plugin (Metric AB, Tonal Balance Control) or just manually null-compare in your DAW',
    });

    return actions;
  }

  // ── Public API ───────────────────────────────────────────────
  return { analyze, FREQ_BANDS, PLATFORMS };

})();
