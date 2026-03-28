---
date: "2026-03-27T07:21:03.546291+00:00"
git_commit: 7300d1f7e1ab67e79fa30e13b178731e85764a89
branch: main
topic: "Crosshair Points and Zoom Preview"
tags: [plan, canvas, points, crosshair, zoom]
status: draft
---

# Crosshair Points and Zoom Preview Implementation Plan

## Overview

Replace numbered circle point markers with crosshair markers and add a 2.5x zoom preview canvas centered at the top of the canvas wrapper, visible only during active point interaction (dragging or hovering). Both features use a fixed color scheme (no blend modes).

## Current State Analysis

Points are rendered in `drawPoints()` (`script.js:325-372`) as filled blue circles with white number labels. The three-layer canvas stack (`sourceCanvas`, `gridCanvas`, `pointsCanvas`) is positioned inside `.canvas-wrapper`. A CSS custom cursor (`::before` pseudo-element with `mix-blend-mode: difference`) provides a white circle cursor. There is no zoom or magnifier infrastructure. `selectedPointIndex` and `isDragging` track which point is active.

## Desired End State

- Each point marker is a crosshair (two perpendicular lines) instead of a numbered circle
- During active interaction (dragging a point in move mode, or hovering near a point), a zoom preview canvas appears centered at the top of `.canvas-wrapper`
- The zoom preview shows a 2.5x magnified region of the source image around the active point, with a crosshair overlay at center
- The zoom preview disappears when no point is actively being interacted with

### UI Mockups

**Current point markers:**
```
         ┌─────────────────────────────┐
         │                             │
         │      ①────────②            │
         │      │          │            │
         │      ④────────③            │
         │                             │
         └─────────────────────────────┘
```

**New crosshair markers + zoom preview during drag:**
```
         ┌─────────────────────────────┐
         │     ┌─────────────┐         │
         │     │  ╳ (2.5x)   │ ← zoom  │
         │     └─────────────┘         │
         │      ┼────────┼             │
         │      │         │             │
         │      ┼────────┼             │
         │                             │
         └─────────────────────────────┘
```

**Crosshair detail (each point):**
```
              │
              │
         ─────┼─────
              │
              │
```
White lines with blue center dot, fixed colors.

### Key Discoveries:
- `drawPoints()` (`script.js:325-372`) is the single location for point rendering — lines 355-371 draw the circles+numbers
- `selectedPointIndex` (`script.js:39`) tracks active point; `isDragging` (`script.js:41`) tracks drag state
- `displayScale` (`script.js:44`) converts between mouse and canvas coordinates — crosshair size must scale with it
- `sourceCtx.drawImage()` with source rect clipping can efficiently render the zoom region without `getImageData()`
- Connecting lines between points (lines 333-353) remain unchanged
- `handleCanvasMouseMove` (`script.js:300-311`) fires during drag — zoom preview updates here
- The cursor position is tracked via CSS vars `--cursor-x`/`--cursor-y` on `canvasWrapper` (`script.js:56-63`)

## What We're NOT Doing

- Not changing the CSS custom cursor (the white circle `::before` pseudo-element stays as-is)
- Not adding zoom for cursor position without a point — zoom only shows for active point interaction
- Not adding `mix-blend-mode` to canvas-drawn crosshairs — using fixed colors
- Not changing connecting lines or dashed closing lines between points
- Not adding zoom preview outside the canvas wrapper
- Not making the zoom level configurable (fixed at 2.5x)

## Implementation Approach

**Phase 1** modifies only the point drawing code inside `drawPoints()`, replacing circles+numbers with crosshair lines. This is a contained change in a single function.

**Phase 2** adds the zoom preview: a new `<canvas>` element in the HTML, CSS for positioning, and JS logic to show/hide/update it during point interaction. The zoom canvas reads from `sourceCanvas` using `drawImage()` with source rect clipping, then overlays a crosshair at center.

---

## Phase 1: Crosshair Point Markers

