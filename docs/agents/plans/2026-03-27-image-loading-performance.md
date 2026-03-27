---
date: 2026-03-27T16:53:33Z
git_commit: dd6052da
branch: fix/delete-points-not-working
topic: "Image loading performance & memory optimization"
tags: [plan, performance, memory, script.js, index.html]
status: done
---

# Image Loading Performance & Memory Optimization

## Overview

After editing several images (especially via folder browser), loading new images becomes progressively slower. Large allocations (48MB+ each) accumulate because cleanup is deferred, data URLs bloat memory, and overlay canvases use unnecessarily high resolution. This plan addresses all memory retention issues identified in the research.

## Current State Analysis

Peak memory during correction of a single 4000×3000 image reaches **400+ MB**. Between images, the minimum retained is ~192 MB (two canvas buffers + `originalImageData`). During image transitions, old and new allocations briefly coexist, doubling pressure.

### Key Discoveries:
- `originalImageData` (48MB) is never nulled before `setupCanvas` creates a new one — `script.js:266`
- `transformedImageData` (temp canvas + pixel data) is freed in `resetAllPoints()` but that's called *after* `setupCanvas()` allocates new buffers — `script.js:854-855`
- `handleImageUpload` uses `reader.readAsDataURL()` (base64, 33% larger) — `script.js:210`. The folder browser path already uses the efficient `URL.createObjectURL` pattern — `script.js:848`
- Paste handler also uses `readAsDataURL` — `index.html:334`
- Grid `drawGrid()` calls `getImageData()` on the full source canvas (48MB) just to compute average brightness — `index.html:259`
- `pointsCanvas` is set to full image resolution (48MB buffer) but only draws thin crosshairs and lines — `script.js:240-241`

## Desired End State

- Image transitions release old memory **before** allocating new buffers
- No data URL strings held in memory for uploaded/pasted images
- Grid brightness computed from a tiny downscaled sample, not a full 48MB `getImageData`
- `pointsCanvas` uses display resolution (~1-2MB) instead of full image resolution (48MB)
- Peak memory per image reduced from ~400MB to ~250MB for a 4000×3000 photo
- Retained memory between images reduced from ~192MB to ~100MB

### How to verify:
- Open Chrome DevTools → Memory tab → take heap snapshots before/after loading 5+ images in folder browser mode
- Compare peak memory and retained memory against current baseline
- All existing tests pass, no visual regressions

## What We're NOT Doing

- Changing the 4-canvas architecture (source, grid, points, zoom)
- Reducing source canvas resolution (needed for output quality)
- Adding Web Workers or OffscreenCanvas
- Changing the correction pipeline algorithms (simple/complex perspective)
- Adding explicit `gc()` calls (not available in browsers)

## Implementation Approach

Four phases, each independently testable. Phases 1-2 are pure memory management with no visual changes. Phases 3-4 change rendering but should be visually identical.

---

## Phase 1: Eager Memory Cleanup During Image Transitions

### Overview
Null out large objects and clear canvas buffers **before** allocating new ones, reducing peak memory during transitions.

### Changes Required:

#### [x] 1. Add cleanup helper function
**File**: `script.js`
**Changes**: Add a `releaseImageMemory()` function that eagerly frees all large allocations.

```js
// Add near top of file, after state variable declarations (~line 78)
function releaseImageMemory() {
    originalImageData = null;
    transformedImageData = null;
    // Zero canvas backing stores to release GPU memory before resize
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    pointsCanvas.width = 0;
    pointsCanvas.height = 0;
}
```

#### [x] 2. Call cleanup before `setupCanvas` in `selectFolderImage`
**File**: `script.js`
**Changes**: In `selectFolderImage`, call `releaseImageMemory()` before loading the new image. Move `resetAllPoints()` before `setupCanvas()` won't work (it uses `originalImageData`), so use the new helper.

