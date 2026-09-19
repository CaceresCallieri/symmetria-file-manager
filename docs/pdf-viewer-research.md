# PDF viewer scrolling and scrollbar investigation

Measured on 2026-09-19 against Electron 41.5.0 / Chromium 146.0.7680.216.

## Result

The expanded reader incurs more rendering work than the Miller column preview
in the controlled headless test. The test does not establish the cause of the
operator's desktop lag. The headless runs used the synthetic fixture. A later
deployment located `PRESENTA AJF26 Bancor.pdf` on the laptop for manual testing.

The scrollbar change applies the existing shared 6 px scrollbar rules to both
PDF panes. It preserves Chromium's PDF renderer and toolbar. It also improves
the measured reader timing in this harness. Treat that improvement as a local
observation, not as a promised desktop speedup.

## Why the two preview sizes differ

The production component embeds Chromium's PDF viewer. React does not implement
PDF scrolling or page rendering. Expanding the preview remounts one viewer in
the reader; the Miller column releases its viewer. The two viewers do not render
concurrently.

The live frame tree contains three PDF-related frames:

1. The application's preview URL.
2. Chromium's `mhjfbmdgcfjbbpaeojofohoefgiehjai` extension, with its toolbar and
   thumbnail shadow roots.
3. A native PDF document child under that extension, containing the page scroller.

In Chromium 146, reading the extension's `#scroller.scrollTop` alone is misleading:
it stays at zero while the native document child scrolls. The benchmark measures
`document.scrollingElement` in that child instead.

At a 2048 × 1220 window and device pixel ratio 1, the native document viewport is
356 × 1040 in the column and 1705 × 1086 in the reader. The reader surface is
about five times larger. The default fit zoom rises from 17.7% to 87.6% in the
baseline. The pixel footprint of an individual fitted page grows about 25 times.
This is a plausible source of greater rasterization and composition cost.

Exploratory traces showed more image-upload work in the reader. The PDF document
frame recorded no JavaScript long tasks above 50 ms in the measured runs.
Neither observation isolates PDFium from offscreen rendering or proves that React
can never contribute to a stall.

## Controlled method

`app/bench/pdfScroll.mjs` creates a private profile, socket, and copy of the
production bundle. It adds offscreen rendering only to that copy. It starts
Electron with `--headless --ozone-platform=headless --use-angle=swiftshader`.
It never restarts a service or opens a desktop window.

The default fixture contains 17 landscape pages with 450 cubic vector paths per
page. It contains no external resources. Each sample requests 240 scroll steps
of 60 CSS pixels, with a 16 ms timer between requests. It reverses direction at
the document boundaries. Three rounds alternate between the column and reader.
Each transition mounts a fresh PDF viewer.

The harness records:

- Elapsed time for the fixed workload, including a 150 ms settling period.
- `requestAnimationFrame` intervals in the PDF document frame.
- Intervals above 33.4 ms and JavaScript long tasks.
- Actual scroll travel, viewport, zoom, and computed scrollbar width.
- Screenshots after the first sample of each mode.

The original whole-document sweep changed scroll velocity between sizes. Its
numbers are excluded from the controlled results below. Synthetic wheel input
also failed to move the document in this offscreen environment. The retained
benchmark uses programmatic scrolling and asserts that it actually moved.

## Results

These measurements describe the first scrollbar-only revision. The subsequent
contrast correction uses 35% white thumbs (50% on hover) and matches the toolbar,
thumbnail panel, and native page surround to the application's near-black surface.
The correction was visually verified with the original Bancor PDF; the performance
benchmark was not repeated for this color-only change.

See `benchmarks/pdf-scroll-2026-09-19.json` for the raw controlled results.
The machine reports an AMD Ryzen 7 8700G with Radeon 780M Graphics. This harness
uses an offscreen graphics path; the device name is not proof of GPU acceleration.

Medians across three runs per mode:

- Native scrollbars, column: 10.51 s workload time, 33.4 ms p95 frame interval.
- Native scrollbars, reader: 13.15 s workload time, 50.0 ms p95 frame interval.
- Shared scrollbars, column: 9.91 s workload time, 33.4 ms p95 frame interval.
- Shared scrollbars, reader: 11.56 s workload time, 33.4 ms p95 frame interval.

