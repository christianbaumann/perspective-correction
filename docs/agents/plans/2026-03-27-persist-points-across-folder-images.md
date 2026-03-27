---
date: 2026-03-27T05:46:57.596484+00:00
git_commit: ee3cc6afa28008568d235af2494dcabe0d7ef1ab
branch: main
topic: "Persist selected points across folder-browser image navigation"
tags: [plan, points, folder-browser, persistence]
status: draft
---

# Persist Points Across Folder-Browser Image Navigation

## Overview

When working in folder-browser mode, users often correct a batch of similarly-framed documents. Currently, all points are cleared when the next image loads after applying a correction. This plan adds point persistence so that after applying corrections, the next folder image loads with the previous points pre-placed — scaled to the new image's dimensions.

## Current State Analysis

### Key Discoveries:
- `points` array holds absolute canvas coordinates (pixel values at original image resolution) — `script.js:30`
- `setupCanvas()` clears `points = []` at line 187, called whenever any image loads
- `resetAllPoints()` clears `points = []` at line 392, also called on new image load
- `applyPerspectiveCorrection()` at line 352 never touches the `points` array — it passes a sorted copy to the transform functions
- Both `applySimplePerspective` and `applyComplexPerspective` set `pointsCanvas.style.pointerEvents = 'none'` after correction
- Folder-browser is NOT wired up in the current working copy of `script.js` — `folderBrowser.js` exists as an untracked module, HTML elements exist but are hidden
- The committed version of `script.js` (ee3cc6a) contains folder-browser integration inline with `selectFolderImage()`, `handleOpenFolder()`, `handleSaveToOut()` functions

### Prerequisite:
The working copy of `script.js` must have folder-browser wired up for this feature to function. The committed version already has it. This plan assumes the folder-browser integration exists (as in the committed version) and adds point persistence on top.

## Desired End State

After applying a correction in folder-browser mode:
1. The corrected image is saved to `out/`
2. The next image in the folder loads automatically
3. The points from the previous image appear on the new image, scaled proportionally to the new image's dimensions
4. The user can adjust these restored points before applying correction again
5. Clicking "Reset All Points" clears both the active points and the saved points, so the next image starts fresh

### Verification:
- Open a folder with 3+ images of different resolutions
- Place 4 points on the first image, click "Apply Correction"
- The second image loads with 4 points at proportionally equivalent positions
- The point counter shows 4, the "Apply Correction" button is enabled
- Click "Reset All Points" — points clear; navigate to next image — no points appear

## What We're NOT Doing

- Persisting points to localStorage or across page reloads
- Restoring points on manual image upload (file picker / clipboard paste)
- Changing the correction pipeline or transform logic
- Adding UI for explicit "save points" / "load points" actions
- Wiring up folder-browser integration (treated as prerequisite)

## Implementation Approach

Store a normalized (0-1 range) copy of the points whenever a correction is applied in folder-browser mode. When the next folder image loads, scale the normalized points to the new canvas dimensions. Two pure helper functions (`normalizePoints`, `denormalizePoints`) keep the logic testable in isolation.

## Phase 1: Extract Normalization Helpers

### Overview
Add two pure functions to `helpers.js` for converting between absolute canvas coordinates and normalized 0-1 coordinates.

### Changes Required:

#### [x] 1. Add `normalizePoints` and `denormalizePoints` to `helpers.js`
**File**: `helpers.js`
**Changes**: Append two exported functions

```js
export function normalizePoints(points, width, height) {
    return points.map(p => ({
        x: p.x / width,
        y: p.y / height
    }));
}

export function denormalizePoints(normalizedPoints, width, height) {
    return normalizedPoints.map(p => ({
        x: p.x * width,
        y: p.y * height
    }));
}
```

### Success Criteria:

#### Automated Verification:
- [x] Existing tests still pass: `npm run test`
- [x] New unit tests pass (see Phase 3)

#### Manual Verification:
- [x] N/A — pure functions, fully covered by automated tests

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Add Point Persistence Logic to `script.js`

