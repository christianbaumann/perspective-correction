---
date: "2026-03-27T14:49:02.249025+00:00"
git_commit: dd6052da454ded217de5d377b46e286f4a45f618
branch: fix/delete-points-not-working
topic: "Corner Zoom Drag & Enter Shortcut"
tags: [plan, corner-zoom, keyboard-shortcut, interaction]
status: draft
---

# Corner Zoom Drag & Enter Shortcut Implementation Plan

## Overview

Two UX improvements: (1) allow dragging points directly in the corner zoom boxes for precise sub-pixel positioning, and (2) bind the Enter key to trigger "Apply correction".

## Current State Analysis

### Corner Zoom Boxes
- Four 150×150 canvases (`cornerZoomTL/TR/BL/BR`) positioned around the image
- Show 3x magnified view centered on the assigned point
- `pointer-events: none` in CSS — completely non-interactive
- `assignPointsToCorners()` maps points to corners by nearest-distance greedy algorithm
- Each corner stores a reference to the actual point object in the `points` array

### Apply Correction
- `transformBtn.addEventListener('click', applyPerspectiveCorrection)` at `script.js:98`
- No keyboard shortcut exists

## Desired End State

### Corner Zoom Drag
When in **move mode**, the user can click and drag inside any corner zoom box that has a point assigned. The drag translates 1:1 in the zoomed coordinate space (so a 1px mouse movement = ~0.33 canvas pixels due to 3x zoom), giving fine-grained control. During drag:
- The point updates in the main `points` array
- The main canvas crosshairs update in real-time
- All corner zoom boxes re-render
- The cursor changes to indicate interactivity

### UI Mockup — Corner Zoom Interaction States

```
  Current (no interaction):          With drag support (move mode):
  ┌─────────────────┐                ┌─────────────────┐
  │ TL              │                │ TL    cursor:grab│
  │     ─┼─         │                │     ─┼─         │
  │   (static)      │                │  (draggable)     │
  │ pointer:none    │                │  pointer:auto    │
  └─────────────────┘                └─────────────────┘

  During drag (move mode):
  ┌─────────────────┐
  │ TL  cursor:grab │
  │     ─●─ (red)   │  ← center dot turns red while dragging
  │  point follows   │
  │  mouse precisely │
  └─────────────────┘
```

### Enter Key
Pressing Enter (when no input is focused) triggers `applyPerspectiveCorrection()`, same as clicking the button.

### Key Discoveries:
- Corner zoom canvases have `pointer-events: none` (`styles.css:260`) — must change to `auto` conditionally
- `assignPointsToCorners()` returns `{ tl: pointRef, ... }` where `pointRef` is a **direct reference** to the object in `points[]` — mutating `pointRef.x/y` directly updates the array (`script.js:521`)
- The zoom region size formula: `regionSize = CORNER_ZOOM_SIZE * displayScale / ZOOM_FACTOR` (`script.js:548`)
- Coordinate back-conversion from corner zoom pixel to canvas: `canvasCoord = point.coord + (zoomPixel - center) * regionSize / CORNER_ZOOM_SIZE`
- `drawPoints()` already calls `updateAllCornerZooms()` (`script.js:668`), so updating the point and calling `drawPoints()` will refresh everything

## What We're NOT Doing

- Not adding point **add** or **delete** interactions in corner zoom boxes (only move/drag)
- Not changing the zoom factor or corner zoom box size
- Not adding touch support (only mouse events)
- Not changing the point-to-corner assignment algorithm

## Implementation Approach

Phase 1 adds the Enter keyboard shortcut (trivial). Phase 2 adds corner zoom drag support (the core work).

---

## Phase 1: Enter Key Shortcut

### Overview
Add a global keydown listener that triggers perspective correction when Enter is pressed.

### Changes Required:

#### [ ] 1. Add keydown listener in `init()`
**File**: `script.js`
**Changes**: Add keyboard event listener in the `init()` function

