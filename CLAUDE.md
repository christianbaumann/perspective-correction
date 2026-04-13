# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based document perspective correction tool. Users upload an image, select 4+ corner points on a document, and the tool applies a perspective transform to produce a rectified (front-facing) view. All processing is client-side — no server uploads.

Hosted at: `https://ni-kit-mht.github.io/perspective-correction/`

## Running Locally

```bash
node server.cjs          # serves on http://localhost:3000 (or PORT env var)
```

Plain HTML/CSS/JS with ES modules. No bundler.

## Testing

```bash
npm test                 # unit + integration tests (vitest)
npx playwright test      # e2e tests (Chromium)
```

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

### Module Responsibilities

- **`script.js`** — main entry point. Handles image upload, point interaction (add/move/delete modes), canvas setup, zoom preview, and orchestrates correction. Points render as crosshairs with a colored center dot (blue default, red when dragging). Keyboard: Enter → apply correction; ArrowRight/ArrowLeft → navigate folder images (with wrap); Space → reset all points. Imports all other modules.
- **`folderBrowser.js`** — folder browser panel: open a local folder via File System Access API, browse images, save corrected output to `out/` subfolder (always numbered: `_0`, `_1`, `_2`, …). Chrome-only.
- **`helpers.js`** — `orderPoints()`, `getCanvasCoordinates()`, `normalizePoints()`/`denormalizePoints()` for persisting points across images of different sizes.
- **`perspectiveTransform.js`** — `PerspectiveTransform` class: computes an 8-parameter homography matrix from 4 src/dst point pairs via Gaussian elimination. Used by the simple (4-point) path.
- **`simplePerspectiveApply.js`** — 4-point correction using `PerspectiveTransform`. Inverse-maps each destination pixel to the source using the homography.
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
2. If exactly 4 points → `applySimplePerspective()` using `PerspectiveTransform`
3. If 5+ points → `applyComplexPerspective()` which finds best 4 corners, creates edge constraints for remaining points, computes DLT homography, and applies constrained inverse warp
4. Result is drawn back onto `sourceCanvas`; download/print buttons become enabled

### Folder Browser Flow

1. User opens a local folder → images listed in left panel
2. Click image (or ArrowLeft/ArrowRight) → loads into editor with persisted points (if any)
3. Apply correction → saves to `out/` subfolder (always `_0`, `_1`, …) → stays on current image
4. Points are normalized (0–1) and re-applied to each new image
5. Session (folder handle, image index, points) persists across page reloads via IndexedDB + localStorage

### Grid Overlay

Grid state and drawing logic live in `index.html` inline script (not in a separate module). It adapts grid color (white/black) based on average image brightness.