```js
// In selectFolderImage, img.onload handler (~line 850-855)
img.onload = function() {
    const pendingPoints = savedNormalizedPoints;
    releaseImageMemory();  // FREE old memory BEFORE allocating new
    image = img;
    setupCanvas();
    resetAllPoints();
    URL.revokeObjectURL(url);
    // ... rest unchanged
};
```

#### [x] 3. Call cleanup before `setupCanvas` in `handleImageUpload`
**File**: `script.js`
**Changes**: Same pattern in the upload handler.

```js
// In handleImageUpload, img.onload handler (~line 195-201)
img.onload = function() {
    releaseImageMemory();  // FREE old memory BEFORE allocating new
    image = img;
    setupCanvas();
    resetAllPoints();
    // ... rest unchanged
};
```

#### [x] 4. Call cleanup in `loadSampleImage` for consistency
**File**: `script.js`
**Changes**: In `loadSampleImage`, add cleanup before setup (minor — sample image is small, but keeps pattern consistent).

```js
// In loadSampleImage, sampleImage.onload (~line 170-176)
sampleImage.onload = function() {
    releaseImageMemory();
    image = sampleImage;
    setupCanvas();
    // ... rest unchanged
};
```

#### [x] 5. Handle zero-dimension canvases in `resetAllPoints`
**File**: `script.js`
**Changes**: `resetAllPoints()` calls `sourceCtx.putImageData(originalImageData, 0, 0)` — after `releaseImageMemory()` nulls it, the existing `if (originalImageData)` guard already handles this. But `drawPoints()` (called from `resetAllPoints`) touches `pointsCanvas` which may have 0 dimensions between release and setup. Add a guard.

```js
// In drawPoints() (~line 703), add early return
function drawPoints() {
    if (!pointsCanvas.width || !pointsCanvas.height) return;
    // ... rest unchanged
}
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` passes
- [ ] `npx playwright test` passes

#### Manual Verification:
- [ ] Load 5+ images via folder browser — no errors in console
- [ ] Memory snapshot shows old `ImageData` freed before new one appears
- [ ] Reset button still restores original image correctly
- [ ] Grid overlay still works after image transitions

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Switch Data URLs to Object URLs

### Overview
Replace `FileReader.readAsDataURL` with `URL.createObjectURL` in `handleImageUpload` and the paste handler, eliminating ~33% overhead from base64 encoding.

### Changes Required:

#### [x] 1. Rewrite `handleImageUpload` to use object URLs
**File**: `script.js`
**Changes**: Replace the `FileReader` approach with direct `URL.createObjectURL`.

```js
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoading();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function() {
        releaseImageMemory();
        image = img;
        setupCanvas();
        resetAllPoints();
        URL.revokeObjectURL(url);
        hideLoading();
        statusMessage.textContent = `Image loaded (${img.naturalWidth}×${img.naturalHeight}px). Original resolution preserved. Select 4+ points.`;
        statusMessage.className = "status success";
    };
    img.onerror = function() {
        URL.revokeObjectURL(url);
        hideLoading();
        statusMessage.textContent = "Failed to load image.";
        statusMessage.className = "status error";
    };
    img.src = url;
}
```

#### [x] 2. Fix paste handler to use object URLs
**File**: `index.html`
**Changes**: The paste handler at line 316-338 creates a `FileReader` + `readAsDataURL` but ultimately just dispatches a change event on `imageInput`. Simplify: create a `File` from the blob and assign directly — no need for `FileReader` at all.

```js
document.addEventListener('paste', function(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            const blob = items[i].getAsFile();
            const file = new File([blob], 'pasted-image.png', { type: blob.type });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            const imageInput = document.getElementById('imageInput');
            imageInput.files = dataTransfer.files;
            imageInput.dispatchEvent(new Event('change', { bubbles: true }));
            break;
        }
    }
});
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` passes
- [ ] `npx playwright test` passes

#### Manual Verification:
- [ ] Upload image via file picker — loads correctly
- [ ] Paste image from clipboard — loads correctly
- [ ] Memory tab: no large base64 strings retained after image load
- [ ] Image quality unchanged (same resolution displayed)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Optimize Grid Brightness Calculation