### Overview
Replace the numbered circle rendering in `drawPoints()` with crosshair rendering. Each point becomes two perpendicular lines (white) with a small center dot (blue or red when dragging).

### Changes Required:

#### [x] 1. Replace circle+number drawing with crosshair in `drawPoints()`
**File**: `script.js`
**Lines**: 355-371 (the per-point loop body)
**Changes**: Replace `arc()` + `fillText()` with two perpendicular lines and a small center dot.

```javascript
// Replace lines 355-371 with:
for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const crosshairSize = 12 * displayScale; // half-length of each arm
    const centerDotRadius = 3 * displayScale;

    // Crosshair lines (white)
    pointsCtx.strokeStyle = '#ffffff';
    pointsCtx.lineWidth = lineWidth;

    // Horizontal line
    pointsCtx.beginPath();
    pointsCtx.moveTo(point.x - crosshairSize, point.y);
    pointsCtx.lineTo(point.x + crosshairSize, point.y);
    pointsCtx.stroke();

    // Vertical line
    pointsCtx.beginPath();
    pointsCtx.moveTo(point.x, point.y - crosshairSize);
    pointsCtx.lineTo(point.x, point.y + crosshairSize);
    pointsCtx.stroke();

    // Center dot
    pointsCtx.beginPath();
    pointsCtx.arc(point.x, point.y, centerDotRadius, 0, Math.PI * 2);
    pointsCtx.fillStyle = (i === selectedPointIndex && isDragging) ? '#ff6b6b' : '#339af0';
    pointsCtx.fill();
}
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm test`
- [x] E2E tests pass: `npx playwright test` (4 pre-existing test bugs fixed — tests expected manual save but code auto-saves)

#### Manual Verification:
- [ ] Points display as crosshairs instead of numbered circles
- [ ] Crosshairs scale correctly with display (check by resizing window)
- [ ] Center dot turns red when dragging a point
- [ ] Connecting lines between points still render correctly
- [ ] Dashed closing line still renders correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Zoom Preview Canvas

### Overview
Add a zoom preview canvas that appears centered at the top of `.canvas-wrapper` during active point interaction. Shows a 2.5x magnified region of the source image around the active point with a crosshair overlay.

### Changes Required:

#### [x] 1. Add zoom preview canvas element
**File**: `index.html`
**Changes**: Add a `<canvas>` element inside `.canvas-wrapper`, after the existing canvases.

```html
<div class="canvas-wrapper">
    <canvas id="sourceCanvas"></canvas>
    <canvas id="gridCanvas"></canvas>
    <canvas id="pointsCanvas"></canvas>
    <canvas id="zoomCanvas"></canvas>
</div>
```

#### [x] 2. Style the zoom preview canvas
**File**: `styles.css`
**Changes**: Position `#zoomCanvas` at top-center of `.canvas-wrapper`, hidden by default.

```css
#zoomCanvas {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    pointer-events: none;
    border: 2px solid #339af0;
    border-radius: 4px;
    background: #0a1929;
    display: none;
    /* Fixed display size — canvas resolution set in JS */
    width: 200px;
    height: 200px;
}
```

#### [x] 3. Add zoom preview logic to `script.js`
**File**: `script.js`
**Changes**: Add zoom canvas DOM reference, zoom constants, `updateZoomPreview()` function, and integrate with mouse event handlers.

