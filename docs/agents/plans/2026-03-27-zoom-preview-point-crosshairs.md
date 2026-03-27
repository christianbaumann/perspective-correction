---
date: "2026-03-27T14:01:02.792420+00:00"
git_commit: 7f77bbf6f442f441d3212284c433b58f23898e4c
branch: fix/delete-points-not-working
topic: "Zoom Preview Point Crosshairs"
tags: [plan, zoom-preview, points, crosshair]
status: done
---

# Zoom Preview Point Crosshairs — Implementation Plan

## Overview

When the user hovers over the canvas near a set point, the zoom magnifier should display that point as a light blue crosshair. Currently the zoom preview only shows the magnified source image and a cursor crosshair — existing points are invisible in the zoom view.

## Current State Analysis

The zoom preview (`updateZoomPreview()` in `script.js:349-406`) renders:
1. A 3x magnified region of `sourceCanvas` centered on the cursor
2. A cursor crosshair (dark outline + white line) at the center
3. A red center dot

Points are stored in `points[]` as `{ x, y }` in canvas (image-resolution) coordinates. They are drawn on a separate `pointsCanvas` layer and never appear in the zoom preview.

### Key Discoveries:
- `script.js:357` — `regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR` defines the source region
- `script.js:358-359` — `sx, sy` define the top-left corner of the zoom region in source coordinates
- `script.js:441-468` — Points render as white crosshairs with blue/red center dots on pointsCanvas
- Coordinate mapping from source to zoom canvas: `zoomPos = (pointPos - regionOrigin) / regionSize * ZOOM_CANVAS_SIZE`

### UI Mockup

Current zoom preview:
```
┌──────────────────────┐
│                      │
│        ──┼──         │  ← white cursor crosshair
│          │           │    with red center dot
│                      │
│                      │
└──────────────────────┘
```

Desired zoom preview (when a point is nearby):
```
┌──────────────────────┐
│    ──╋──             │  ← light blue point crosshair
│      │               │
│        ──┼──         │  ← white cursor crosshair (unchanged)
│          │           │
│                      │
└──────────────────────┘
```

## Desired End State

When hovering over the canvas, any points that fall within the 3x magnified zoom region appear as light blue crosshairs in the zoom preview. The cursor crosshair remains white with a red center dot. Point crosshairs are drawn **before** the cursor crosshair so the cursor is always on top.

## What We're NOT Doing

- Not changing point rendering on the main `pointsCanvas`
- Not adding hover/proximity detection or highlighting
- Not changing the cursor crosshair style
- Not showing polygon lines between points in the zoom preview
- Not changing the zoom factor or canvas size

## Implementation Approach

After `drawImage()` copies the source region into the zoom canvas, iterate over `points[]` and for each point that falls within the visible zoom region, draw a light blue crosshair at the corresponding zoom-canvas position. This is inserted between the image draw (line 366) and the cursor crosshair draw (line 368).

## Phase 1: Draw Point Crosshairs in Zoom Preview

### Overview
Add point rendering logic to `updateZoomPreview()` in `script.js`.

### Changes Required:

#### [x] 1. Add point crosshair rendering in `updateZoomPreview()`
**File**: `script.js`
**Changes**: Insert after line 366 (after `drawImage`), before line 368 (cursor crosshair).

```javascript
// Draw any points visible in the zoom region as light blue crosshairs
const pointArmLength = 12 * ZOOM_FACTOR; // match crosshair size from drawPoints(), scaled for zoom
for (let i = 0; i < points.length; i++) {
    const px = (points[i].x - sx) / regionSize * ZOOM_CANVAS_SIZE;
    const py = (points[i].y - sy) / regionSize * ZOOM_CANVAS_SIZE;

    // Only draw if the point center is within the zoom canvas bounds (with some margin)
    if (px < -pointArmLength || px > ZOOM_CANVAS_SIZE + pointArmLength ||
        py < -pointArmLength || py > ZOOM_CANVAS_SIZE + pointArmLength) {
        continue;
    }

    // Light blue crosshair
    zoomCtx.strokeStyle = '#74c0fc';
    zoomCtx.lineWidth = 2;

    zoomCtx.beginPath();
    zoomCtx.moveTo(px - pointArmLength, py);
    zoomCtx.lineTo(px + pointArmLength, py);
    zoomCtx.stroke();

    zoomCtx.beginPath();
    zoomCtx.moveTo(px, py - pointArmLength);
    zoomCtx.lineTo(px, py + pointArmLength);
    zoomCtx.stroke();

    // Light blue center dot
    zoomCtx.beginPath();
    zoomCtx.arc(px, py, 3, 0, Math.PI * 2);
    zoomCtx.fillStyle = '#74c0fc';
    zoomCtx.fill();
}
```