### Overview
Replace the full-resolution `getImageData` call (48MB) with a tiny downscaled canvas sample (~1KB) to compute average brightness.

### Changes Required:

#### [x] 1. Rewrite brightness calculation in `drawGrid`
**File**: `index.html`
**Changes**: Instead of `sourceCtx.getImageData(0, 0, fullWidth, fullHeight)`, draw the source canvas into a tiny temporary canvas (e.g. 16×16) and sample that.

Replace lines 257-274 with:

```js
// Calculate average brightness using a tiny downscaled sample
const sampleSize = 16;
const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = sampleSize;
sampleCanvas.height = sampleSize;
const sampleCtx = sampleCanvas.getContext('2d');
sampleCtx.drawImage(sourceCanvas, 0, 0, sampleSize, sampleSize);
const sampleData = sampleCtx.getImageData(0, 0, sampleSize, sampleSize).data;

let totalBrightness = 0;
const pixelCount = sampleSize * sampleSize;
for (let i = 0; i < sampleData.length; i += 4) {
    totalBrightness += 0.299 * sampleData[i] + 0.587 * sampleData[i + 1] + 0.114 * sampleData[i + 2];
}
const avgBrightness = totalBrightness / pixelCount;
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` passes
- [ ] `npx playwright test` passes

#### Manual Verification:
- [ ] Grid overlay toggles correctly on light images (black grid)
- [ ] Grid overlay toggles correctly on dark images (white grid)
- [ ] No 48MB spike in memory timeline when toggling grid
- [ ] Grid color still adapts correctly after applying perspective correction

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Downscale `pointsCanvas` to Display Resolution

### Overview
The `pointsCanvas` only draws crosshairs, lines, and dots — vector graphics that look fine at display resolution. Reducing it from full image resolution (e.g. 4000×3000 = 48MB) to display resolution (e.g. 800×600 = ~2MB) saves ~46MB.

### Changes Required:

#### [x] 1. Set `pointsCanvas` to display dimensions in `setupCanvas`
**File**: `script.js`
**Changes**: Set `pointsCanvas` to display resolution instead of image resolution. Since it's CSS-positioned to match the source canvas, it will align perfectly.

```js
// In setupCanvas(), replace pointsCanvas dimension setting (~line 240-241)
// Before: pointsCanvas.width = imageWidth; pointsCanvas.height = imageHeight;
// After:
pointsCanvas.width = Math.round(displayWidth);
pointsCanvas.height = Math.round(displayHeight);
```

Also update CSS sizing — since canvas dimensions now match display size, no CSS scaling needed:
```js
// Remove or skip: pointsCanvas.style.width = displayWidth + 'px';
// Remove or skip: pointsCanvas.style.height = displayHeight + 'px';
// Keep position (left/top) unchanged
```

#### [x] 2. Update `drawPoints` to use display coordinates
**File**: `script.js`
**Changes**: Points are stored in image coordinates. `drawPoints()` currently draws directly in image coordinates (canvas is image-sized). Now it needs to scale down to display coordinates.

