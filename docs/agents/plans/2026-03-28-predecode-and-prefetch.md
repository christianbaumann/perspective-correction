---
date: 2026-03-28T16:56:45+00:00
git_commit: cc1c03a
branch: fix/spinner-forever-on-image-load
topic: "Pre-decode with createImageBitmap and prefetch next image"
tags: [plan, performance, createImageBitmap, prefetch, folder-browser]
status: draft
---

# Pre-decode with createImageBitmap & Prefetch Next Image

## Overview

Replace the `new Image()` decode path in `selectFolderImage()` with `createImageBitmap(file)` for off-thread decoding in Chrome, and prefetch the next image while the user works on the current one. Combined, these should reduce perceived image-load time from ~4s to near-instant.

## Current State Analysis

`selectFolderImage()` (script.js:911-978) loads images via:
```
loadImageFile(handle) → File
URL.createObjectURL(file) → url
new Image(); img.src = url → decode on main thread (~4140ms for 2268×4032 PNG)
img.onload → releaseImageMemory() → setupCanvas() → resetAllPoints()
```

The `File` object from `loadImageFile()` is a `Blob` subclass — ideal for `createImageBitmap(file)` which decodes off the main thread in Chrome.

### Key Discoveries:
- `script.js:62` — `let image = null` global, used for `drawImage()`, dimension reads, and truthiness checks
- `script.js:238-307` — `setupCanvas()` uses `image.naturalWidth || image.width` and `drawImage(image, ...)` — both work identically with `ImageBitmap`
- `script.js:1012-1018` — `resetAllPoints()` uses `image` as fallback, but `originalImageData` is always set first by `setupCanvas()`, so the `ImageBitmap` path is safe
- `folderBrowser.js:34-36` — `loadImageFile()` returns a `File` (Blob subclass)
- `createImageBitmap()` returns `ImageBitmap` with `.width`/`.height` properties (equivalent to `naturalWidth`/`naturalHeight`)
- No `AbortController` support for `createImageBitmap()` — use generation counter for staleness

## Desired End State

1. Folder browser image loading uses `createImageBitmap(file)` instead of `new Image()` — decode happens off the main thread
2. After loading image N, the app automatically prefetches and decodes image N+1 in the background
3. When user advances to image N+1 (via save+auto-advance or click), the pre-decoded bitmap is used instantly
4. Stale prefetches are detected and discarded via generation counter
5. Memory is properly managed — old bitmaps are `.close()`'d

### Verification:
- Open folder with multiple large PNG images
- Load first image — should decode via `createImageBitmap` (check console for `[PERF]` logs)
- Apply correction → save → auto-advance — next image should load near-instantly
- Click a non-sequential image — should fall back to normal decode (prefetch miss)

## What We're NOT Doing

- **Two-resolution strategy** (display-res preview + deferred full-res): Would require significant refactoring of `setupCanvas()`, zoom preview, and correction pipeline. The prefetch approach achieves near-instant loading without this complexity.
- **Changing `handleImageUpload()`**: The file upload path uses `URL.createObjectURL()` + `new Image()`. It works fine for single-image uploads and doesn't benefit from prefetching.
- **Web Worker decode**: `createImageBitmap(file)` already decodes off-thread in Chrome. A worker adds complexity without benefit.
- **Resize during decode**: Full-resolution data is required for the correction pipeline and zoom previews.

## Implementation Approach

Two incremental phases:
1. Replace `new Image()` with `createImageBitmap()` in `selectFolderImage()` — simpler, self-contained change
2. Add prefetch logic on top — generation counter, cache hit detection, trigger after image load

Both changes are confined to `script.js` in the `selectFolderImage()` area.

---

## Phase 1: Replace Image Decode with createImageBitmap

### Overview
Refactor `selectFolderImage()` to use `createImageBitmap(file)` instead of `new Image()` + object URL. This moves image decoding off the main thread in Chrome.

### Changes Required:

#### [ ] 1. Refactor `selectFolderImage()` to use createImageBitmap
**File**: `script.js` (lines 911-978)
**Changes**: Replace the `new Image()` / `img.onload` / `img.src` pattern with `createImageBitmap(file)`. Remove object URL creation/revocation since we use the File directly.