### Overview
Add state variable, save normalized points on correction (folder-browser mode only), restore on next folder image load, clear on reset.

### Changes Required:

#### [x] 1. Add state variable
**File**: `script.js`
**Changes**: Add after the existing state variables (around line 36)

```js
let savedNormalizedPoints = null; // Normalized points (0-1) for reuse across folder images
```

#### [x] 2. Import normalization helpers
**File**: `script.js`
**Changes**: Update the existing import from `helpers.js` (line 1)

```js
import { orderPoints, getCanvasCoordinates as getCoords, normalizePoints, denormalizePoints } from './helpers.js';
```

#### [x] 3. Save normalized points after successful correction in folder-browser mode
**File**: `script.js`
**Changes**: In `applyPerspectiveCorrection()`, before the `handleSaveToOut()` call inside the `if (folderHandle ...)` block (committed version around line 392)

```js
// Save normalized points for reuse on next folder image
if (folderHandle && currentFolderImageIndex >= 0) {
    savedNormalizedPoints = normalizePoints(points, sourceCanvas.width, sourceCanvas.height);
    handleSaveToOut();
}
```

#### [x] 4. Restore points when next folder image loads
**File**: `script.js`
**Changes**: In `selectFolderImage()`, inside the `img.onload` callback, after `setupCanvas()` and `resetAllPoints()` complete

```js
// Restore saved points from previous image (scaled to new image dimensions)
if (savedNormalizedPoints && savedNormalizedPoints.length > 0) {
    points = denormalizePoints(savedNormalizedPoints, sourceCanvas.width, sourceCanvas.height);
    updatePointCount();
    drawPoints();
}
```

#### [x] 5. Clear saved points in `resetAllPoints()`
**File**: `script.js`
**Changes**: Add at the beginning of `resetAllPoints()`, after `points = [];`

```js
savedNormalizedPoints = null;
```

### Success Criteria:

#### Automated Verification:
- [x] All existing tests pass: `npm run test`
- [x] New integration and e2e tests pass (Phases 3-5)

#### Manual Verification:
- [ ] Open a folder with 2+ images, place 4 points, apply correction — next image shows 4 points at proportional positions
- [ ] Points counter shows correct count after restore
- [ ] "Apply Correction" button is enabled after restore (4+ points)
- [ ] Restored points can be moved/deleted before re-applying
- [ ] "Reset All Points" clears points; next image loads with no points
- [ ] Manual image upload does NOT restore saved points

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Unit Tests

### Overview
Unit tests for the two pure normalization helper functions.

### Changes Required:

#### [x] 1. Create unit test file for normalization helpers
**File**: `tests/unit/pointNormalization.test.js`

```js
import { describe, it, expect } from 'vitest';
import { normalizePoints, denormalizePoints } from '../../helpers.js';

describe('normalizePoints()', () => {
    // tests listed in Testing Strategy below
});

describe('denormalizePoints()', () => {
    // tests listed in Testing Strategy below
});
```

### Success Criteria:

#### Automated Verification:
- [x] `npm run test` — all unit tests pass including new file

---

## Phase 4: Integration Tests

### Overview
Integration tests verifying the save/restore flow using DOM mocks, following the patterns in the existing `scriptDom.test.js`.

### Changes Required:

#### [x] 1. Create integration test file
**File**: `tests/integration/pointPersistence.test.js`

Tests the full state cycle: set points → apply correction → simulate new image load → verify points restored. Uses jsdom with mocked canvas and state variables.

### Success Criteria:

#### Automated Verification:
- [x] `npm run test` — all integration tests pass including new file

---

## Phase 5: E2E Test

### Overview
Playwright test verifying the user-visible behavior: points appear on the next image after correction in folder-browser mode.

### Changes Required:

#### [x] 1. Add e2e test to existing file
**File**: `tests/e2e/folderBrowser.spec.js`
**Changes**: Add new test case(s) using the existing `mockFS` and `applyCorrection` helpers.

