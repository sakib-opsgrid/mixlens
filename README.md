# MixLens — Professional Audio Analyzer

A professional-grade, browser-based audio analysis tool for musicians, producers, and audio engineers. Upload your mix or master and get detailed feedback on loudness, frequency balance, dynamic range, stereo imaging, clipping, and streaming platform readiness — all processed locally in your browser.

**No audio data is ever uploaded to any server.**

---

## Features

- **Clipping Detection** — Sample-accurate detection with percentage reporting
- **Loudness Analysis** — RMS level measurement with streaming target comparison
- **Dynamic Range** — Crest factor and compression assessment
- **Frequency Balance** — 7-band spectral analysis (Sub Bass → Air) with issue detection
- **Stereo Correlation** — Mono compatibility check
- **Waveform Visualisation** — Full-resolution waveform with clipping threshold overlay
- **Frequency Spectrum** — Log-scale FFT spectrum with band shading
- **Streaming Platform Targets** — Compare against Spotify, YouTube, Apple Music, Amazon Music, Tidal, SoundCloud
- **Overall Mix Score** — Weighted score (0–100) based on all metrics
- **Actionable Suggestions** — Prioritised, specific fix recommendations with tool suggestions

---

## Supported File Formats

| Format | Extension |
|--------|-----------|
| WAV    | `.wav`    |
| MP3    | `.mp3`    |
| FLAC   | `.flac`   |
| AIFF   | `.aiff`, `.aif` |
| OGG    | `.ogg`    |

---

## Getting Started

### Option 1 — Open Directly (Simplest)

No build step required. Just open `index.html` in any modern browser:

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/mixlens.git
cd mixlens

# Open in browser (macOS)
open index.html

# Open in browser (Linux)
xdg-open index.html

# Open in browser (Windows)
start index.html
```

### Option 2 — Local Development Server

For a better development experience (avoids CORS issues when extending the tool):

```bash
# Using Python 3 (built-in)
python3 -m http.server 8080

# Using Node.js / npx
npx serve .

# Using PHP
php -S localhost:8080
```

Then open `http://localhost:8080` in your browser.

---

## Project Structure

```
mixlens/
├── index.html          # Main HTML — structure and layout
├── css/
│   └── style.css       # All styles — dark theme, components, responsive
├── js/
│   ├── analyzer.js     # Core audio analysis engine (Web Audio API + FFT)
│   ├── ui.js           # DOM rendering and canvas drawing
│   └── app.js          # Application controller — wires everything together
└── README.md           # This file
```

### Module Responsibilities

| File | Responsibility |
|------|---------------|
| `analyzer.js` | Audio decoding, FFT computation, metric calculation, issue generation, scoring algorithm |
| `ui.js` | All DOM manipulation, canvas drawing (waveform + spectrum), metric card rendering |
| `app.js` | File input handling, drag-and-drop, loading states, resize handling, module orchestration |

---

## How It Works

### Analysis Pipeline

```
User drops file
      ↓
FileReader → ArrayBuffer
      ↓
Web Audio API → AudioBuffer (decoded PCM)
      ↓
Analyzer.analyze(buffer)
   ├── Peak amplitude
   ├── RMS loudness
   ├── Dynamic range / crest factor
   ├── Clipping detection (sample-accurate)
   ├── Stereo correlation (Pearson coefficient)
   ├── FFT spectrum (Cooley-Tukey, 4096-point, Hann window)
   └── Per-band energy (7 bands, 20 Hz – 20 kHz)
      ↓
Issue generation → Score computation → Action plan
      ↓
UI rendering (DOM + Canvas)
```

### Scoring Algorithm

The overall score starts at 100 and deductions are applied for:

| Issue | Deduction |
|-------|-----------|
| Severe clipping (>1000 samples) | −25 |
| Moderate clipping (>100 samples) | −15 |
| Peak too close to 0 dBFS | −10 |
| Loudness too quiet (<−22 dBFS) | −20 |
| Loudness below target (<−18 dBFS) | −12 |
| Over-compressed (>−8 dBFS) | −15 |
| Severe dynamic range crush (<4 dB) | −15 |
| Low stereo correlation (<0.3) | −10 |
| Heavy/thin frequency band | −4 to −5 per band |

