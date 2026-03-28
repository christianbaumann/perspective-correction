---
date: 2026-03-27T14:18:49Z
git_commit: dd6052d
branch: fix/delete-points-not-working
topic: "Corner Zoom Boxes for Selected Points"
tags: [plan, zoom, canvas, ui]
status: draft
---

# Corner Zoom Boxes for Selected Points — Implementation Plan

## Overview

Add 4 permanent zoom boxes — one per corner — positioned in the blue horizontal space flanking the portrait image. Each box shows a zoomed view of the area around its assigned corner point, updating live during drag. The existing cursor-following zoom preview is kept.

## Current State Analysis

- **Existing zoom**: Single 200×200 `#zoomCanvas` centered at top of `.canvas-wrapper`, follows cursor, 3× magnification. Shows existing points as light blue crosshairs.
- **Layout**: Portrait images leave horizontal blue space on both sides of the canvas. `setupCanvas()` computes `offsetX = (containerWidth - displayWidth) / 2` and `offsetY = (containerHeight - displayHeight) / 2` (script.js:209-210).
- **Points**: Stored in `points[]` in insertion order. `orderPoints()` sorts by angle from centroid, starting from top-left — used only at correction time.
- **Canvas stack**: 4 canvases (`source`, `grid`, `points`, `zoom`) absolutely positioned inside `.canvas-wrapper`.

### Key Discoveries:
- `offsetX` is the available blue space width on each side (script.js:209)
- `displayScale` converts mouse→canvas coords (script.js:197)
- `updateZoomPreview()` already draws zoomed source region + point crosshairs (script.js:349-436) — can be refactored into a shared helper
- Points aren't ordered by position until `orderPoints()` is called — corner assignment needs spatial mapping

### UI Mockup — Portrait Image Layout

```
┌─────────────────────────────────────────────────────────┐
│ .canvas-wrapper                                         │
│                                                         │
│  ┌─────────┐  ┌──────────────────────┐  ┌─────────┐    │
│  │ TL zoom │  │                      │  │ TR zoom │    │
│  │  150×150│  │                      │  │  150×150│    │
│  └─────────┘  │                      │  └─────────┘    │
│               │    Portrait Image    │                  │
│               │                      │                  │
│               │                      │                  │
│  ┌─────────┐  │                      │  ┌─────────┐    │
│  │ BL zoom │  │                      │  │ BR zoom │    │
│  │  150×150│  │                      │  │  150×150│    │
│  └─────────┘  └──────────────────────┘  └─────────┘    │
│                                                         │
│          ┌──────────┐  ← cursor zoom (existing)         │
│          │  200×200 │     stays centered at top          │
│          └──────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

Each corner zoom box:
- 150×150px (smaller than cursor zoom to fit in the side space)
- 3× magnification (same as cursor zoom)
- Bordered with a color matching its assigned point
- Shows "empty" placeholder (dark bg, dashed border) when no point assigned
- When a point is assigned: shows zoomed area centered on that point with a crosshair

## Desired End State

4 corner zoom boxes always visible in `.canvas-wrapper` when an image is loaded. Each shows the zoomed area around its assigned corner point. Live-updates during point drag. Cursor zoom still works independently.

### How to verify:
1. Load a portrait image — 4 zoom boxes appear in the side spaces, showing dark placeholder
2. Add 4 points — each zoom box snaps to show its nearest corner's zoom
3. Move a point in Move mode — the corresponding zoom box updates in real-time
4. Reset points — zoom boxes revert to placeholder state
5. Cursor zoom still works as before

## What We're NOT Doing

- No zoom boxes for 5+ point mode (user stated always 4 points)
- No zoom boxes for landscape images (user stated always portrait)
- No drag interaction on the zoom boxes themselves
- No responsive/mobile layout for zoom boxes (user works on desktop)
- Not changing the existing cursor zoom behavior

## Implementation Approach

1. Add 4 `<canvas>` elements to HTML for corner zoom boxes
2. CSS positions them absolutely in the side spaces using `offsetX`/`offsetY` computed in `setupCanvas()`
3. Extract zoom rendering into a shared function used by both cursor zoom and corner zooms
4. Add corner assignment logic: map points to TL/TR/BL/BR based on spatial position
5. Update corner zooms whenever points change (add/move/delete/reset)

## Phase 1: HTML + CSS — Corner Zoom Box Elements

### Overview
Add the 4 corner zoom canvas elements and style them.

### Changes Required:

#### [x] 1. Add corner zoom canvases to HTML
**File**: `index.html`
**Changes**: Add 4 canvas elements inside `.canvas-wrapper`, after `#zoomCanvas`