### Success Criteria:

#### Automated Verification:
- [x] `npm run test:e2e` — all e2e tests pass including new cases

#### Manual Verification:
- [ ] Visual confirmation that restored points appear at correct positions in the browser (pending user verification)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Testing Strategy

Follow the test pyramid: many unit tests at the base, fewer integration tests in the middle, fewest e2e tests at the top.

### Test Design Techniques Applied

- **Equivalence class partitioning (ECP)**: Points at different canvas regions (center, edges, corners); different image resolutions (square, landscape, portrait)
- **Boundary value analysis (BVA)**: Points at (0,0), at (width,height), at (width-1,height-1); single point, 4 points, many points; width/height of 1 pixel
- **State transition testing (ST)**: `savedNormalizedPoints` transitions: null → populated → null (reset); null → stays null (manual upload)
- **Error guessing (ERR)**: Empty points array, zero-dimension canvas, very large coordinates

### Unit Tests (base of pyramid — fast, isolated, exhaustive):

#### `normalizePoints()`

**Happy path:**
- [x] `pointNormalization.test.js: normalizes 4 points on a 1000x500 canvas to 0-1 range` — input `[{x:500,y:250}]` on 1000x500 → `[{x:0.5,y:0.5}]` `[HAPPY]`
- [x] `pointNormalization.test.js: normalizes multiple points preserving order` — 4 points in, 4 normalized points out in same order `[HAPPY]`

**Edge cases and boundary values:**
- [x] `pointNormalization.test.js: point at origin (0,0) normalizes to (0,0)` — `[BVA]`
- [x] `pointNormalization.test.js: point at (width,height) normalizes to (1,1)` — `[BVA]`
- [x] `pointNormalization.test.js: point at (width-1,height-1) normalizes to near 1` — `[BVA]`
- [x] `pointNormalization.test.js: single point array` — array of length 1 `[BVA]`
- [x] `pointNormalization.test.js: empty points array returns empty array` — `[BVA]`
- [x] `pointNormalization.test.js: 1x1 canvas — point at (0,0) normalizes to (0,0)` — `[BVA]`
- [x] `pointNormalization.test.js: large canvas (10000x8000) produces correct ratios` — `[ECP]`
- [x] `pointNormalization.test.js: non-integer point coordinates normalize correctly` — e.g. {x:333.7, y:166.3} on 1000x500 `[ECP]`

#### `denormalizePoints()`

**Happy path:**
- [x] `pointNormalization.test.js: denormalizes (0.5, 0.5) on 1000x500 to (500, 250)` — `[HAPPY]`
- [x] `pointNormalization.test.js: denormalizes multiple points preserving order` — `[HAPPY]`

**Edge cases and boundary values:**
- [x] `pointNormalization.test.js: (0,0) stays (0,0) on any canvas` — `[BVA]`
- [x] `pointNormalization.test.js: (1,1) maps to (width,height)` — `[BVA]`
- [x] `pointNormalization.test.js: empty array returns empty array` — `[BVA]`
- [x] `pointNormalization.test.js: single point array` — `[BVA]`
- [x] `pointNormalization.test.js: 1x1 canvas — (0,0) stays (0,0)` — `[BVA]`
- [x] `pointNormalization.test.js: large target canvas (10000x8000) produces correct absolute coords` — `[ECP]`

#### Round-trip (normalize then denormalize)

- [x] `pointNormalization.test.js: round-trip same dimensions — points unchanged` — normalize on 800x600, denormalize on 800x600, expect original values `[HAPPY]`
- [x] `pointNormalization.test.js: round-trip different dimensions — points scale proportionally` — normalize on 800x600, denormalize on 1600x1200, expect doubled values `[HAPPY]`
- [x] `pointNormalization.test.js: round-trip landscape to portrait — x and y scale independently` — normalize on 1000x500, denormalize on 500x1000 `[ECP]`
- [x] `pointNormalization.test.js: round-trip to smaller canvas — points scale down` — normalize on 2000x1000, denormalize on 400x200 `[ECP]`