```javascript
// In init(), after existing event listeners:
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.target.matches('input, textarea, select, button')) {
        e.preventDefault();
        applyPerspectiveCorrection();
    }
});
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `npm test`
- [ ] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [ ] Pressing Enter with 4+ points triggers correction
- [ ] Enter does nothing when fewer than 4 points exist (handled by `applyPerspectiveCorrection` guard)
- [ ] Enter while focused on a button or input does NOT double-fire
- [ ] Enter in folder browser doesn't interfere with normal browser behavior

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Corner Zoom Box Drag Support

### Overview
Enable mouse-based point dragging within corner zoom canvases, providing 3x precision for fine adjustments.

### Changes Required:

#### [ ] 1. Track corner zoom state
**File**: `script.js`
**Changes**: Add state variables for corner zoom dragging and store the current assignment

```javascript
// After existing state variables (line ~68):
let cornerDragState = null; // { cornerKey, pointRef, startX, startY }
let currentCornerAssignment = { tl: null, tr: null, bl: null, br: null };
```

#### [ ] 2. Update `assignPointsToCorners` to also store point index
**File**: `script.js`
**Changes**: Return both point reference and index so we can set `selectedPointIndex` during drag

```javascript
// assignPointsToCorners should store the index in each assignment entry
// Change assignment values from `points[pair.index]` to `{ point: points[pair.index], index: pair.index }`
```

#### [ ] 3. Conditionally enable pointer events on corner zoom canvases
**File**: `script.js`
**Changes**: In `setMode()`, toggle `pointer-events` on corner zoom canvases

```javascript
// In setMode():
for (const canvas of Object.values(cornerZoomCanvases)) {
    canvas.style.pointerEvents = (newMode === 'move') ? 'auto' : 'none';
    canvas.style.cursor = (newMode === 'move') ? 'grab' : 'default';
}
```

#### [ ] 4. Add mouse event handlers for corner zoom canvases
**File**: `script.js`
**Changes**: In `init()`, attach mousedown/mousemove/mouseup/mouseleave handlers to each corner zoom canvas

```javascript
// In init(), add corner zoom event listeners:
for (const [key, canvas] of Object.entries(cornerZoomCanvases)) {
    canvas.addEventListener('mousedown', (e) => handleCornerZoomMouseDown(e, key));
    canvas.addEventListener('mousemove', (e) => handleCornerZoomMouseMove(e, key));
    canvas.addEventListener('mouseup', handleCornerZoomMouseUp);
    canvas.addEventListener('mouseleave', handleCornerZoomMouseUp);
}
```

#### [ ] 5. Implement corner zoom mouse handlers
**File**: `script.js`
**Changes**: Add three handler functions for corner zoom drag interaction

```javascript
function handleCornerZoomMouseDown(event, cornerKey) {
    if (mode !== 'move' || !image) return;
    const entry = currentCornerAssignment[cornerKey];
    if (!entry) return;

    event.preventDefault();
    cornerDragState = { cornerKey, pointRef: entry.point, pointIndex: entry.index };
    selectedPointIndex = entry.index;
    isDragging = true;
    event.target.style.cursor = 'grabbing';
    drawPoints();
}

function handleCornerZoomMouseMove(event) {
    if (!cornerDragState) return;

    const canvas = cornerZoomCanvases[cornerDragState.cornerKey];
    const rect = canvas.getBoundingClientRect();
    const zoomX = event.clientX - rect.left;
    const zoomY = event.clientY - rect.top;

    // Convert zoom canvas pixel → main canvas coordinate
    const regionSize = CORNER_ZOOM_SIZE * displayScale / ZOOM_FACTOR;
    const center = CORNER_ZOOM_SIZE / 2;
    const canvasX = cornerDragState.pointRef.x + (zoomX - center) * regionSize / CORNER_ZOOM_SIZE;
    const canvasY = cornerDragState.pointRef.y + (zoomY - center) * regionSize / CORNER_ZOOM_SIZE;

    // Clamp to canvas bounds
    cornerDragState.pointRef.x = Math.max(0, Math.min(sourceCanvas.width, canvasX));
    cornerDragState.pointRef.y = Math.max(0, Math.min(sourceCanvas.height, canvasY));

    drawPoints();
}