```javascript
// DOM element (add near line 23)
const zoomCanvas = document.getElementById('zoomCanvas');
const zoomCtx = zoomCanvas.getContext('2d');

// Constants
const ZOOM_FACTOR = 2.5;
const ZOOM_DISPLAY_SIZE = 200; // CSS pixels
const ZOOM_CANVAS_SIZE = 200;  // Canvas resolution (1:1 with display for crisp rendering)

// Set zoom canvas resolution once
zoomCanvas.width = ZOOM_CANVAS_SIZE;
zoomCanvas.height = ZOOM_CANVAS_SIZE;

function updateZoomPreview(pointX, pointY) {
    if (!image || !sourceCanvas.width) {
        zoomCanvas.style.display = 'none';
        return;
    }

    zoomCanvas.style.display = 'block';

    // Region of source image to sample (in canvas/image coords)
    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    const sx = pointX - regionSize / 2;
    const sy = pointY - regionSize / 2;

    // Clear and draw magnified region from sourceCanvas
    zoomCtx.clearRect(0, 0, ZOOM_CANVAS_SIZE, ZOOM_CANVAS_SIZE);
    zoomCtx.drawImage(
        sourceCanvas,
        sx, sy, regionSize, regionSize,      // source rect
        0, 0, ZOOM_CANVAS_SIZE, ZOOM_CANVAS_SIZE  // dest rect
    );

    // Draw crosshair overlay at center
    const center = ZOOM_CANVAS_SIZE / 2;
    const armLength = 20;
    zoomCtx.strokeStyle = '#ffffff';
    zoomCtx.lineWidth = 1.5;

    zoomCtx.beginPath();
    zoomCtx.moveTo(center - armLength, center);
    zoomCtx.lineTo(center + armLength, center);
    zoomCtx.stroke();

    zoomCtx.beginPath();
    zoomCtx.moveTo(center, center - armLength);
    zoomCtx.lineTo(center, center + armLength);
    zoomCtx.stroke();

    // Center dot
    zoomCtx.beginPath();
    zoomCtx.arc(center, center, 2, 0, Math.PI * 2);
    zoomCtx.fillStyle = '#339af0';
    zoomCtx.fill();
}

function hideZoomPreview() {
    zoomCanvas.style.display = 'none';
}
```

#### [x] 4. Integrate zoom with mouse event handlers
**File**: `script.js`
**Changes**: Call `updateZoomPreview()` from `handleCanvasMouseDown` (when selecting a point in move mode), `handleCanvasMouseMove` (during drag), and `hideZoomPreview()` from `handleCanvasMouseUp`. Also show zoom when hovering near a point in move mode.

```javascript
// In handleCanvasMouseDown (after line 284, when point selected in move mode):
updateZoomPreview(points[selectedPointIndex].x, points[selectedPointIndex].y);

// In handleCanvasMouseMove (after line 310, after updating point position):
updateZoomPreview(points[selectedPointIndex].x, points[selectedPointIndex].y);

// In handleCanvasMouseUp:
function handleCanvasMouseUp() {
    isDragging = false;
    hideZoomPreview();
}

// Also add hover detection in handleCanvasMouseMove for non-dragging state:
// When in move mode and not dragging, check proximity to any point and show zoom
```

#### [x] 5. Add hover-based zoom in move mode
**File**: `script.js`
**Changes**: Extend `handleCanvasMouseMove` to show zoom preview when hovering near a point in move mode (even without dragging). Hide when not near any point.

```javascript
// In handleCanvasMouseMove, add before the early return:
if (mode === 'move' && !isDragging) {
    const coords = getCanvasCoordinates(event);
    const hitRadius = 15 * displayScale;
    let nearPoint = false;
    for (let i = 0; i < points.length; i++) {
        const dx = coords.x - points[i].x;
        const dy = coords.y - points[i].y;
        if (Math.sqrt(dx * dx + dy * dy) < hitRadius) {
            updateZoomPreview(points[i].x, points[i].y);
            nearPoint = true;
            break;
        }
    }
    if (!nearPoint) hideZoomPreview();
}
```

Note: The current `handleCanvasMouseMove` early-returns on line 301 if not dragging. The hover logic must be added **before** that return, guarded by its own conditions.

