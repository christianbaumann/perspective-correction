---
date: 2026-03-27T11:44:32+00:00
git_commit: 7f77bbf6f442f441d3212284c433b58f23898e4c
branch: fix/delete-points-not-working
topic: "Delete Points mode not working"
tags: [research, codebase, bug, point-interaction]
status: complete
---

# Research: Delete Points Mode Not Working

## Research Question
Investigate why "Delete Points" mode is not working in the perspective correction tool.

## Summary
The point deletion logic lives entirely in `script.js`. Three interaction modes (add/move/delete) share a single `handleCanvasMouseDown` handler on `pointsCanvas`. Delete mode works by hit-testing each point within a radius of `15 * displayScale` pixels; if a point is within range, it is removed via `Array.splice()`. The logic appears structurally correct and mirrors the move-mode hit detection exactly.

Two important runtime factors could cause delete to appear broken:
1. **After applying correction**, both `simplePerspectiveApply.js:83` and `complexPerspectiveApply.js:105` set `pointsCanvas.style.pointerEvents = 'none'`, disabling all canvas mouse interaction until `resetAllPoints()` restores it to `'all'`.
2. **Hit detection radius vs point rendering**: the hit radius is `15 * displayScale` pixels in canvas coordinates. For high-resolution images where `displayScale` is large (e.g., 4x), the hit radius expands to 60 canvas-pixels, which should be generous. For low-res images where `displayScale ≈ 1`, the hit radius is only 15 canvas-pixels, which should still be sufficient given the crosshair arm length of `12 * displayScale`.

Static analysis did not reveal a definitive root cause. Browser testing is needed to confirm the failure mode.

## Detailed Findings

### Mode Switching (`script.js:235-254`)
- `setMode(newMode)` sets the module-level `mode` variable and updates button active states
- `deletePointsBtn` (a `<div class="point-btn">`) has a `click` listener registered at `script.js:81`
- Mode is correctly set to the string `'delete'`

### Mouse Down Handler (`script.js:272-309`)
- `handleCanvasMouseDown` is attached to `pointsCanvas` at `script.js:87`
- Iterates all points, computes Euclidean distance from click to each point
- If distance < hitRadius AND mode === 'delete': `points.splice(i, 1)`, updates UI, returns
- If distance < hitRadius AND mode === 'move': starts dragging
- If no point hit AND mode === 'add': adds new point
- The delete branch and move branch use **identical** hit detection

### Pointer Events After Correction
- `simplePerspectiveApply.js:83`: `pointsCanvas.style.pointerEvents = 'none'`
- `complexPerspectiveApply.js:105`: `pointsCanvas.style.pointerEvents = 'none'`
- `script.js:608` (`resetAllPoints`): `pointsCanvas.style.pointerEvents = 'all'`
- After correction, ALL canvas interaction (add/move/delete) is disabled until reset

### CSS Layering
- `#pointsCanvas`: z-index 3, `pointer-events: all`
- `#zoomCanvas`: z-index 4, `pointer-events: none` — should not block clicks
- `.canvas-wrapper::before`: z-index 9999, `pointer-events: none` — custom cursor, should not block clicks

### Canvas Coordinate System (`script.js:257-269`)
- `getCanvasCoordinates` converts mouse position to canvas coordinates using `displayScale`
- Same function is used by all three modes

## Code References
- `script.js:18` — `deletePointsBtn` DOM element
- `script.js:48` — `mode` state variable
- `script.js:81` — Delete button click listener
- `script.js:87` — Canvas mousedown listener
- `script.js:235-254` — `setMode()` function
- `script.js:272-309` — `handleCanvasMouseDown()` with delete logic (lines 287-292)
- `script.js:592-622` — `resetAllPoints()` restoring pointer events
- `simplePerspectiveApply.js:83` — Disables pointer events after correction
- `complexPerspectiveApply.js:105` — Disables pointer events after correction
- `styles.css:229-232` — pointsCanvas CSS with `pointer-events: all`
- `styles.css:234-248` — zoomCanvas CSS with `pointer-events: none`

## Open Questions
- Does the bug occur before or after applying correction?
- Is the hit detection radius too small for certain image sizes?
- Could a browser-specific behavior prevent the mousedown from firing in delete mode?