```js
async function selectFolderImage(index) {
    currentFolderImageIndex = index;
    if (saveToOutBtn) saveToOutBtn.disabled = true;
    renderFolderImageList();

    showLoading();
    const tLoad = performance.now();
    try {
        const tFile = performance.now();
        const file = await loadImageFile(folderImages[index].handle);
        console.log(`[PERF]     loadImageFile: ${(performance.now() - tFile).toFixed(1)}ms (${(file.size/1024/1024).toFixed(1)} MB)`);

        const tDecode = performance.now();
        const bitmap = await createImageBitmap(file);
        console.log(`[PERF]     createImageBitmap: ${(performance.now() - tDecode).toFixed(1)}ms (${bitmap.width}×${bitmap.height})`);

        // Save pending points before reset clears them
        const pendingPoints = savedNormalizedPoints;

        const tRelease = performance.now();
        releaseImageMemory();
        console.log(`[PERF]     releaseImageMemory: ${(performance.now() - tRelease).toFixed(1)}ms`);

        image = bitmap;

        const tSetup = performance.now();
        setupCanvas();
        console.log(`[PERF]     setupCanvas: ${(performance.now() - tSetup).toFixed(1)}ms`);

        const tReset = performance.now();
        resetAllPoints();
        console.log(`[PERF]     resetAllPoints: ${(performance.now() - tReset).toFixed(1)}ms`);

        // Restore saved points from previous image (scaled to new dimensions)
        if (pendingPoints && pendingPoints.length > 0) {
            savedNormalizedPoints = pendingPoints;
            points = denormalizePoints(pendingPoints, sourceCanvas.width, sourceCanvas.height);
            updatePointCount();
            drawPoints();
        }

        hideLoading();
        console.log(`[PERF]     selectFolderImage total: ${(performance.now() - tLoad).toFixed(1)}ms`);
        statusMessage.textContent = `Loaded ${folderImages[index].name} (${bitmap.width}×${bitmap.height}px)`;
        statusMessage.className = 'status success';
    } catch (err) {
        console.error('[BUG-DEBUG] Error in selectFolderImage:', err);
        hideLoading();
        statusMessage.textContent = `Error loading image: ${err.message}`;
        statusMessage.className = 'status error';
    }
}
```

**Key differences from current code**:
- No `URL.createObjectURL()` / `URL.revokeObjectURL()` — `createImageBitmap` takes the File directly
- No callback nesting (`img.onload`) — uses `await` for clean async flow
- `bitmap.width`/`bitmap.height` instead of `img.naturalWidth`/`img.naturalHeight`
- The `image` global receives an `ImageBitmap` instead of `HTMLImageElement`

#### [ ] 2. Verify `setupCanvas()` compatibility with ImageBitmap
**File**: `script.js` (lines 238-307)
**Changes**: `setupCanvas()` uses `image.naturalWidth || image.width` (line 246-247). `ImageBitmap` has `.width`/`.height` but not `.naturalWidth`/`.naturalHeight`. The `||` fallback means it already works — `naturalWidth` is `undefined`, so `image.width` is used. No code change needed, but add a comment for clarity.