#### [x] 6. Hide zoom on mode change and reset
**File**: `script.js`
**Changes**: Call `hideZoomPreview()` in `setMode()` and `resetAllPoints()` to ensure zoom is cleaned up.

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm test` (81/81)
- [x] E2E tests pass: `npx playwright test` (8/8)

#### Manual Verification:
- [ ] Zoom preview appears centered at top when dragging a point
- [ ] Zoom preview shows 2.5x magnified source image around the point
- [ ] Zoom preview has a crosshair overlay at its center
- [ ] Zoom preview updates in real-time as point is dragged
- [ ] Zoom preview appears when hovering near a point in move mode
- [ ] Zoom preview disappears when mouse moves away from points
- [ ] Zoom preview disappears on mouse up (drag end)
- [ ] Zoom preview disappears on mode change
- [ ] Zoom preview handles edge cases: point near image border (clipping is acceptable)
- [ ] Zoom preview does not interfere with point interaction (pointer-events: none)
- [ ] No visual glitches when quickly switching between points

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Testing Strategy

Follow the test pyramid: many unit tests at the base, fewer integration tests in the middle, fewest e2e tests at the top.

### Test Design Techniques Applied

- **Equivalence class partitioning**: Point positions (center of image, edges, corners), zoom states (visible, hidden), interaction modes (add, move, delete)
- **Boundary value analysis**: Points at image boundaries (0,0), (width,height), (width/2, 0), negative after clamp
- **State transition testing**: Zoom visibility states (hidden → visible on drag → hidden on release), mode transitions
- **Decision table testing**: Zoom visibility based on (mode × isDragging × nearPoint) combinations

### Unit Tests (base of pyramid):

#### New/Changed Functionality:

**Happy path:**
- [x] `tests/unit/drawPoints.test.js:crosshair renders at correct position` — crosshair lines centered on point coordinates `[HAPPY]`
- [x] `tests/unit/drawPoints.test.js:crosshair scales with displayScale` — arm length and line width scale proportionally `[HAPPY]`
- [x] `tests/unit/drawPoints.test.js:center dot is blue for non-dragged point` — fillStyle is `#339af0` `[HAPPY]`
- [x] `tests/unit/drawPoints.test.js:center dot is red for dragged point` — fillStyle is `#ff6b6b` when `i === selectedPointIndex && isDragging` `[HAPPY]`
- [x] `tests/unit/zoomPreview.test.js:updateZoomPreview calculates correct source region` — region centered on point at 2.5x magnification `[HAPPY]`
- [x] `tests/unit/zoomPreview.test.js:updateZoomPreview draws crosshair at canvas center` — overlay lines at ZOOM_CANVAS_SIZE/2 `[HAPPY]`

**Negative testing:**
- [x] `tests/unit/zoomPreview.test.js:updateZoomPreview hides when no image` — `display = 'none'` when `image` is null `[NEG]`
- [x] `tests/unit/zoomPreview.test.js:hideZoomPreview sets display none` — always hides regardless of state `[NEG]`

**Edge cases and boundary values:**
- [x] `tests/unit/zoomPreview.test.js:zoom region clamps at image edge (0,0)` — source rect extends into negative coords (canvas clips naturally) `[BVA]`
- [x] `tests/unit/zoomPreview.test.js:zoom region clamps at image edge (maxX,maxY)` — source rect extends beyond canvas dimensions `[BVA]`
- [x] `tests/unit/drawPoints.test.js:crosshair at point (0,0)` — lines extend into negative space `[BVA]`
- [x] `tests/unit/drawPoints.test.js:crosshair at point (width,height)` — lines extend beyond canvas `[BVA]`
- [x] `tests/unit/drawPoints.test.js:displayScale = 1 (no scaling)` — arm length equals base constant `[ECP]`
- [x] `tests/unit/drawPoints.test.js:displayScale > 1 (high-res image)` — arm length multiplied correctly `[ECP]`

**State transitions:**
- [x] `tests/unit/zoomPreview.test.js:zoom hidden → visible on drag start` — `updateZoomPreview` sets `display = 'block'` `[ST]`
- [x] `tests/unit/zoomPreview.test.js:zoom visible → hidden on drag end` — `hideZoomPreview` sets `display = 'none'` `[ST]`
- [x] `tests/unit/zoomPreview.test.js:zoom visible → hidden on mode change` — switching mode hides zoom `[ST]`

