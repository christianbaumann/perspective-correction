---
date: 2026-03-27T11:50:29+00:00
git_commit: 7f77bbf6f442f441d3212284c433b58f23898e4c
branch: fix/delete-points-not-working
topic: "Fix Delete Points Mode"
tags: [plan, bug-fix, point-interaction, testing]
status: draft
---

# Fix Delete Points Mode — Implementation Plan

## Overview

Delete mode does not remove points when clicking on them. Add and move modes work correctly. The delete logic in `handleCanvasMouseDown` (`script.js:287-292`) appears structurally correct in static analysis — the bug needs to be surfaced by tests. Additionally, commit `242f79c` added zoomCanvas references to `script.js` without adding the corresponding HTML element or CSS, which needs to be committed.

## Current State Analysis

- `handleCanvasMouseDown` (`script.js:272-309`) handles all three modes in one handler
- Delete path: hit-test loop → `points.splice(i, 1)` → `updatePointCount()` → `drawPoints()` → return
- Move path uses identical hit detection and works
- Delete mode has **zero test coverage** at all levels (unit, integration, e2e)
- The `<canvas id="zoomCanvas">` element is missing from committed HTML (added as staged change)
- The `#zoomCanvas` CSS rule is missing from committed CSS (added as unstaged change)

### Key Discoveries:
- `script.js:287-292` — delete splice logic
- `script.js:280` — hit radius: `15 * displayScale`
- `script.js:37-38` — `zoomCanvas` obtained via `getElementById`, crashes if element missing
- `styles.css:214-217` — generic `canvas` rule: `position: absolute` (no pointer-events override)
- Delete test coverage: 0 unit, 0 integration, 0 e2e tests

## Desired End State

- Delete mode works: clicking a point in delete mode removes it
- Comprehensive test coverage for delete at all pyramid levels
- The zoomCanvas HTML element and CSS are properly committed
- CLAUDE.md updated with testing guidance

### Verification:
- `npm test` passes with new delete unit tests
- `npx playwright test` passes with new delete e2e tests
- Manual: load image, add 4 points, switch to delete mode, click a point — count decreases

## What We're NOT Doing

- Refactoring the mouse handler or mode system
- Adding touch event support
- Changing hit detection radius or UX
- Modifying other interaction modes (add/move)

## Implementation Approach

**Test-first:** Write e2e tests that exercise delete mode in the real browser. These tests will either pass (proving the logic works and the bug is environmental) or fail (revealing the exact failure mode). Then fix whatever the tests reveal. Unit tests provide regression coverage for the core logic.

## Phase 1: E2E Tests for Delete Mode

### Overview
Write Playwright e2e tests that exercise delete in a real browser. These are most likely to reveal the bug since delete is a browser interaction issue.

### Changes Required:

#### [x] 1. Add delete mode e2e tests
**File**: `tests/e2e/deletePoints.spec.js`
**Changes**: New test file exercising delete mode end-to-end

```javascript
// Pattern follows crosshairAndZoom.spec.js
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#statusMessage')).toContainText('Sample image loaded', { timeout: 5000 });
});

// Helper: add N points at known positions
async function addPoints(page, count) { /* click at percentage positions */ }

// Tests:
// - Add 4 points → delete mode → click point → count decreases to 3
// - Add 4 points → delete mode → click empty area → count stays 4
// - Add 4 points → delete all one by one → count reaches 0
// - Delete brings count below 4 → transform button disabled
// - Delete mode button shows active state
// - After delete, switching back to add mode → can add new points
```

### Success Criteria:

#### Automated Verification:
- [x] `npx playwright test tests/e2e/deletePoints.spec.js` — run the tests (6/6 passed)
- [x] Tests PASS — delete logic works in current working copy; bug is the uncommitted zoomCanvas HTML/CSS

#### Manual Verification:
- [x] Review test output to understand the exact failure mode — all tests pass, confirming Scenario A: missing zoomCanvas element/CSS in committed code

