# PDF viewer: rendering and verification

## Decision

The PDF preview uses PDF.js in both the Miller column and the expanded reader.
The native Chromium viewer, mode switch, and live diagnostic overlay are removed.
The Electron host disables the native PDF plugin. There are no PDF recording
shortcuts or diagnostic listeners in the shipped application.

The main viewport and thumbnail sidebar virtualize their page elements. Each
keeps visible pages plus one neighboring page on either side. One shared queue
renders pages serially and prioritizes main-page requests over thumbnails.
Unmounting a page cancels pending rendering, clears its canvas bitmap, and asks
PDF.js to release its decoded page resources. PDF.js defers cleanup while another
render of the same page remains active.

The compressed document, metadata, and shared font resources remain resident.
The application fetches the complete authorized PDF bytes before opening it.
This bounds rendered page surfaces, not total document memory or network ranges.
Normal fit-width rendering retains device pixel ratio. An individual canvas has
an eight-million-pixel limit at extreme zoom.

PDF.js runs parsing and decoding in its worker. The library and worker use its
legacy build because Chromium 146 lacks Math.sumPrecise. The modern build silently
substituted system fonts after that failure in the original experiment.

The PDF asset factory resolves bundled CMaps, standard fonts, and WASM decoders
without assuming a host-specific output directory. Vite emits those assets and
loads their bytes only when PDF.js requests them. No asset comes from a CDN.
PDF.js disables its ICC WASM path with main-thread binary fetching; this viewer
does not promise color-managed print fidelity.

## Keyboard behavior

The page number field accepts native text entry and Enter submission. PDF
buttons retain Enter/Space activation. Tab and Shift+Tab navigate PDF controls.
The central keyboard dispatcher owns those exceptions so file navigation,
flash mode, and chords retain their existing precedence. The expanded reader
continues to close on Escape or Ctrl+Enter. Its page and thumbnail scroll
containers retain native scrolling keys. The Miller column retains file-manager
navigation outside text fields and control activation.

The old native-plugin focus guard is removed with the embed. No timeout steals
focus back from the new canvas viewer.

## Historical desktop measurements

The recorded PDF was a 17-page, 1.8 MB landscape presentation. Captures used an
Electron 41.5.0 / Chromium 146 laptop at device pixel ratio 1.6 and 165 Hz.
A Wayland virtual pointer requested 600 finger-axis updates at 25 ms intervals,
reversing direction every 150 updates. These are synthetic-input measurements
with tracing overhead, not physical-touchpad tests or browser comparisons.

The original capture localized the dominant native work to PDF paint callbacks:
179 callbacks consumed 16.49 seconds of wall time and 16.18 seconds of CPU time.
The application and native toolbar remained responsive while the native PDF
frame stalled. JavaScript's long-task observer did not expose that native work.
See `benchmarks/pdf-live-2026-09-19.json`.

The subsequent PDF.js/native comparison used the same current build, laptop
window, tracing configuration, PDF, and input sequence:

- Active JavaScript animation interval p95: 18.2 ms for PDF.js versus 127.3 ms
  for the native document. PDF.js still had a worst interval of 145.5 ms.
- Wheel dispatch delay p95: 13.7 ms versus 24.9 ms.
- Scroll travel: 23,520 CSS pixels versus 23,648.75 CSS pixels.
- PDF.js visited page slots 1–9 and held at most four sampled main-page canvases.
- Peak sampled bitmap area: 13,405,972 pixels, about 51.1 MiB at four bytes/pixel.
  This excludes document data, shared resources, and GPU copies.

See `benchmarks/pdf-paged-2026-09-19.json`. Both windows stayed visible with no
focus changes, and neither trace buffer filled. The earlier native input delay
reached 111.9 ms; it is not a stable input-latency baseline. A capture with zero
scrolling and animation samples was excluded.

Animation callback intervals are not displayed FPS. Wheel dispatch delay is not
input-to-paint latency. The prototype capture predates the thumbnail sidebar,
so its main-page width differs from the native viewer's. These results support
improvement in the tested workload, not a controlled rendering-engine ratio.
The operator subsequently confirmed substantially smoother scrolling.

`benchmarks/pdf-scroll-2026-09-19.json` preserves the earlier headless native
scrollbar experiment. Its retired native-viewer harness belongs to commit
`d167734`; it does not exercise the current PDF.js viewer.

## Regression checks

Run the current headless integration check after a production build:

```bash
pnpm --filter @symmetria/fm-app build
node app/bench/pdfPaged.mjs /absolute/17-page-document.pdf
```

Without an argument, the check uses the deterministic 17-page vector fixture.
It creates an isolated profile and socket. It verifies both preview modes,
keyboard thumbnail activation, current-page tracking, independent canvas
eviction, rapid direction changes, zoom, sidebar toggling, and Escape.
Screenshots remain in the printed temporary directory. It does not control an
existing desktop window or measure physical-input latency.

Queue tests cover render priority, cancellation, serialization, and React
StrictMode cleanup/reuse. Image-codec checks must inspect actual pixel output:
PDF.js can resolve a render promise even when an image decoder fails.

## Scope

The viewer provides thumbnails, page navigation, fit width, zoom, and password
entry. It does not yet provide text selection, document search, annotation
editing, rotation, printing, or clickable PDF links. Users can open the file in
an external PDF application for those features. This change does not claim full
feature parity with the previous native viewer.
