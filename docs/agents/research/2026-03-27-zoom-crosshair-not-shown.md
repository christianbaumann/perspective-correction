---
date: 2026-03-27T11:00:38+00:00
git_commit: 7300d1f7e1ab67e79fa30e13b178731e85764a89
branch: fix/zoom-crosshair-not-shown
topic: "Zoom crosshair at top of image not showing"
tags: [research, codebase, zoom-preview, crosshair]
status: complete
---

# Research: Zoom crosshair at top of image not showing

## Research Question
The zoomed crosshair at the top of the loaded image is not being shown. It should always be there, 3x the size of the selection point crosshairs, and with a 3x zoom.

## Summary

The zoom preview canvas (`#zoomCanvas`) exists and is fully implemented, but it is only displayed in **move mode** when the cursor is near an existing point or actively dragging one. In all other situations (add mode, delete mode, no nearby point) the preview is hidden via `display: none`. The user expectation is that the zoom preview should always be visible whenever the cursor is over the image.

## Detailed Findings

### Zoom Canvas Setup (script.js:36-42)
- `zoomCanvas` is a 200×200 pixel canvas (`ZOOM_CANVAS_SIZE = 200`)
- Zoom factor is `ZOOM_FACTOR = 2.5` (user wants 3x)
- Canvas is positioned via CSS at `top: 10px; left: 50%; transform: translateX(-50%)` — centered at top of `.canvas-wrapper`
- Default CSS: `display: none`

### Visibility Triggers (script.js)
- `updateZoomPreview(pointX, pointY)` (line 357): Sets `zoomCanvas.style.display = 'block'` — only called from two places:
  1. `handleCanvasMouseDown` (line 294): Only in move mode, when clicking on an existing point
  2. `handleCanvasMouseMove` (lines 322, 340): Only in move mode, either hovering near a point or dragging a selected point
- `hideZoomPreview()` (line 415): Sets `zoomCanvas.style.display = 'none'` — called from:
  1. `setMode()` (line 234): Every mode switch hides it
  2. `handleCanvasMouseMove` (line 327): When not near any point in move mode
  3. `handleCanvasMouseUp` (line 347): On mouse up
  4. `resetAllPoints` (line 610): On reset

### Crosshair Sizes
- Selection point crosshairs (line 450): `crosshairSize = 12 * displayScale` (half-arm length)
- Zoom preview crosshair (line 378): `armLength = 30` (fixed, not scaled relative to selection crosshairs)
- User wants zoom crosshair to be 3x the selection crosshair size

### Root Cause
The zoom preview is intentionally limited to move mode + near-point interactions. To make it "always there," the following changes are needed:
1. Show zoom preview on every `mousemove` over `pointsCanvas`, regardless of mode
2. Change `ZOOM_FACTOR` from 2.5 to 3
3. Scale the zoom crosshair arm length to 3x the selection crosshair size

## Code References
- `script.js:36-42` — Zoom canvas setup and constants
- `script.js:64-71` — Cursor position tracking on canvas wrapper
- `script.js:234` — hideZoomPreview called on mode change
- `script.js:294` — updateZoomPreview called in mousedown (move mode only)
- `script.js:310-342` — mousemove handler, zoom only in move mode
- `script.js:357-413` — updateZoomPreview function
- `script.js:415-417` — hideZoomPreview function
- `script.js:448-474` — drawPoints with crosshair rendering
- `styles.css:234-248` — #zoomCanvas CSS positioning