**Decision table (zoom visibility):**
- [x] `tests/unit/zoomPreview.test.js:move mode + dragging → zoom visible` `[DT]`
- [x] `tests/unit/zoomPreview.test.js:move mode + hover near point → zoom visible` `[DT]`
- [x] `tests/unit/zoomPreview.test.js:move mode + hover away from points → zoom hidden` `[DT]`
- [x] `tests/unit/zoomPreview.test.js:add mode + any state → zoom hidden` `[DT]`
- [x] `tests/unit/zoomPreview.test.js:delete mode + any state → zoom hidden` `[DT]`

#### Regression — Affected Existing Functionality:
- [x] `tests/unit/pointNormalization.test.js` — verify all existing tests still pass (normalizePoints/denormalizePoints unchanged)
- [x] `tests/integration/pointPersistence.test.js` — verify point persistence still works (drawPoints signature unchanged)
- [x] `tests/integration/scriptDom.test.js` — verify DOM interaction tests still pass

### Integration Tests (middle of pyramid):

**Happy path:**
- [x] `tests/integration/zoomInteraction.test.js:drag point shows and updates zoom` — simulate mousedown on point, mousemove, verify zoom canvas visible and updated `[HAPPY]`
- [x] `tests/integration/zoomInteraction.test.js:zoom preview composites source image region` — verify drawImage called with correct source rect `[HAPPY]`

**Negative / error propagation:**
- [x] `tests/integration/zoomInteraction.test.js:zoom hidden after reset` — resetAllPoints hides zoom preview `[NEG]`

**Boundary / edge:**
- [x] `tests/integration/zoomInteraction.test.js:drag point near edge updates zoom with clipped region` — point at (5, 5) still shows zoom without error `[BVA]`

### End-to-End Tests (top of pyramid):

- [x] `tests/e2e/crosshairAndZoom.spec.js:points render as crosshairs` — add points, verify no numbered circles visible (screenshot comparison or DOM assertion) `[HAPPY]`
- [x] `tests/e2e/crosshairAndZoom.spec.js:zoom preview appears on drag` — enter move mode, drag a point, verify zoom canvas is visible `[HAPPY]`
- [x] `tests/e2e/crosshairAndZoom.spec.js:zoom preview hidden in add mode` — add points, verify zoom canvas not visible `[NEG]`
- [x] `tests/e2e/crosshairAndZoom.spec.js:correction still works with crosshair points` — add 4 points, apply correction, verify success `[HAPPY]`

### Manual Testing Steps:
1. Upload a high-resolution image, add 4+ points — verify crosshairs render cleanly at all positions
2. Switch to move mode, drag a point — verify zoom preview appears at top-center with clear magnified view
3. Move mouse away from all points — verify zoom disappears
4. Drag a point near the image edge — verify zoom shows partial image without errors
5. Apply perspective correction — verify it still works identically to before
6. Test in folder browser mode — verify crosshairs and zoom work with folder images

### Test Commands:
```bash
# Unit tests
npm test

# E2E tests
npx playwright test

# Full suite
npm run test:all
```

## Performance Considerations

- `drawImage()` with source rect clipping is GPU-accelerated — no performance concern for the zoom preview
- The zoom preview updates on every `mousemove` during drag, which is the same frequency as `drawPoints()` — no additional overhead
- Crosshair rendering (4 lines + 1 arc per point) is cheaper than the previous rendering (1 arc + 1 fill + 1 stroke + 1 fillText per point)
- No `getImageData()` needed — `drawImage()` from sourceCanvas to zoomCanvas is a direct blit

## References

- Research: `docs/agents/research/2026-03-27-crosshair-points-and-zoom-preview.md`
- Current point rendering: `script.js:325-372`
- Canvas architecture: `index.html:205-209`, `styles.css:180-232`
- Mouse interaction: `script.js:261-316`
- Display scale calculation: `script.js:186`