```html
<canvas id="cornerZoomTL" class="corner-zoom" data-corner="tl"></canvas>
<canvas id="cornerZoomTR" class="corner-zoom" data-corner="tr"></canvas>
<canvas id="cornerZoomBL" class="corner-zoom" data-corner="bl"></canvas>
<canvas id="cornerZoomBR" class="corner-zoom" data-corner="br"></canvas>
```

#### [x] 2. Style corner zoom canvases
**File**: `styles.css`
**Changes**: Add styles for `.corner-zoom` — absolute positioning, z-index 5 (above zoom canvas), border, background, pointer-events none. Position is set dynamically via JS (depends on offsetX/offsetY).

```css
.corner-zoom {
    position: absolute;
    z-index: 5;
    pointer-events: none;
    width: 150px;
    height: 150px;
    border: 2px dashed rgba(116, 192, 252, 0.4);
    border-radius: 4px;
    background: rgba(10, 25, 40, 0.8);
    display: none; /* shown by JS when image loads */
}

.corner-zoom.has-point {
    border: 2px solid #74c0fc;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
}
```

### Success Criteria:

#### Automated Verification:
- [x] `npm test` passes (no regressions)
- [x] `npx playwright test` passes

#### Manual Verification:
- [ ] 4 corner zoom elements visible in DOM inspector
- [ ] No visual change yet (display: none until JS activates them)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Corner Zoom Logic in JavaScript

### Overview
Wire up the 4 corner zoom canvases — position them dynamically, assign points to corners, render zoomed views, and update live during interaction.

### Changes Required:

#### [x] 1. Initialize corner zoom canvases and contexts
**File**: `script.js`
**Changes**: After existing zoom canvas setup (line ~42), add:

```javascript
// Corner zoom previews
const CORNER_ZOOM_SIZE = 150;
const cornerZoomCanvases = {
    tl: document.getElementById('cornerZoomTL'),
    tr: document.getElementById('cornerZoomTR'),
    bl: document.getElementById('cornerZoomBL'),
    br: document.getElementById('cornerZoomBR'),
};
const cornerZoomCtxs = {};
for (const [key, canvas] of Object.entries(cornerZoomCanvases)) {
    canvas.width = CORNER_ZOOM_SIZE;
    canvas.height = CORNER_ZOOM_SIZE;
    cornerZoomCtxs[key] = canvas.getContext('2d');
}
```

#### [x] 2. Position corner zoom boxes in `setupCanvas()`
**File**: `script.js`
**Changes**: At the end of `setupCanvas()`, after computing `offsetX` and `offsetY`, position the corner zoom boxes in the side spaces. Also show them (display: block).

```javascript
function positionCornerZooms(offsetX, offsetY, displayWidth, displayHeight) {
    const margin = 8;
    const cSize = CORNER_ZOOM_SIZE;

    // Left column: centered in the blue space to the left of the image
    const leftX = Math.max(margin, (offsetX - cSize) / 2);
    // Right column: centered in the blue space to the right
    const rightX = offsetX + displayWidth + Math.max(margin, (offsetX - cSize) / 2);

    // Top row: aligned near top of image
    const topY = offsetY + margin;
    // Bottom row: aligned near bottom of image
    const bottomY = offsetY + displayHeight - cSize - margin;

    const positions = {
        tl: { left: leftX, top: topY },
        tr: { left: rightX, top: topY },
        bl: { left: leftX, top: bottomY },
        br: { left: rightX, top: bottomY },
    };

    for (const [key, canvas] of Object.entries(cornerZoomCanvases)) {
        const pos = positions[key];
        canvas.style.left = pos.left + 'px';
        canvas.style.top = pos.top + 'px';
        canvas.style.display = 'block';
    }
}
```