```js
// Get original image dimensions (works for both HTMLImageElement and ImageBitmap)
const imageWidth = image.naturalWidth || image.width;
const imageHeight = image.naturalHeight || image.height;
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `npm test`
- [ ] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [ ] Open folder with large PNG images — images load via `createImageBitmap` (check console `[PERF]` logs show `createImageBitmap` instead of `img decode`)
- [ ] Image displays correctly at full resolution on sourceCanvas
- [ ] Zoom preview works correctly
- [ ] Point placement, movement, deletion all work
- [ ] Correction (Apply Perspective) produces correct result
- [ ] Save to out/ works
- [ ] Auto-advance loads next image correctly
- [ ] Reset All Points restores original image correctly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Add Next-Image Prefetching

### Overview
After loading image N, automatically start decoding image N+1 in the background. When the user advances, use the pre-decoded bitmap if available.

### Changes Required:

#### [ ] 1. Add prefetch state variables
**File**: `script.js` (near line 74, after folder browser state)
**Changes**: Add state for tracking prefetched bitmaps.

```js
// Prefetch state
let prefetchGeneration = 0;
let prefetchedBitmap = null;
let prefetchedIndex = -1;
```

#### [ ] 2. Add prefetch function
**File**: `script.js` (after the new state variables)
**Changes**: Add `prefetchNextImage()` that decodes the next image in the background.

```js
async function prefetchNextImage(nextIndex) {
    const gen = ++prefetchGeneration;
    try {
        const tPrefetch = performance.now();
        const file = await folderImages[nextIndex].handle.getFile();
        const bitmap = await createImageBitmap(file);
        if (gen !== prefetchGeneration) {
            bitmap.close(); // stale, discard
            return;
        }
        if (prefetchedBitmap) prefetchedBitmap.close();
        prefetchedBitmap = bitmap;
        prefetchedIndex = nextIndex;
        console.log(`[PERF]     prefetch image ${nextIndex}: ${(performance.now() - tPrefetch).toFixed(1)}ms (${bitmap.width}×${bitmap.height})`);
    } catch (e) {
        console.warn('Prefetch failed:', e);
    }
}
```

#### [ ] 3. Use prefetched bitmap in selectFolderImage
**File**: `script.js` — in `selectFolderImage()`
**Changes**: Before decoding, check if we have a prefetched bitmap for the requested index. If so, use it directly and skip the decode step.

```js
// Inside selectFolderImage, after loadImageFile:
let bitmap;
if (prefetchedBitmap && prefetchedIndex === index) {
    bitmap = prefetchedBitmap;
    prefetchedBitmap = null;
    prefetchedIndex = -1;
    console.log(`[PERF]     prefetch HIT for index ${index}`);
} else {
    // Invalidate stale prefetch
    prefetchGeneration++;
    if (prefetchedBitmap) {
        prefetchedBitmap.close();
        prefetchedBitmap = null;
        prefetchedIndex = -1;
    }
    const tDecode = performance.now();
    bitmap = await createImageBitmap(file);
    console.log(`[PERF]     createImageBitmap: ${(performance.now() - tDecode).toFixed(1)}ms (${bitmap.width}×${bitmap.height})`);
}
```

#### [ ] 4. Trigger prefetch after image load
**File**: `script.js` — at the end of `selectFolderImage()`, after `hideLoading()`
**Changes**: Start prefetching the next image.

```js
// Prefetch next image
const nextIdx = getNextImageIndex(index, folderImages.length);
if (nextIdx !== index) {  // Don't prefetch same image (single-image folder)
    prefetchNextImage(nextIdx);
}
```

#### [ ] 5. Clean up prefetch state on folder change / image upload
**File**: `script.js`
**Changes**: When the user opens a new folder or uploads a single image, invalidate the prefetch cache. Add cleanup to `releaseImageMemory()`.

```js
function releaseImageMemory() {
    originalImageData = null;
    transformedImageData = null;
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    pointsCanvas.width = 0;
    pointsCanvas.height = 0;
    // Clean up prefetch
    if (prefetchedBitmap) {
        prefetchedBitmap.close();
        prefetchedBitmap = null;
        prefetchedIndex = -1;
    }
    prefetchGeneration++;
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `npm test`
- [ ] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [ ] Open folder with multiple large PNGs
- [ ] Load first image — console shows prefetch starting for next image
- [ ] Apply correction → save → auto-advance — console shows `prefetch HIT`, next image loads near-instantly
- [ ] Click a non-sequential image — console shows normal decode (prefetch miss), old prefetch discarded
- [ ] Open a different folder — no stale prefetch artifacts
- [ ] Single-image folder — no prefetch triggered (no self-prefetch)
- [ ] Memory: check DevTools Memory tab — no leaked ImageBitmaps accumulating

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Tests

### Overview
Add unit and e2e tests covering the new createImageBitmap and prefetch logic.

### Changes Required:

#### [ ] 1. Unit tests for prefetch logic
**File**: `tests/unit/prefetch.test.js` (new)

#### [ ] 2. Update e2e folder browser tests
**File**: `tests/e2e/folderBrowser.spec.js`

---

## Testing Strategy

Follow the test pyramid: many unit tests at the base, fewer integration tests in the middle, fewest e2e tests at the top.

### Test Design Techniques Applied

The prefetch system has these key inputs/states:
- `prefetchGeneration` (integer counter)
- `prefetchedBitmap` (null or ImageBitmap)
- `prefetchedIndex` (integer, -1 when empty)
- `folderImages` array (0, 1, or many items)
- `index` parameter to `selectFolderImage` (sequential, non-sequential, same as current)

### Unit Tests (base of pyramid):

**File**: `tests/unit/prefetch.test.js`

**Happy path:**
- [ ] `prefetchNextImage — decodes file and stores bitmap` — after prefetch, `prefetchedBitmap` is set with correct index `[HAPPY]`
- [ ] `selectFolderImage — uses prefetched bitmap on cache hit` — when `prefetchedIndex === index`, skips decode and uses cached bitmap `[HAPPY]`
- [ ] `selectFolderImage — triggers prefetch for next image after load` — after loading image N, prefetch starts for N+1 `[HAPPY]`

**Negative testing:**
- [ ] `prefetchNextImage — handles file read failure gracefully` — if `getFile()` throws, prefetch fails silently with console.warn `[NEG]`
- [ ] `prefetchNextImage — handles createImageBitmap failure` — if bitmap decode fails, no crash `[NEG]`
- [ ] `selectFolderImage — cache miss falls back to normal decode` — when `prefetchedIndex !== index`, decodes normally `[NEG]`

**Edge cases and boundary values:**
- [ ] `prefetchNextImage — discards stale result via generation counter` — if generation changes during decode, bitmap is `.close()`'d `[ST]`
- [ ] `prefetchNextImage — closes previous prefetched bitmap` — if a bitmap already exists when new prefetch completes, old one is closed `[ECP]`
- [ ] `selectFolderImage — invalidates prefetch on cache miss` — increments generation, closes old bitmap `[ST]`
- [ ] `selectFolderImage — no prefetch for single-image folder` — `nextIdx === index` guard prevents self-prefetch `[BVA]`
- [ ] `releaseImageMemory — cleans up prefetch state` — closes bitmap, resets index, increments generation `[ECP]`

#### Regression — Affected Existing Functionality:
- [ ] `tests/unit/folderBrowser.test.js` — verify all existing tests still pass (getNextImageIndex, deriveOutputFilename, etc.)
- [ ] `tests/integration/folderBrowserPipeline.test.js` — verify open→load→save pipeline still works

### Integration Tests (middle of pyramid):

**File**: `tests/integration/prefetchPipeline.test.js` (new)

**Happy path:**
- [ ] `folder image advance with prefetch hit` — load image 0, prefetch fires for image 1, advance to image 1 uses cached bitmap `[HAPPY]`

**Negative / error propagation:**
- [ ] `folder image jump skips prefetch` — load image 0, prefetch fires for 1, user clicks image 3, prefetch discarded `[NEG]`

**Boundary / edge:**
- [ ] `wrap-around prefetch` — on last image, prefetch targets index 0 `[BVA]`

### End-to-End Tests (top of pyramid):

**File**: `tests/e2e/folderBrowser.spec.js` (existing, add tests)

- [ ] `save → auto-advance uses prefetch for fast load` — open folder, apply correction, save, verify next image loads (check for prefetch HIT in console or fast load time) `[HAPPY]`
- [ ] `clicking non-sequential image still loads correctly` — open folder, click third image directly, verify it loads and displays `[NEG]`

### Manual Testing Steps:
1. Open folder with 5+ large PNG images (>2000px)
2. Load first image — verify `[PERF] createImageBitmap` in console (not `img decode`)
3. Wait 2s for prefetch — verify `[PERF] prefetch image 1` in console
4. Apply correction → save → auto-advance — verify `[PERF] prefetch HIT` and fast load
5. Click image 4 directly — verify normal decode (no HIT)
6. Check DevTools Memory tab — no growing ImageBitmap count

### Test Commands:
```bash
# Unit tests
npx vitest run tests/unit/prefetch.test.js

# Integration tests
npx vitest run tests/integration/prefetchPipeline.test.js

# E2E tests
npx playwright test tests/e2e/folderBrowser.spec.js

# Full suite (verify no regressions)
npm test && npx playwright test
```

## Performance Considerations

- **Memory**: Prefetching one full-res image adds ~35 MB (2268×4032 × 4 bytes RGBA). Current usage is ~110 MB, total ~145 MB — acceptable for desktop Chrome.
- **CPU**: `createImageBitmap(file)` decodes off main thread — no UI jank during prefetch.
- **Cancellation**: `createImageBitmap()` doesn't support `AbortController`. The generation counter ensures stale results are discarded, but the decode work can't be cancelled. This is acceptable since we only prefetch one image at a time.
- **`.close()` discipline**: Every `ImageBitmap` must be `.close()`'d when no longer needed. The plan ensures this via: (a) stale prefetch detection, (b) `releaseImageMemory()` cleanup, (c) cache miss invalidation.

## References

- [Research: Pre-decode & createImageBitmap](../research/2026-03-28-predecode-and-createimagebitmap.md)
- [MDN: createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/createImageBitmap)
- Current image loading: `script.js:911-978`
- setupCanvas: `script.js:238-307`
- releaseImageMemory: `script.js:81-89`
- folderBrowser loadImageFile: `folderBrowser.js:34-36`