---

## Streaming Loudness Targets

| Platform | LUFS Target | True-Peak Max |
|----------|-------------|---------------|
| Spotify | −14 LUFS | −1.0 dBFS |
| YouTube | −14 LUFS | −1.0 dBFS |
| Apple Music | −16 LUFS | −1.0 dBFS |
| Amazon Music | −14 LUFS | −2.0 dBFS |
| Tidal | −14 LUFS | −1.0 dBFS |
| SoundCloud | −14 LUFS | −1.0 dBFS |

> **Note:** MixLens uses RMS-based loudness measurement as an approximation of LUFS. For true integrated LUFS (ITU-R BS.1770-4) measurement, use a dedicated LUFS meter plugin in your DAW (e.g., Youlean Loudness Meter, iZotope Insight).

---

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome 90+ | ✓ Fully supported |
| Firefox 90+ | ✓ Fully supported |
| Edge 90+ | ✓ Fully supported |
| Safari 14+ | ✓ Supported |
| Opera 80+ | ✓ Supported |

Requires: Web Audio API, FileReader API, Canvas API — all standard in modern browsers.

---

## Privacy

- All audio processing runs entirely in your browser using the Web Audio API.
- No audio data, file names, or analysis results are sent to any server.
- No tracking, no analytics, no cookies.
- Works fully offline after the page loads (except Google Fonts — you can self-host if needed).

---

## Extending MixLens

### Adding a New Metric

1. Compute the metric in `js/analyzer.js` inside the `analyze()` function.
2. Add it to the returned report object.
3. Add a new metric card in `index.html` (follow the existing `mc-peak` structure).
4. Render it in `js/ui.js` inside `renderMetrics()` using `setMetric()`.

### Adding a New Issue Type

Open `js/analyzer.js` and add a new block inside `generateIssues()`:

```javascript
if (yourCondition) {
  issues.push({
    severity: 'warning',      // 'critical' | 'warning' | 'info' | 'good'
    icon: '🎛️',
    title: 'Your Issue Title',
    desc: 'Detailed description of the problem.',
    fix: 'Specific actionable fix.',
  });
}
```

### Changing the Colour Theme

All colours are CSS custom properties in `css/style.css` under `:root`. Change `--accent` to update the primary highlight colour throughout the UI.

---

## Known Limitations

- **LUFS measurement** is approximated via RMS. True LUFS (ITU-R BS.1770) requires K-weighting filters and gating, which are not implemented. For mastering decisions, always verify with a proper LUFS meter.
- **Very large files** (>200 MB, >20 min) may be slow to analyse depending on device hardware.
- **True-peak** (inter-sample peak) detection requires oversampling and is not implemented. The peak reading reflects sample-level peak only.
- **MP3 files** decoded via Web Audio may have slight pre-ringing artefacts at the start; this is normal codec behaviour.

---

## Roadmap

- [ ] True LUFS measurement (ITU-R BS.1770-4 with K-weighting)
- [ ] True-peak (inter-sample) detection via 4× oversampling
- [ ] Stereo spectrogram (Mid/Side)
- [ ] Export PDF report
- [ ] Reference track comparison (A/B)
- [ ] Genre-aware scoring presets (EDM, Pop, Classical, Hip-Hop)
- [ ] Batch analysis (multiple files)

---

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/true-lufs`)
3. Commit your changes (`git commit -m 'Add true LUFS measurement'`)
4. Push to the branch (`git push origin feature/true-lufs`)
5. Open a Pull Request

---

## License

MIT License — see `LICENSE` for details.

---

## Acknowledgements

Built with the Web Audio API and zero external dependencies (except Google Fonts for typography). The FFT implementation is a pure JavaScript Cooley-Tukey radix-2 DIT algorithm.