**Coordinate math explanation:**
- `sx, sy` = top-left of the source region being magnified
- `regionSize` = width/height of that region in source pixels
- `(points[i].x - sx) / regionSize` = normalized position within the region (0..1)
- Multiply by `ZOOM_CANVAS_SIZE` to get pixel position on the zoom canvas
- `pointArmLength = 12 * ZOOM_FACTOR` because the source crosshair arm is `12 * displayScale` pixels, and the zoom shows at `ZOOM_FACTOR` magnification, which maps `displayScale` source pixels to 1 zoom pixel → arm appears as `12 * ZOOM_FACTOR` zoom pixels

### Success Criteria:

#### Automated Verification:
- [x] Unit tests pass: `npm test`
- [x] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [x] Load an image and add several points
- [x] Hover cursor near a point — the point appears as a light blue crosshair in the zoom preview
- [x] Hover far from any point — no point crosshairs visible in zoom preview
- [x] Verify the cursor crosshair (white with red dot) renders on top of point crosshairs
- [x] Verify point crosshairs in zoom are proportionally sized (not too large/small)
- [x] Test with points near image edges — crosshairs should clip naturally at zoom canvas boundary

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Testing Strategy

### Test Design Techniques Applied

The core logic is coordinate mapping (`source coords → zoom canvas coords`) and conditional rendering (only points within the zoom region). Key input domains: point position relative to zoom region, number of points, edge positions.

### Unit Tests (base of pyramid):

**File**: `tests/unit/zoomPreview.test.js` (extend existing)

**Happy path:**
- [x] `zoomPreview.test.js: draws light blue crosshair when point is within zoom region` — One point at zoom center, verify strokeStyle `#74c0fc` and correct line coordinates `[HAPPY]`
- [x] `zoomPreview.test.js: draws multiple point crosshairs when several points are in region` — Two points in region, verify two sets of crosshair draw calls `[HAPPY]`

**Negative testing:**
- [x] `zoomPreview.test.js: does not draw point crosshair when point is outside zoom region` — Point far from cursor, verify no light blue strokes `[NEG]`
- [x] `zoomPreview.test.js: does not draw point crosshairs when points array is empty` — Empty points array, verify no light blue strokes `[NEG]`

**Edge cases and boundary values:**
- [x] `zoomPreview.test.js: draws crosshair for point exactly at zoom region edge` — Point at boundary of visible region `[BVA]`
- [x] `zoomPreview.test.js: draws crosshair for point just inside zoom region` — Point 1px inside boundary `[BVA]` (combined with edge test)
- [x] `zoomPreview.test.js: skips point just outside zoom region` — Point 1px outside boundary (beyond arm margin) `[BVA]`
- [x] `zoomPreview.test.js: point crosshair clips at zoom canvas edge` — Point near edge of zoom region, arms extend beyond canvas boundary (canvas clips naturally) `[BVA]` (covered by edge test)
- [x] `zoomPreview.test.js: point crosshair drawn before cursor crosshair` — Verify draw order: image → point crosshairs → cursor crosshair `[ECP]`

#### Regression — Affected Existing Functionality:
- [x] `tests/unit/zoomPreview.test.js` — all existing tests still pass (cursor crosshair, zoom visibility, hide behavior)
- [x] `tests/unit/drawPoints.test.js` — still passes (main canvas point rendering unchanged)

### Integration Tests (middle of pyramid):

**File**: `tests/integration/zoomInteraction.test.js` (extend existing)

**Happy path:**
- [x] `zoomInteraction.test.js: zoom preview shows point crosshair when hovering near a point` — Add point, simulate mousemove near it, verify zoom canvas has light blue strokes `[HAPPY]`

**Negative:**
- [x] `zoomInteraction.test.js: zoom preview has no point crosshair when hovering far from all points` — Add point at (100,100), hover at (500,500), verify no light blue strokes in zoom `[NEG]`

### End-to-End Tests (top of pyramid):

**File**: `tests/e2e/crosshairAndZoom.spec.js` (extend existing)

- [ ] `crosshairAndZoom.spec.js: zoom preview shows light blue crosshair when hovering near point` — Add a point, hover over it, take screenshot of zoom canvas, verify visually or via pixel sampling `[HAPPY]`

### Manual Testing Steps:
1. Upload a high-contrast image
2. Add 4+ points forming a quadrilateral
3. Hover slowly toward each point and confirm the light blue crosshair appears in zoom
4. Confirm the white cursor crosshair is always drawn on top
5. Drag a point (move mode) and confirm the point crosshair follows in the zoom

### Test Commands:
```bash
# Unit tests
npm test -- tests/unit/zoomPreview.test.js

# Integration tests
npm test -- tests/integration/zoomInteraction.test.js

# E2E tests
npx playwright test tests/e2e/crosshairAndZoom.spec.js

# Full suite (verify no regressions)
npm run test:all
```

## Performance Considerations

The loop iterates over `points[]` (typically 4-8 points) on every mouse move. This is negligible — a few comparisons and at most a handful of canvas draw calls per frame.

## References

- `script.js:349-406` — current `updateZoomPreview()` implementation
- `script.js:412-468` — `drawPoints()` for crosshair style reference
- `tests/unit/zoomPreview.test.js` — existing zoom preview tests
- `tests/e2e/crosshairAndZoom.spec.js` — existing e2e zoom tests