```js
function drawPoints() {
    if (!pointsCanvas.width || !pointsCanvas.height) return;
    pointsCtx.clearRect(0, 0, pointsCanvas.width, pointsCanvas.height);

    const lineWidth = 2;  // No longer needs displayScale multiplication
    const scale = 1 / displayScale;  // image coords → display coords

    if (points.length > 1) {
        pointsCtx.beginPath();
        pointsCtx.moveTo(points[0].x * scale, points[0].y * scale);
        for (let i = 1; i < points.length; i++) {
            pointsCtx.lineTo(points[i].x * scale, points[i].y * scale);
        }
        pointsCtx.strokeStyle = '#4dabf7';
        pointsCtx.lineWidth = lineWidth;
        pointsCtx.stroke();
    }

    if (points.length >= 3) {
        pointsCtx.beginPath();
        pointsCtx.moveTo(points[points.length - 1].x * scale, points[points.length - 1].y * scale);
        pointsCtx.lineTo(points[0].x * scale, points[0].y * scale);
        pointsCtx.strokeStyle = '#4dabf7';
        pointsCtx.lineWidth = lineWidth;
        pointsCtx.setLineDash([5, 5]);
        pointsCtx.stroke();
        pointsCtx.setLineDash([]);
    }

    for (let i = 0; i < points.length; i++) {
        const px = points[i].x * scale;
        const py = points[i].y * scale;
        const crosshairSize = 12;  // display pixels
        const centerDotRadius = 3;

        pointsCtx.strokeStyle = '#ffffff';
        pointsCtx.lineWidth = lineWidth;

        pointsCtx.beginPath();
        pointsCtx.moveTo(px - crosshairSize, py);
        pointsCtx.lineTo(px + crosshairSize, py);
        pointsCtx.stroke();

        pointsCtx.beginPath();
        pointsCtx.moveTo(px, py - crosshairSize);
        pointsCtx.lineTo(px, py + crosshairSize);
        pointsCtx.stroke();

        pointsCtx.beginPath();
        pointsCtx.arc(px, py, centerDotRadius, 0, Math.PI * 2);
        pointsCtx.fillStyle = (i === selectedPointIndex && isDragging) ? '#ff6b6b' : '#339af0';
        pointsCtx.fill();
    }

    updateAllCornerZooms();
}
```

#### [x] 3. Update `getCanvasCoordinates` — no change needed
The function already returns image coordinates (multiplies by `displayScale`). The points array stays in image coordinates. Hit detection in `handleCanvasMouseDown` compares in image coordinates. **No changes needed here.**

#### [x] 4. Verify correction pipeline compatibility
**Files**: `simplePerspectiveApply.js:39`, `complexPerspectiveApply.js:44`
**Check**: Both correction modules read `pointsCanvas.width` / `pointsCanvas.height` to size `getImageData` from `sourceCtx`. After this change, `pointsCanvas` dimensions differ from `sourceCanvas`. These must use `sourceCanvas.width/height` instead.

```js
// simplePerspectiveApply.js line 39 — currently:
// const srcImageData = sourceCtx.getImageData(0, 0, pointsCanvas.width, pointsCanvas.height);
// Change to:
const srcImageData = sourceCtx.getImageData(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height);
```

```js
// complexPerspectiveApply.js line 44-46 — currently:
// const srcImg = sourceCtx.getImageData(0, 0, pointsCanvas.width, pointsCanvas.height);
// Change to:
const srcImg = sourceCtx.getImageData(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height);
```

### Success Criteria:

#### Automated Verification:
- [ ] `npm test` passes
- [ ] `npx playwright test` passes

#### Manual Verification:
- [ ] Points render as crisp crosshairs (no blurriness from upscaling)
- [ ] Point hit detection still works — can click, drag, delete points
- [ ] Apply perspective correction with 4 points — correct result
- [ ] Apply perspective correction with 5+ points — correct result
- [ ] Download corrected image — full resolution output
- [ ] Corner zoom boxes still show correct zoomed content with point crosshairs
- [ ] Memory reduced by ~46MB per image (visible in heap snapshot)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Testing Strategy

### Test Design Techniques Applied

The changes are primarily memory management (no new user-facing logic), so testing focuses on **regression** — ensuring existing functionality is unbroken.

### Unit Tests (base of pyramid):

#### New Tests:

**`releaseImageMemory` function:**
- [ ] `tests/unit/memoryCleanup.test.js` — `releaseImageMemory` nulls `originalImageData` and `transformedImageData` `[HAPPY]`
- [ ] `tests/unit/memoryCleanup.test.js` — `releaseImageMemory` sets canvas dimensions to 0 `[HAPPY]`
- [ ] `tests/unit/memoryCleanup.test.js` — `releaseImageMemory` is safe to call when variables are already null `[NEG]`
- [ ] `tests/unit/memoryCleanup.test.js` — `drawPoints` returns early when canvas has zero dimensions `[BVA]`