The historical JSON retains `over33ms` counts, but those counts are unreliable:
the original comparison split equal 33.4 ms intervals through floating-point
noise. The harness now rounds to 0.1 ms before comparison. Do not compare the
historical counts with corrected runs. The harness also asserts each preview
mode and waits for a new PDF frame after every transition.

All six styled samples verified `6px` scrollbars in both the thumbnail and native
document panes. Repeated Ctrl+Enter transitions returned to the Miller column.
The shared rules also cover horizontal scrollbar thickness and remove the arrow
buttons. No wheel handler, smooth-scroll animation, raster-quality reduction, or
PDF engine replacement was added.

## Limits and next decision

The test measures rendering response to scripted scroll requests. It does not
measure touchpad inertia, wheel-to-paint latency, compositor presentation on
Wayland, or the original document. Offscreen bitmap output adds overhead of its
own, as Electron documents:
https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering

The next performance investigation should capture the original document on the
target desktop. Record device pixel ratio, zoom, GPU feature status, and a trace
that includes input, PDF painting, raster tasks, and composition. Compare the
same viewport and scroll sequence before changing renderer settings. Do not
infer a hardware-acceleration fault from this headless run.

If the native renderer remains the bottleneck, an application-controlled PDF.js
viewer is a candidate for a separate prototype. Render visible pages with a
bounded cache, prioritize the main page over thumbnails, cancel stale work, and
limit raster resolution during interaction. Compare it against Chromium with
the same document before choosing it. PDF.js documents the memory cost of page
canvases and recommends rendering only visible pages:
https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#i-want-to-render-all-100-pages-in-a-document-at-a-high-resolution-is-it-a-good-idea

That replacement carries feature costs: search, text selection, links,
annotations, print/download, keyboard focus, and sandbox integration need explicit
acceptance tests. This investigation does not justify replacing the existing
viewer yet.

## Scrollbar adapter and maintenance

The adapter reuses `SCROLLBAR_RULES`. `PDF_DOCUMENT_TOKENS` extends the shared
foreign-document tokens with PDF-specific contrast and viewer backgrounds. The
native plugin receives `setBackgroundColor`, using the same background token
converted to ARGB through a one-pixel canvas. CSS alone does not change the
background that the native plugin paints. The adapter runs once per frame load
and installs no scroll listeners or mutation observers.

Electron exposes frame execution through `WebFrameMain.executeJavaScript`:
https://www.electronjs.org/docs/latest/api/web-frame-main#frameexecutejavascriptcode-usergesture

The adapter depends on Chromium's internal viewer elements. It is marked
`WORKAROUND` in the source because those elements are not a supported theme API.
Re-run the real-PDF benchmark after an Electron upgrade. The relevant pinned
Chromium sources are:

- https://github.com/chromium/chromium/blob/146.0.7680.216/chrome/browser/resources/pdf/pdf_viewer.html
- https://github.com/chromium/chromium/blob/146.0.7680.216/chrome/browser/resources/pdf/elements/viewer_pdf_sidenav.html.ts

## Reproduce

Run the variants sequentially to avoid CPU contention:

```bash
pnpm --filter @symmetria/fm-app build
node app/bench/pdfScroll.mjs --native
node app/bench/pdfScroll.mjs
```

Each invocation prints its artifact directory and saves `results.json`. Use
`--trace` to retain Chromium traces. Supply an absolute PDF path to replace the
synthetic fixture. The document must have enough content to scroll. The default
fixture is deterministic, so no supplied file is necessary.

## Validation

- The app suite passed: 16 files, 251 tests.
- All nine TypeScript contexts passed.
- Scoped Biome, anti-slop, and Fallow checks passed.
- A separate real-PDF check zoomed the reader until horizontal overflow appeared.
  Both scrollbar dimensions measured 6 px, and arrow buttons computed to `none`.
  The document scrolled on both axes, and Escape closed the reader.

## Deployment status

The changes were copied to the laptop checkout at
`/home/jc/projects/symmetria-file-manager`. That checkout was clean and matched
the server worktree's base commit before the copy. The main-process TypeScript
check and production build passed on the laptop. The Electron daemon was
restarted and reported `active`.

`PRESENTA AJF26 Bancor.pdf` is open in the expanded reader on the laptop.
A screenshot confirmed the document and subtle scrollbars in both PDF panes.
The Qt daemon was not restarted. Desktop scrolling performance remains subject
to manual testing; the measurements above are still from the headless harness.