#### [x] 3. Assign points to corners
**File**: `script.js`
**Changes**: Add function to map points to TL/TR/BL/BR based on spatial position relative to image bounds.

```javascript
function assignPointsToCorners() {
    // Returns { tl: point|null, tr: point|null, bl: point|null, br: point|null }
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const corners = {
        tl: { x: 0, y: 0 },
        tr: { x: w, y: 0 },
        bl: { x: 0, y: h },
        br: { x: w, y: h },
    };

    const assignment = { tl: null, tr: null, bl: null, br: null };
    const used = new Set();

    // Greedy nearest-corner assignment
    const entries = Object.entries(corners);
    // Sort by distance to find best matches greedily
    const pairs = [];
    for (const [key, corner] of entries) {
        for (let i = 0; i < points.length; i++) {
            const dx = points[i].x - corner.x;
            const dy = points[i].y - corner.y;
            pairs.push({ key, index: i, dist: dx * dx + dy * dy });
        }
    }
    pairs.sort((a, b) => a.dist - b.dist);

    const usedCorners = new Set();
    for (const pair of pairs) {
        if (usedCorners.has(pair.key) || used.has(pair.index)) continue;
        assignment[pair.key] = points[pair.index];
        usedCorners.add(pair.key);
        used.add(pair.index);
    }

    return assignment;
}
```

#### [x] 4. Render corner zoom content
**File**: `script.js`
**Changes**: Add function to draw zoomed content into a corner zoom canvas, similar to `updateZoomPreview` but centered on a fixed point (no cursor crosshair, just the point crosshair).

```javascript
function updateCornerZoom(cornerKey, point) {
    const canvas = cornerZoomCanvases[cornerKey];
    const ctx = cornerZoomCtxs[cornerKey];

    if (!point) {
        // Clear and show placeholder state
        ctx.clearRect(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);
        canvas.classList.remove('has-point');
        return;
    }

    canvas.classList.add('has-point');

    const regionSize = CORNER_ZOOM_SIZE * displayScale / ZOOM_FACTOR;
    const sx = point.x - regionSize / 2;
    const sy = point.y - regionSize / 2;

    ctx.clearRect(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);
    ctx.drawImage(
        sourceCanvas,
        sx, sy, regionSize, regionSize,
        0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE
    );

    // Draw crosshair at center (the point location)
    const center = CORNER_ZOOM_SIZE / 2;
    const armLength = 12 * ZOOM_FACTOR;

    // Dark outline
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(center - armLength, center);
    ctx.lineTo(center + armLength, center);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(center, center - armLength);
    ctx.lineTo(center, center + armLength);
    ctx.stroke();

    // White line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center - armLength, center);
    ctx.lineTo(center + armLength, center);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(center, center - armLength);
    ctx.lineTo(center, center + armLength);
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(center, center, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#74c0fc';
    ctx.fill();
}
```

#### [x] 5. Call `updateAllCornerZooms()` on every point change
**File**: `script.js`
**Changes**: Add master update function and call it from `drawPoints()`, `resetAllPoints()`, `handleCanvasMouseMove()` (during drag), and after point add/delete.

```javascript
function updateAllCornerZooms() {
    if (!image || !sourceCanvas.width) {
        for (const key of Object.keys(cornerZoomCanvases)) {
            updateCornerZoom(key, null);
        }
        return;
    }
    const assignment = assignPointsToCorners();
    for (const [key, point] of Object.entries(assignment)) {
        updateCornerZoom(key, point);
    }
}
```