**Grid brightness sampling:**
- [ ] `tests/unit/gridBrightness.test.js` — dark image produces white grid color `[ECP]`
- [ ] `tests/unit/gridBrightness.test.js` — light image produces black grid color `[ECP]`
- [ ] `tests/unit/gridBrightness.test.js` — mid-brightness (128) boundary produces correct color `[BVA]`

**Points canvas coordinate scaling:**
- [ ] `tests/unit/drawPoints.test.js` — points drawn at correct display coordinates (image coords / displayScale) `[HAPPY]`
- [ ] `tests/unit/drawPoints.test.js` — crosshair size is constant in display pixels regardless of displayScale `[ECP]`

#### Regression — Affected Existing Functionality:
- [ ] `tests/unit/deletePoint.test.js` — all existing tests still pass (hit detection unchanged)
- [ ] `tests/unit/drawPoints.test.js` — existing rendering tests may need coordinate updates for display-space
- [ ] `tests/unit/cornerZoom.test.js` — corner zoom assignment unaffected
- [ ] `tests/unit/zoomPreview.test.js` — zoom preview reads from sourceCanvas, unaffected
- [ ] `tests/unit/folderBrowser.test.js` — all existing tests still pass

### Integration Tests (middle of pyramid):

- [ ] `tests/integration/pointPersistence.test.js` — points persist correctly across image loads with memory cleanup `[HAPPY]`
- [ ] `tests/integration/scriptDom.test.js` — DOM state correct after image transitions `[HAPPY]`
- [ ] `tests/integration/folderBrowserPipeline.test.js` — auto-save + advance works with eager cleanup `[HAPPY]`

### End-to-End Tests (top of pyramid):

- [ ] `tests/e2e/crosshairAndZoom.spec.js` — crosshairs visible and zoom preview works `[HAPPY]`
- [ ] `tests/e2e/folderBrowser.spec.js` — folder browser save + advance flow `[HAPPY]`
- [ ] `tests/e2e/deletePoints.spec.js` — delete points still works `[HAPPY]`
- [ ] `tests/e2e/cornerZoom.spec.js` — corner zoom boxes render correctly `[HAPPY]`

### Manual Testing Steps:
1. Open folder with 10+ large images (4000×3000+), process 5+ images — observe no progressive slowdown
2. Compare Chrome DevTools memory timeline before/after this change
3. Verify grid color adapts correctly on dark vs light images
4. Verify point crosshairs look crisp (not blurry from canvas upscaling)
5. Paste image from clipboard — verify it loads and processes correctly

### Test Commands:
```bash
# Unit + integration tests
npm test

# E2E tests
npx playwright test

# Full suite
npm run test:all
```

## Performance Considerations

### Expected memory savings (4000×3000 image):

| Allocation | Before | After | Savings |
|-----------|--------|-------|---------|
| `pointsCanvas` buffer | 48 MB | ~2 MB | **46 MB** |
| `originalImageData` overlap during transition | 48 MB (brief) | 0 MB | **48 MB peak** |
| `transformedImageData` overlap during transition | 48 MB (brief) | 0 MB | **48 MB peak** |
| Grid `getImageData` | 48 MB (brief) | ~1 KB | **48 MB peak** |
| Data URL string (upload) | ~6.7 MB | 0 MB | **6.7 MB** |

**Estimated retained memory per image**: ~192 MB → ~100 MB
**Estimated peak during correction**: ~400 MB → ~250 MB
**Estimated peak during image transition**: ~300 MB → ~150 MB

## References

- [Research: Image Loading Performance](../research/2026-03-27-image-loading-performance.md)
- `script.js` — main orchestrator, all large allocations
- `simplePerspectiveApply.js` — uses `pointsCanvas.width/height` for `getImageData`
- `complexPerspectiveApply.js` — same pattern
- `index.html` — grid overlay inline script