#### Regression — Affected Existing Functionality:
- [x] `tests/unit/folderBrowser.test.js` — verify all existing tests still pass (module not changed but related flow affected)
- [x] `tests/integration/scriptDom.test.js` — verify all existing tests still pass

### Integration Tests (middle of pyramid — component interactions):

#### `tests/integration/pointPersistence.test.js`

**Happy path:**
- [x] `savedNormalizedPoints is populated after applyPerspectiveCorrection in folder mode` — mock the correction flow in folder-browser mode, verify `savedNormalizedPoints` contains normalized copies of the original points `[HAPPY]`
- [x] `points restored on next folder image load with correct scaling` — set savedNormalizedPoints, simulate selectFolderImage → setupCanvas → resetAllPoints → restore logic, verify points array has scaled values `[HAPPY]`
- [x] `point count updates and drawPoints called after restore` — verify `updatePointCount()` and `drawPoints()` are called `[HAPPY]`

**Negative / state transitions:**
- [x] `resetAllPoints clears savedNormalizedPoints` — set savedNormalizedPoints to non-null, call resetAllPoints, verify it's null `[ST]`
- [x] `manual upload does NOT restore saved points` — set savedNormalizedPoints, simulate handleImageUpload flow, verify points array is empty `[ST]`
- [x] `savedNormalizedPoints stays null when correction applied outside folder mode` — apply correction without folderHandle set, verify savedNormalizedPoints remains null `[ST]`
- [x] `paste does NOT restore saved points` — set savedNormalizedPoints, simulate paste flow, verify points array is empty `[ST]`

**Boundary / edge:**
- [x] `restore works when previous and next images have different resolutions` — save from 800x600, restore to 1600x1200, verify point coordinates doubled `[BVA]`
- [x] `restore works when next image is smaller than previous` — save from 2000x1000, restore to 500x250 `[BVA]`
- [x] `restore with exactly 4 points enables transformBtn` — verify button disabled state is false `[BVA]`

### End-to-End Tests (top of pyramid — critical user journeys):

#### `tests/e2e/folderBrowser.spec.js`

- [x] `correct → auto-advance → points restored on next image` — open folder with 2 images, place 4 points on first, apply correction, verify pointCount shows "4" on second image and points canvas has drawn content `[HAPPY]`
- [x] `reset clears saved points — next image has no points` — open folder, place points, apply correction (points saved), click "Reset All Points", navigate to next image, verify pointCount shows "0" `[NEG]`

### Manual Testing Steps:
1. Open a folder with 3 images of different resolutions (e.g., 800x600, 1600x1200, 500x500)
2. Place 4 points forming a quadrilateral on the first image
3. Click "Apply Correction" — verify auto-save and auto-advance to second image
4. Verify 4 points appear on the second image at proportionally correct positions
5. Move one point slightly, apply correction — verify auto-advance to third image with the *updated* points
6. Click "Reset All Points" on the third image — points disappear
7. Upload a new image via file picker — verify no points are restored
8. Navigate back in folder browser — verify no points restored (since reset cleared them)

### Test Commands:
```bash
# Unit tests (scoped)
npx vitest run tests/unit/pointNormalization.test.js

# Integration tests (scoped)
npx vitest run tests/integration/pointPersistence.test.js

# All Vitest tests
npm run test

# E2E tests
npm run test:e2e

# Full suite (verify no regressions)
npm run test:all
```

## Performance Considerations

Normalization and denormalization are O(n) where n is the number of points (typically 4-8). No performance impact.

## Migration Notes

None. No data persistence, no breaking changes. Feature is additive.

## References

- [Research: How selected points behave on Apply Corrections](../research/2026-03-27-points-behavior-on-apply-corrections.md)
- Existing test patterns: `tests/unit/folderBrowser.test.js`, `tests/integration/scriptDom.test.js`, `tests/e2e/folderBrowser.spec.js`