function handleCornerZoomMouseUp() {
    if (cornerDragState) {
        const canvas = cornerZoomCanvases[cornerDragState.cornerKey];
        canvas.style.cursor = 'grab';
        cornerDragState = null;
    }
    isDragging = false;
}
```

#### [ ] 6. Store assignment in `updateAllCornerZooms`
**File**: `script.js`
**Changes**: Cache the assignment result for use by drag handlers

```javascript
function updateAllCornerZooms() {
    if (!image || !sourceCanvas.width) {
        currentCornerAssignment = { tl: null, tr: null, bl: null, br: null };
        // ...existing null rendering...
        return;
    }
    currentCornerAssignment = assignPointsToCorners();
    for (const [key, entry] of Object.entries(currentCornerAssignment)) {
        updateCornerZoom(key, entry ? entry.point : null);
    }
}
```

#### [ ] 7. Remove `pointer-events: none` from CSS default
**File**: `styles.css`
**Changes**: Remove the hard-coded `pointer-events: none` from `.corner-zoom` since it's now controlled by JS in `setMode()`

```css
/* Remove: pointer-events: none; from .corner-zoom */
/* The JS setMode() function will control this dynamically */
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `npm test`
- [ ] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [ ] In move mode: hovering a corner zoom with a point shows grab cursor
- [ ] In move mode: clicking and dragging in a corner zoom moves the point smoothly
- [ ] During drag: main canvas crosshair updates in real-time
- [ ] During drag: all other corner zooms update (if points are reassigned)
- [ ] During drag: center dot turns red (existing drag behavior)
- [ ] Releasing mouse stops drag
- [ ] Mouse leaving corner zoom stops drag
- [ ] In add/delete mode: corner zooms remain non-interactive
- [ ] Points near image edges can be dragged without going out of bounds (clamping works)
- [ ] After dragging in corner zoom, point can still be dragged on main canvas normally

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Testing Strategy

Follow the test pyramid: many unit tests at the base, fewer integration tests in the middle, fewest e2e tests at the top.

### Test Design Techniques Applied

For each function under test, systematically applied: equivalence class partitioning (ECP), boundary value analysis (BVA), state transition testing (ST), and error guessing (ERR).

### Unit Tests (base of pyramid — fast, isolated, exhaustive):

#### Feature 1: Enter Key Shortcut

**Happy path:**
- [ ] `tests/unit/enterKey.test.js:triggers applyPerspectiveCorrection on Enter keydown` — dispatching Enter key event calls the correction function `[HAPPY]`

**Negative testing:**
- [ ] `tests/unit/enterKey.test.js:does not trigger when target is input element` — Enter on `<input>` does not call correction `[NEG]`
- [ ] `tests/unit/enterKey.test.js:does not trigger when target is textarea` — Enter on `<textarea>` does not call correction `[NEG]`
- [ ] `tests/unit/enterKey.test.js:does not trigger when target is button` — Enter on `<button>` does not call correction `[NEG]`
- [ ] `tests/unit/enterKey.test.js:does not trigger on other keys` — dispatching Space, Escape, etc. does not call correction `[ECP]`

#### Feature 2: Corner Zoom Drag — Coordinate Conversion

**Happy path:**
- [ ] `tests/unit/cornerZoomDrag.test.js:converts center of zoom canvas to current point position` — mouse at (75,75) → point stays at same position `[HAPPY]`
- [ ] `tests/unit/cornerZoomDrag.test.js:converts offset from center to correct canvas delta` — mouse at (85,75) → point.x increases by (10 * regionSize / 150) `[HAPPY]`

**Boundary value analysis:**
- [ ] `tests/unit/cornerZoomDrag.test.js:dragging to zoom canvas edge (0,0)` — point moves to minimum offset `[BVA]`
- [ ] `tests/unit/cornerZoomDrag.test.js:dragging to zoom canvas edge (150,150)` — point moves to maximum offset `[BVA]`
- [ ] `tests/unit/cornerZoomDrag.test.js:result clamped to canvas bounds (0)` — point.x doesn't go below 0 `[BVA]`
- [ ] `tests/unit/cornerZoomDrag.test.js:result clamped to canvas bounds (max)` — point.x doesn't exceed sourceCanvas.width `[BVA]`

**Equivalence class partitioning:**
- [ ] `tests/unit/cornerZoomDrag.test.js:displayScale=1 conversion` — standard scale `[ECP]`
- [ ] `tests/unit/cornerZoomDrag.test.js:displayScale=2.5 conversion` — high-res image `[ECP]`
- [ ] `tests/unit/cornerZoomDrag.test.js:displayScale=0.5 conversion` — small image `[ECP]`

#### Feature 2: Corner Zoom Drag — State Transitions