Call sites:
- End of `drawPoints()` — covers add, delete, move-drag, reset
- End of `setupCanvas()` — covers image load (show placeholders)
- In `handleCanvasMouseMove()` during drag — already calls `drawPoints()` which will trigger it

#### [x] 6. Hide corner zooms when no image / on mouseleave reset
**File**: `script.js`
**Changes**: In `hideZoomPreview()`, do NOT hide corner zooms (they're always visible). In `resetAllPoints()`, call `updateAllCornerZooms()` to clear them back to placeholder state.

### Success Criteria:

#### Automated Verification:
- [x] `npm test` passes
- [x] `npx playwright test` passes

#### Manual Verification:
- [ ] Load portrait image → 4 zoom boxes appear in blue side spaces (TL, TR left side; TL, TR right side)
- [ ] Add 1 point → nearest corner zoom box shows zoomed view, others stay placeholder
- [ ] Add 4 points → all 4 zoom boxes show zoomed views of their respective corners
- [ ] Move mode + drag point → corresponding corner zoom updates live
- [ ] Reset → all boxes revert to dashed placeholder
- [ ] Cursor zoom still works independently at top-center
- [ ] Zoom boxes don't overlap the image

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Edge Cases & Polish

### Overview
Handle edge cases: insufficient side space, window resize, and point count transitions.

### Changes Required:

#### [x] 1. Handle narrow side space
**File**: `script.js`
**Changes**: In `positionCornerZooms()`, if `offsetX < CORNER_ZOOM_SIZE + 16`, hide the corner zooms (not enough space). This prevents overlap with the image.

```javascript
if (offsetX < CORNER_ZOOM_SIZE + 16) {
    for (const canvas of Object.values(cornerZoomCanvases)) {
        canvas.style.display = 'none';
    }
    return;
}
```

#### [x] 2. Reposition on window resize
**File**: `script.js`
**Changes**: The existing `window.addEventListener('resize', ...)` (if present) or a new one should call `setupCanvas()` which already calls `positionCornerZooms()`.

```javascript
window.addEventListener('resize', () => {
    if (image) setupCanvas();
});
```

Note: `setupCanvas()` resets points, so we need to preserve them across resize. Save/restore points around the resize call.

#### [x] 3. Point label on corner zoom border
**File**: `script.js` / `styles.css`
**Changes**: Add a small label (TL, TR, BL, BR) in the corner of each zoom box via CSS `::after` or a drawn label on canvas. Keep it minimal — just enough to identify which corner.

### Success Criteria:

#### Automated Verification:
- [x] `npm test` passes
- [x] `npx playwright test` passes

#### Manual Verification:
- [ ] Resize browser window → zoom boxes reposition correctly
- [ ] Very narrow window → zoom boxes hide gracefully
- [ ] Corner labels are readable but unobtrusive

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Testing Strategy

Follow the test pyramid: many unit tests at the base, fewer integration tests in the middle, fewest e2e tests at the top.

### Test Design Techniques Applied

- **Equivalence class partitioning**: Point counts (0, 1, 2, 3, 4), point positions per quadrant
- **Boundary value analysis**: Points exactly on center lines, offsetX just above/below threshold
- **State transition testing**: Placeholder → has-point → placeholder (on reset)
- **Decision table testing**: Corner assignment with various point configurations

### Unit Tests (base of pyramid):

#### New/Changed Functionality:

**Happy path:**
- [x] `tests/unit/cornerZoom.test.js:assigns 4 points to correct corners` — 4 points near TL/TR/BL/BR map correctly `[HAPPY]`
- [x] `tests/unit/cornerZoom.test.js:renders zoomed region centered on point` — drawImage called with correct source region `[HAPPY]`

**Negative testing:**
- [x] `tests/unit/cornerZoom.test.js:handles 0 points — all corners null` — returns all-null assignment `[NEG]`
- [x] `tests/unit/cornerZoom.test.js:handles no image — clears all canvases` — early return path `[NEG]`

**Edge cases and boundary values:**
- [x] `tests/unit/cornerZoom.test.js:assigns 1 point to nearest corner` — single point maps to closest corner `[ECP]`
- [x] `tests/unit/cornerZoom.test.js:assigns 2 points to nearest corners` — two points, no double-assignment `[ECP]`
- [x] `tests/unit/cornerZoom.test.js:assigns 3 points to nearest corners` — three points, one corner empty `[ECP]`
- [x] `tests/unit/cornerZoom.test.js:point on exact center assigns to TL` — boundary: equidistant point `[BVA]`
- [x] `tests/unit/cornerZoom.test.js:point at image edge (0,0)` — boundary: corner pixel `[BVA]`
- [x] `tests/unit/cornerZoom.test.js:point at image edge (w,h)` — boundary: opposite corner pixel `[BVA]`
- [x] `tests/unit/cornerZoom.test.js:greedy assignment avoids double-mapping` — two points both near TL, one reassigned `[DT]`
- [x] `tests/unit/cornerZoom.test.js:positionCornerZooms hides when offsetX too small` — offsetX < threshold `[BVA]`
- [x] `tests/unit/cornerZoom.test.js:positionCornerZooms shows when offsetX sufficient` — offsetX >= threshold `[BVA]`

#### Regression — Affected Existing Functionality:
- [x] `tests/unit/zoomPreview.test.js` — verify all 34 existing tests still pass
- [x] `tests/unit/drawPoints.test.js` — verify all 13 existing tests still pass (drawPoints now calls updateAllCornerZooms)

### Integration Tests (middle of pyramid):

**Happy path:**
- [x] `tests/integration/cornerZoomInteraction.test.js:corner zooms update when points added` — add 4 points, verify all 4 canvases drawn `[HAPPY]`
- [x] `tests/integration/cornerZoomInteraction.test.js:corner zooms update during drag` — simulate drag, verify canvas redrawn `[HAPPY]`

**Negative / error propagation:**
- [x] `tests/integration/cornerZoomInteraction.test.js:corner zooms clear on resetAllPoints` — reset clears all to placeholder `[NEG]`

**Boundary / edge:**
- [x] `tests/integration/cornerZoomInteraction.test.js:corner zooms reposition on setupCanvas` — image reload repositions `[BVA]`

### End-to-End Tests (top of pyramid):

- [x] `tests/e2e/cornerZoom.spec.js:4 zoom boxes visible after image load` — all 4 present in DOM with display:block `[HAPPY]`
- [x] `tests/e2e/cornerZoom.spec.js:zoom boxes show point content after 4 clicks` — add 4 points, verify boxes have has-point class `[HAPPY]`
- [x] `tests/e2e/cornerZoom.spec.js:zoom boxes revert to placeholder on reset` — click reset, verify has-point removed `[NEG]`

### Manual Testing Steps:
1. Load portrait image, verify 4 empty zoom boxes in side spaces
2. Add 4 corner points, verify each box shows correct corner zoomed
3. Switch to Move mode, drag a point — verify live update in corresponding box
4. Delete a point — verify that box reverts to placeholder
5. Reset all — verify all boxes revert
6. Cursor zoom still tracks mouse independently

### Test Commands:
```bash
# Unit tests
npx vitest run tests/unit/cornerZoom.test.js

# Integration tests
npx vitest run tests/integration/cornerZoomInteraction.test.js

# E2E tests
npx playwright test tests/e2e/cornerZoom.spec.js

# Full suite (verify no regressions)
npm test && npx playwright test
```

## Performance Considerations

- Corner zoom rendering reuses `drawImage()` from sourceCanvas — same approach as cursor zoom, negligible overhead
- `assignPointsToCorners()` runs on every point change — with max 4 points and 4 corners, the O(n²) greedy sort is trivial
- No additional image data copies needed

## References

- Existing zoom implementation: `script.js:349-436`
- Canvas positioning logic: `script.js:208-215`
- Point ordering: `helpers.js:2-35`
- Existing zoom tests: `tests/unit/zoomPreview.test.js`
