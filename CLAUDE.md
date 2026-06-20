# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

See `README.md` for what the tool does and how to use it. In short: a client-side (no server uploads) browser tool that perspective-corrects a document from 4+ user-selected corner points. Plain HTML/CSS/JS with ES modules — no bundler, no build step.

Hosted at: `https://ni-kit-mht.github.io/perspective-correction/`

## Running Locally

```bash
node server.cjs          # or: npm run serve — serves on http://localhost:3000 (PORT env var to override)
```

`server.js` is an ESM wrapper that just requires `server.cjs` (lets `node server.js` work under `"type": "module"`).

## Testing

```bash
npm test                          # all unit + integration tests (vitest, jsdom)
npm run test:watch                # vitest watch mode
npx vitest run tests/unit/drawPoints.test.js   # a single test file
npx playwright test               # all e2e tests (Chromium)
npx playwright test tests/e2e/cornerZoom.spec.js   # a single e2e spec
npm run test:all                  # vitest + playwright
```

Tests live in `tests/{unit,integration,e2e}`; `tests/helpers/mockFileSystem.js` mocks the File System Access API. `tests/e2e/performanceBenchmark.spec.js` uses fixtures under `tests/fixtures/perf-images/` (gitignored).

## Workflow

- Update README.md and CLAUDE.md after every change as appropriate; always be brief and crisp
- After every change, commit with brief & crisp but speaking commit message
- After each push: scan for anything new (new page layout, new content type, new pattern, new edge case, etc.) that would require an update to the workflow, CLAUDE.md, gold standards, or test coverage. If found, tell the user with a brief one-liner: what changed and what to do about it. Update CLAUDE.md accordingly.

## Agent / Subagent Limitations

**Subagents (background agents) cannot prompt the user for tool permissions.** They inherit only already-approved permissions from the parent session. If Bash (or any other tool) is not pre-approved, subagents will fail silently with a permission error. Workarounds:
- Pre-approve required tools (e.g. Bash) before launching subagents, or
- Run the work directly in the main conversation instead of delegating to background agents.

## Architecture

The app uses a **four-layer canvas** stack inside `.canvas-wrapper`:
- `sourceCanvas` — displays the image at full resolution
- `gridCanvas` — optional dashed grid overlay (toggle via button)
- `pointsCanvas` — interactive layer for point selection/dragging
- `zoomCanvas` — 3x zoom preview always visible when cursor is over the canvas (any mode); shows existing points as light blue crosshairs

Key coordinate concept: `sourceCanvas` and `gridCanvas` render at **original image resolution** but are CSS-scaled to fit the container. `pointsCanvas` renders at **display resolution** (saving ~46MB per image). Points are stored in image coordinates; `drawPoints()` converts to display coords via `1/displayScale`. `displayScale = imageWidth / displayWidth` converts between mouse coordinates and canvas coordinates.

**Gotcha — `pointsCanvas` pointer-events:** applying a correction (all three paths: WebGL, simple, complex) sets `pointsCanvas.style.pointerEvents = 'none'` so the corrected result is non-interactive. `setMode()` restores it to `'all'` (every mode is interactive), and the image-load path also resets it. If you add a new code path that disables pointer-events, make sure an interaction entry point re-enables it — otherwise editing silently breaks until the image reloads.

### Module Responsibilities

- **`script.js`** — main entry point. Handles image upload, point interaction (add/move/delete modes), canvas setup, zoom preview, and orchestrates correction. Points render as crosshairs with a colored center dot (blue default, red when dragging). Keyboard: Enter → apply correction; ArrowRight/ArrowLeft → navigate folder images (with wrap); Space → reset all points. Imports all other modules.
- **`folderBrowser.js`** — folder browser panel: open a local folder via File System Access API, browse images, save corrected output to `out/` subfolder (always numbered: `_0`, `_1`, `_2`, …). Chrome-only.
- **`helpers.js`** — `orderPoints()`, `getCanvasCoordinates()`, `normalizePoints()`/`denormalizePoints()` for persisting points across images of different sizes.
- **`perspectiveTransform.js`** — `PerspectiveTransform` class: computes an 8-parameter homography matrix from 4 src/dst point pairs via Gaussian elimination. Used by the simple (4-point) path.
- **`webglPerspective.js`** — `isWebGLSupported()` / `applyWebGLPerspective()`: GPU-accelerated 4-point warp via a fragment shader. The default fast path for 4 points; falls back to `simplePerspectiveApply.js` if WebGL is unavailable or throws.
- **`simplePerspectiveApply.js`** — CPU fallback for the 4-point path using `PerspectiveTransform`. Inverse-maps each destination pixel to the source using the homography.
- **`complexPerspectiveApply.js`** — 5+ point correction. Identifies the 4 best corners (largest quadrilateral area), snaps extra points to edges as constraints, then applies a DLT homography with inverse-distance-weighted local corrections. Includes bilinear interpolation and mild unsharp-mask sharpening.
- **`mvc.js`** — Mean Value Coordinates interpolation (`mapPointUsingMVC`). Used by download path for full-resolution re-mapping with arbitrary polygon boundaries.
- **`imageInterpolation.js`** — `getBilinearPixel()` utility for sub-pixel sampling.
- **`download.js`** — exports corrected image as PNG via a temporary canvas and data URL download link.
- **`printCorrectedDocument.js`** — opens a print window with the corrected image and auto-triggers the print dialog.
- **`sessionPersistence.js`** — saves/restores folder browser session across page reloads. Stores `FileSystemDirectoryHandle` in IndexedDB (structured-cloneable), image index + normalized points in localStorage. On reload, re-requests permission and re-scans folder.
- **`seo-loader.js`** — IIFE that injects SEO content sections (FAQ, features, keywords) into the DOM after page load.
- **`server.cjs`** — minimal Node.js static file server (CommonJS, no dependencies). Sends `Cache-Control: no-cache` on all responses.

### Correction Pipeline

1. User selects points → `orderPoints()` sorts them by angle
2. If exactly 4 points → `applyWebGLPerspective()` (GPU); on failure or unsupported WebGL, falls back to `applySimplePerspective()` using `PerspectiveTransform`
3. If 5+ points → `applyComplexPerspective()` which finds best 4 corners, creates edge constraints for remaining points, computes DLT homography, and applies constrained inverse warp
4. The corrected crop is overlaid onto the full original image on `sourceCanvas` (only the cropped region is saved); download/print buttons become enabled

### Folder Browser Flow

1. User opens a local folder → images listed in left panel
2. Click image (or ArrowLeft/ArrowRight) → loads into editor with persisted points (if any)
3. Apply correction → saves to `out/` subfolder (always `_0`, `_1`, …) → stays on current image
4. Points are normalized (0–1) and re-applied to each new image
5. Session (folder handle, image index, points) persists across page reloads via IndexedDB + localStorage

### Grid Overlay

Grid state and drawing logic live in `index.html` inline script (not in a separate module). It adapts grid color (white/black) based on average image brightness.