**State transitions:**
- [ ] `tests/unit/cornerZoomDrag.test.js:mousedown in move mode with assigned point starts drag` — sets cornerDragState, selectedPointIndex, isDragging `[ST]`
- [ ] `tests/unit/cornerZoomDrag.test.js:mousedown in add mode does nothing` — cornerDragState stays null `[ST]`
- [ ] `tests/unit/cornerZoomDrag.test.js:mousedown in delete mode does nothing` — cornerDragState stays null `[ST]`
- [ ] `tests/unit/cornerZoomDrag.test.js:mousedown on empty corner does nothing` — no point assigned `[ST]`
- [ ] `tests/unit/cornerZoomDrag.test.js:mouseup clears drag state` — cornerDragState becomes null, isDragging false `[ST]`
- [ ] `tests/unit/cornerZoomDrag.test.js:mouseleave clears drag state` — same as mouseup `[ST]`

#### Feature 2: Corner Zoom — Assignment with Index

**Happy path:**
- [ ] `tests/unit/cornerZoom.test.js:assignPointsToCorners returns point and index` — each entry has `.point` and `.index` `[HAPPY]`

**Regression — Affected Existing Functionality:**
- [ ] `tests/unit/cornerZoom.test.js` — all existing corner zoom tests still pass after assignment format change
- [ ] `tests/unit/drawPoints.test.js` — all existing draw tests still pass

### Integration Tests (middle of pyramid — component interactions):

**Happy path:**
- [ ] `tests/integration/cornerZoomDrag.test.js:drag in corner zoom updates point in points array` — full flow: set move mode, mousedown on corner, mousemove, verify point.x/y changed `[HAPPY]`
- [ ] `tests/integration/cornerZoomDrag.test.js:drag triggers drawPoints and updateAllCornerZooms` — verify canvas redraw calls `[HAPPY]`

**Negative / state:**
- [ ] `tests/integration/cornerZoomDrag.test.js:switching from move to add mode disables corner zoom pointer events` — pointer-events toggled correctly `[ST]`
- [ ] `tests/integration/cornerZoomDrag.test.js:Enter key fires correction when 4+ points set` — integration of keyboard listener with correction pipeline `[HAPPY]`

**Boundary:**
- [ ] `tests/integration/cornerZoomDrag.test.js:dragging point near image edge clamps correctly` — point stays within canvas bounds `[BVA]`

### End-to-End Tests (top of pyramid — critical user journeys):

- [ ] `tests/e2e/cornerZoomDrag.spec.js:drag point in corner zoom box updates main canvas` — add 4 points, switch to move mode, drag in corner zoom, verify point moved `[HAPPY]`
- [ ] `tests/e2e/cornerZoomDrag.spec.js:corner zoom boxes not interactive in add mode` — verify pointer-events:none when not in move mode `[NEG]`
- [ ] `tests/e2e/enterKey.spec.js:Enter key triggers apply correction` — add 4 points, press Enter, verify correction applied `[HAPPY]`

### Manual Testing Steps:
1. Load an image, add 4 points near corners
2. Switch to move mode
3. Hover over a corner zoom box — cursor should show "grab"
4. Click and drag inside the corner zoom — point should move smoothly with 3x precision
5. Verify the main canvas updates in real-time during drag
6. Verify mouse leaving the corner zoom box stops the drag
7. Switch to add mode — verify corner zooms are not interactive
8. Press Enter with 4+ points — verify correction applies
9. Press Enter with <4 points — verify error message appears

### Test Commands:
```bash
# Unit tests
npx vitest run tests/unit/enterKey.test.js tests/unit/cornerZoomDrag.test.js

# Integration tests
npx vitest run tests/integration/cornerZoomDrag.test.js

# E2E tests
npx playwright test tests/e2e/cornerZoomDrag.spec.js tests/e2e/enterKey.spec.js

# Full suite (verify no regressions)
npm test && npx playwright test
```

## Performance Considerations

- During corner zoom drag, `drawPoints()` is called on every `mousemove` — same as main canvas drag, already optimized
- The coordinate conversion is trivial arithmetic (no performance concern)
- No additional DOM elements or canvases created

## References

- Current corner zoom implementation: `script.js:462-609`
- Point dragging on main canvas: `script.js:291-353`
- Corner zoom CSS: `styles.css:250-265`
