# MixLens — Professional Audio Analyzer

**by Nickson Rizvi · 2026**

🌐 [Try it live in your browser →](https://sakib-opsgrid.github.io/mixlens/)

A high-accuracy, browser-based professional audio analysis tool for musicians, producers, and audio engineers. Zero server uploads — all processing runs locally in your browser using the Web Audio API.

---

## What It Analyzes

| Metric | Method | Accuracy |
|--------|--------|----------|
| Integrated Loudness | ITU-R BS.1770-4 LUFS with K-weighting + absolute/relative gating | High |
| True-Peak | Cubic interpolation (4× oversampling estimate) | Good |
| Dynamic Range | EBU R128 DR — percentile-based block analysis | High |
| Stereo Correlation | Pearson coefficient (Bessel-corrected) | High |
| Clipping | Sample-accurate threshold detection at 0.9998 | Exact |
| Frequency Balance | 8192-point Hann-windowed FFT, averaged | High |
| Mix Score | Weighted multi-factor scoring (0–100) | — |

---

## Supported Formats

WAV · MP3 · AIFF · OGG · FLAC *(FLAC support depends on browser — Chrome recommended)*

---

## Getting Started

### Open directly (no build step)

```bash
git clone https://github.com/sakib-opsgrid/mixlens.git
cd mixlens
open index.html          # macOS
xdg-open index.html      # Linux
start index.html         # Windows
```

### Local dev server (recommended for best results)

```bash
# Python 3
python3 -m http.server 8080

# Node.js
npx serve .

# PHP
php -S localhost:8080
```

Then open `http://localhost:8080`

---

## Project Structure

```
mixlens/
├── index.html          # Markup + layout
├── css/
│   └── style.css       # Dark premium theme, all components
├── js/
│   ├── analyzer.js     # Signal processing engine (FFT, LUFS, DR, etc.)
│   ├── ui.js           # DOM rendering + Canvas drawing
│   └── app.js          # Controller — file I/O, state, error handling
└── README.md
```

---

## Key Technical Details

### The `decodeAudioData` ArrayBuffer Fix
The Web Audio API's `decodeAudioData()` **consumes (detaches) the ArrayBuffer** when called. If the decode fails and you retry, the buffer is gone. `app.js` solves this by slicing a copy before every decode attempt, and falling back to the callback form of the API for older browsers.

### LUFS Measurement (ITU-R BS.1770-4)
1. K-weighting filter applied to each channel (two-stage biquad: high-shelf pre-filter + 100 Hz high-pass)
2. Mean-square computed per 400ms block with 75ms hop
3. Absolute gate at −70 LUFS
4. Relative gate at −10 LU below ungated mean
5. Loudness = −0.691 + 10·log₁₀(gated mean square)

### Dynamic Range (EBU R128 DR)
Block-based analysis using 3-second windows. 20th-percentile peak and RMS across all blocks. More robust than simple crest factor.

### Scoring Algorithm
Starts at 100, deductions applied for:
- Clipping severity (up to −25)
- True-peak level (up to −8)
- LUFS loudness (too quiet or too loud, up to −22)
- Dynamic range (up to −15)
- Stereo correlation (up to −10)
- Frequency balance (up to −3 per imbalanced band)

---

## Streaming Targets Reference

| Platform | Integrated LUFS | True-Peak |
|----------|----------------|-----------|
| Spotify | −14 | −1.0 dBFS |
| YouTube | −14 | −1.0 dBFS |
| Apple Music | −16 | −1.0 dBFS |
| Amazon Music | −14 | −2.0 dBFS |
| Tidal | −14 | −1.0 dBFS |
| SoundCloud | −14 | −1.0 dBFS |

---

## Browser Compatibility

| Browser | Status | Notes |
|---------|--------|-------|
| Chrome 90+ | ✓ Full | Recommended |
| Firefox 90+ | ✓ Full | — |
| Edge 90+ | ✓ Full | — |
| Safari 14+ | ✓ Partial | FLAC may not decode |
| Opera 80+ | ✓ Full | — |

---

## Known Limitations

- True-peak uses cubic interpolation, not full 4× oversampled sinc filter (ITU-R BS.1770 Annex 2). Good approximation, not laboratory-grade.
- LUFS is computed from a mono mix of all channels weighted equally. For multi-channel (surround) content, channel weights should differ per ITU spec.
- FLAC decoding is browser-dependent. Chrome supports it; Safari does not.

---

## Privacy

No audio data is sent anywhere. No analytics, no tracking, no cookies.

---

## License

MIT — © 2026 Nickson Rizvi