**Implementation Note**: After completing this phase, analyze test results. If tests fail, the failure output reveals the bug. If tests pass, the bug may be in the committed HTML/CSS (missing zoomCanvas). Pause for confirmation before proceeding.

---

## Phase 2: Unit Tests for Delete Logic

### Overview
Extract and test the mousedown handler's delete logic in isolation, following the pattern in `drawPoints.test.js` (reimplements module-scoped logic as a testable function).

### Changes Required:

#### [x] 1. Add delete logic unit tests
**File**: `tests/unit/deletePoint.test.js`
**Changes**: New test file with extracted delete/hit-detection logic

```javascript
// Reimplement the hit-test + delete logic from handleCanvasMouseDown
function handlePointInteraction(points, clickX, clickY, mode, displayScale) {
  const hitRadius = 15 * displayScale;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const distance = Math.sqrt((clickX - point.x) ** 2 + (clickY - point.y) ** 2);
    if (distance < hitRadius) {
      if (mode === 'delete') {
        points.splice(i, 1);
        return { action: 'deleted', index: i };
      } else if (mode === 'move') {
        return { action: 'move', index: i };
      }
    }
  }
  if (mode === 'add') {
    points.push({ x: clickX, y: clickY });
    return { action: 'added', index: points.length - 1 };
  }
  return { action: 'none' };
}

// Test cases (see Testing Strategy below)
```

### Success Criteria:

#### Automated Verification:
- [x] `npx vitest run tests/unit/deletePoint.test.js` passes (14/14)

#### Manual Verification:
- [x] Unit tests cover all equivalence classes for delete hit detection

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Fix the Bug

### Overview
Based on test results from Phases 1-2, fix the root cause. The exact fix depends on what the tests reveal.

### Likely Fix Scenarios:

#### [x] Scenario A: Missing zoomCanvas element causes script crash
If the e2e tests fail because the script doesn't initialize at all, the fix is to commit the already-staged HTML/CSS changes.

#### [ ] Scenario B: Event handling issue specific to delete mode
If the e2e tests show the handler fires but delete doesn't work, fix the handler logic.

#### [ ] Scenario C: CSS/pointer-events issue
If the zoomCanvas (without `pointer-events: none` CSS) is intercepting events in a specific area, the CSS fix resolves it.

### Changes Required:

#### [x] 1. Commit zoomCanvas HTML element
**File**: `index.html`
**Changes**: Already staged — `<canvas id="zoomCanvas"></canvas>` inside `.canvas-wrapper`

#### [x] 2. Commit zoomCanvas CSS
**File**: `styles.css`
**Changes**: Already modified — `#zoomCanvas` rule with `pointer-events: none`, `z-index: 4`

#### [x] 3. Fix any additional issue revealed by tests (none needed — Scenario A was the root cause)
**File**: `script.js` (if needed)
**Changes**: TBD based on test results

### Success Criteria:

#### Automated Verification:
- [x] `npm test` passes (122/122 unit + integration tests)
- [x] `npx playwright test` passes (22/22 e2e tests including new delete tests)

#### Manual Verification:
- [ ] Load page, add 4+ points, switch to delete mode, click a point — point is removed
- [ ] Point count decreases correctly
- [ ] Transform button disables when count drops below 4
- [ ] Can switch back to add mode and add new points after deleting

**Implementation Note**: After completing this phase, pause for manual verification.

---

## Phase 4: Update Documentation

### Changes Required:

#### [ ] 1. Update CLAUDE.md
**File**: `CLAUDE.md`
**Changes**: Add note about always writing tests for new/changed functionality

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` still passes
- [ ] `npx playwright test` still passes

---

## Testing Strategy

Follow the test pyramid: many unit tests at the base, fewer e2e tests at the top.

### Test Design Techniques Applied

For the `handleCanvasMouseDown` delete path, inputs are: click position (x, y), point positions, mode, displayScale.

- **Equivalence class partitioning**: click inside hit radius vs outside; delete mode vs other modes; 0 points vs 1 vs many
- **Boundary value analysis**: click exactly at hit radius boundary (distance = hitRadius - 1, hitRadius, hitRadius + 1)
- **State transition testing**: mode transitions (add → delete → add); point count transitions (4 → 3 → 0)
- **Error guessing**: click with no points; click after correction applied (pointer-events: none); delete last remaining point

### Unit Tests (base of pyramid — fast, isolated, exhaustive):

#### New Delete Logic:

**Happy path:**
- [ ] `deletePoint.test.js: deletes point when clicked within hit radius` — click at exact point position, verify splice `[HAPPY]`
- [ ] `deletePoint.test.js: deletes correct point from multiple` — 3 points, click near point[1], verify point[1] removed `[HAPPY]`

**Negative testing:**
- [ ] `deletePoint.test.js: no deletion when clicking empty area` — click far from all points, verify array unchanged `[NEG]`
- [ ] `deletePoint.test.js: no deletion in add mode even when clicking on point` — mode='add', click on point, verify point added not deleted `[NEG]`
- [ ] `deletePoint.test.js: no deletion in move mode` — mode='move', click on point, verify move action returned `[NEG]`
- [ ] `deletePoint.test.js: no deletion when points array is empty` — empty array, click anywhere, verify no crash `[NEG]`

**Edge cases and boundary values:**
- [ ] `deletePoint.test.js: click exactly at hit radius boundary (inside)` — distance = hitRadius - 0.1, verify deletion `[BVA]`
- [ ] `deletePoint.test.js: click exactly at hit radius boundary (outside)` — distance = hitRadius + 0.1, verify no deletion `[BVA]`
- [ ] `deletePoint.test.js: hit radius scales with displayScale=1` — hitRadius = 15, verify correct detection `[BVA]`
- [ ] `deletePoint.test.js: hit radius scales with displayScale=3` — hitRadius = 45, verify correct detection `[BVA]`
- [ ] `deletePoint.test.js: delete only first matching point when overlapping` — two points at same position, verify only first removed `[ECP]`
- [ ] `deletePoint.test.js: delete last point in array` — click on last point, verify correct removal `[ECP]`
- [ ] `deletePoint.test.js: delete first point in array` — click on first point, verify correct removal `[ECP]`

#### Regression — Affected Existing Functionality:
- [ ] `tests/unit/drawPoints.test.js` — verify still passes (rendering after deletion)
- [ ] `tests/unit/pointNormalization.test.js` — verify still passes

### End-to-End Tests (top of pyramid — critical user journeys):

**Happy path:**
- [ ] `deletePoints.spec.js: delete a point reduces count` — add 4, delete 1, verify count=3 `[HAPPY]`
- [ ] `deletePoints.spec.js: delete all points one by one` — add 4, delete each, verify count=0 `[HAPPY]`

**Negative / error journeys:**
- [ ] `deletePoints.spec.js: clicking empty area in delete mode does nothing` — verify count unchanged `[NEG]`
- [ ] `deletePoints.spec.js: delete mode button shows active state` — verify `.active` class `[ST]`

**State transitions:**
- [ ] `deletePoints.spec.js: transform button disables when count drops below 4` — add 4, delete 1, verify button disabled `[ST]`
- [ ] `deletePoints.spec.js: can add points after deleting` — delete then switch to add, verify new point added `[ST]`

### Manual Testing Steps:
1. Open app in browser, load an image
2. Add 4 points in add mode
3. Switch to delete mode (verify button highlights)
4. Click on a point — verify it disappears and count decreases
5. Switch back to add mode — verify new points can be added

### Test Commands:
```bash
# Unit tests (delete logic)
npx vitest run tests/unit/deletePoint.test.js

# All unit + integration tests
npm test

# E2E tests (delete mode)
npx playwright test tests/e2e/deletePoints.spec.js

# Full suite
npm run test:all
```

## Performance Considerations

None — this is a bug fix with no performance implications.

## References

- Research: `docs/agents/research/2026-03-27-delete-points-not-working.md`
- Delete logic: `script.js:272-309`
- Mode switching: `script.js:235-254`
- Existing test patterns: `tests/unit/drawPoints.test.js`, `tests/e2e/crosshairAndZoom.spec.js`
