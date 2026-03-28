---
date: 2026-03-28T15:01:57+00:00
git_commit: cc1c03a
branch: main
topic: "Image Processing Performance Optimization"
tags: [plan, performance, webgl, web-workers, canvas-api, wasm]
status: draft
---

# Image Processing Performance Optimization Plan

## Overview

The perspective correction pipeline runs entirely on the main thread with synchronous pixel-by-pixel JS loops. For a 4000×3000 image (12M pixels), the UI freezes for seconds. This plan fixes current bottlenecks first, then progressively introduces WebGL, Web Workers, and optionally Wasm for dramatic speedups.

## Current State Analysis

The correction pipeline has several performance issues:

1. **Per-pixel matrix inversion bug** (`complexPerspectiveApply.js:441-442`): `invertHomography(H_inv)` is called inside `applyConstrainedMapping()` for every pixel within influence range of a constraint. Since `H_inv` is already the inverse of `H`, inverting it again just gives `H` — but at the cost of a 3×3 matrix inversion per pixel per constraint.

2. **Missing canvas optimization hints**: `sourceCtx` (script.js:34) lacks `willReadFrequently: true` despite being used with `getImageData()`. `simplePerspectiveApply.js:37` temp context lacks `alpha: false`.

3. **Synchronous PNG encoding**: `download.js:32` uses `toDataURL("image/png")` which blocks the main thread.

4. **Per-pixel array allocation**: `bilinearSample()` (complexPerspectiveApply.js:673-678) returns a new `[r, g, b, 255]` array per pixel — ~12M array allocations per correction.

5. **All processing on main thread**: Both simple and complex paths block the UI entirely.

### Key Discoveries:
- `complexPerspectiveApply.js:42` already uses `{ alpha: false }` — good
- `download.js:19-22` already uses `{ alpha: false, willReadFrequently: false }` — good
- `simplePerspectiveApply.js:37` uses bare `getContext('2d')` — missing optimizations
- `script.js:34` uses bare `getContext('2d')` for `sourceCtx` — missing `willReadFrequently`
- `bilinearSample()` creates a new array per call (line 673) — can be eliminated by writing directly to the destination buffer
- Progress reporting in complex path (line 89-92) sets `statusMessage.textContent` but browser can't repaint since main thread is blocked

## Desired End State

After all phases:
- **4-point correction**: <10ms via WebGL GPU acceleration (currently 2-10 seconds)
- **5+ point correction**: runs in a Web Worker, UI stays responsive, ~3-4x faster with multi-worker parallelism
- **Download**: async PNG encoding via `toBlob()`, no UI freeze
- **Quick wins**: measurable improvement from canvas hints and bug fixes even without architectural changes

### Verification:
- Time corrections with `performance.now()` before and after
- UI should remain responsive (no "page unresponsive" warnings) during any correction
- All existing tests pass
- Visual output identical to current (pixel-level regression check)

## What We're NOT Doing

- Server-side offloading (breaks the "no server" privacy model)
- WebGPU (not universally supported yet)
- OpenCV.js (8MB is too heavy for this project)
- SharedArrayBuffer multi-worker parallelism (requires COOP/COEP headers, problematic for GitHub Pages)
- Bundler/build tools — project must remain plain HTML/CSS/JS with ES modules

## Implementation Approach

Tiered approach, from lowest effort to highest impact:
1. Fix bugs and add canvas hints (hours)
2. WebGL for 4-point path (days)
3. Web Worker for complex path (days)
4. Wasm for MVC download path (week, optional)

Each phase is independently valuable and shippable.

---

## Phase 1: Fix Current Bottlenecks (Canvas API Quick Wins)

### Overview
Fix the per-pixel `invertHomography` bug, add missing canvas optimization hints, replace synchronous `toDataURL` with async `toBlob`, and eliminate per-pixel array allocation in `bilinearSample`. These are low-risk, high-confidence changes.

### Changes Required:

#### [x] 1. Fix `invertHomography` per-pixel bug
**File**: `complexPerspectiveApply.js`
**Changes**: Precompute `H` (the forward homography) once before the pixel loop and pass it into `applyConstrainedMapping`, instead of calling `invertHomography(H_inv)` per pixel.

In `applyComplexPerspective()` (around line 60), `H` is already available:
```js
const H = computeHomography(cornerPts, dstCorners);
const H_inv = invertHomography(H);
```

Change `applyConstrainedMapping` call (line 73) to pass `H` as well:
```js
src = applyConstrainedMapping(x, y, H_inv, edgeConstraints, width, height, H);
```

Update `applyConstrainedMapping` signature (line 414) to accept `H`:
```js
function applyConstrainedMapping(x, y, H_inv, constraints, width, height, H) {
```

Replace line 441-442:
```js
// Before (per-pixel matrix inversion):
const constraintMapped = applyHomography(constraint.src.x, constraint.src.y,
                                        invertHomography(H_inv));

// After (use precomputed H):
const constraintMapped = applyHomography(constraint.src.x, constraint.src.y, H);
```

**Note**: Even better — `constraintMapped` only depends on `constraint.src` and `H`, both of which are constant across all pixels. These values can be precomputed once per constraint before the pixel loop. Add a precomputation step after line 60:

```js
// Precompute constraint mappings (constant across all pixels)
if (edgeConstraints) {
    for (const constraint of edgeConstraints) {
        const mapped = applyHomography(constraint.src.x, constraint.src.y, H);
        constraint._mappedX = mapped.x;
        constraint._mappedY = mapped.y;
        constraint._corrX = constraint.dst.x - mapped.x;
        constraint._corrY = constraint.dst.y - mapped.y;
    }
}
```

Then in `applyConstrainedMapping`, replace lines 441-446 with:
```js
const corrX = constraint._corrX;
const corrY = constraint._corrY;
```

This eliminates both the per-pixel matrix inversion AND the per-pixel homography application for constraints.

#### [x] 2. Eliminate per-pixel array allocation in `bilinearSample`
**File**: `complexPerspectiveApply.js`
**Changes**: Instead of returning `[r, g, b, 255]` (allocates a new array per pixel), write directly to the destination buffer.

Change the call site (lines 80-86) from:
```js
const rgba = bilinearSample(srcImg, src.x, src.y);
const i = (y * canvas.width + x) * 4;
dstImg.data[i]     = rgba[0];
dstImg.data[i + 1] = rgba[1];
dstImg.data[i + 2] = rgba[2];
dstImg.data[i + 3] = 255;
```

To a new function `bilinearSampleDirect(srcImg, srcX, srcY, dstData, dstIndex)` that writes directly:
```js
function bilinearSampleDirect(img, x, y, dst, di) {
    const w = img.width;
    const h = img.height;

    if (x < 0 || x >= w || y < 0 || y >= h) {
        dst[di] = 255; dst[di+1] = 255; dst[di+2] = 255; dst[di+3] = 255;
        return;
    }

    x = Math.max(0, Math.min(w - 1.001, x));
    y = Math.max(0, Math.min(h - 1.001, y));

    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.min(x1 + 1, w - 1);
    const y2 = Math.min(y1 + 1, h - 1);

    const dx = x - x1;
    const dy = y - y1;

    const d = img.data;
    const i11 = (y1 * w + x1) * 4;
    const i12 = (y1 * w + x2) * 4;
    const i21 = (y2 * w + x1) * 4;
    const i22 = (y2 * w + x2) * 4;

    const oneMinusDx = 1 - dx;
    const oneMinusDy = 1 - dy;
    const w11 = oneMinusDx * oneMinusDy;
    const w12 = dx * oneMinusDy;
    const w21 = oneMinusDx * dy;
    const w22 = dx * dy;

    dst[di]   = (d[i11] * w11 + d[i12] * w12 + d[i21] * w21 + d[i22] * w22 + 0.5) | 0;
    dst[di+1] = (d[i11+1] * w11 + d[i12+1] * w12 + d[i21+1] * w21 + d[i22+1] * w22 + 0.5) | 0;
    dst[di+2] = (d[i11+2] * w11 + d[i12+2] * w12 + d[i21+2] * w21 + d[i22+2] * w22 + 0.5) | 0;
    dst[di+3] = 255;
}
```

Call site becomes:
```js
const i = (y * canvas.width + x) * 4;
bilinearSampleDirect(srcImg, src.x, src.y, dstImg.data, i);
```

Keep the old `bilinearSample()` function as-is (it may be called from other paths).

#### [x] 3. Add `willReadFrequently: true` to sourceCtx
**File**: `script.js`
**Changes**: Line 34, change:
```js
// Before:
const sourceCtx = sourceCanvas.getContext('2d');
// After:
const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
```

This avoids GPU-to-CPU readback penalties when `getImageData()` is called on this context (which happens in both correction paths and for `originalImageData` storage).

#### [x] 4. Add `alpha: false` to simplePerspectiveApply temp context
**File**: `simplePerspectiveApply.js`
**Changes**: Line 37, change:
```js
// Before:
const tempCtx = tempCanvas.getContext('2d');
// After:
const tempCtx = tempCanvas.getContext('2d', { alpha: false });
```

#### [x] 5. Replace `toDataURL` with async `toBlob` in download.js
**File**: `download.js`
**Changes**: Replace the synchronous `toDataURL` + link pattern (lines 32-43) with async `toBlob`:
```js
// Before:
const dataURL = exportCanvas.toDataURL("image/png", 1.0);
const link = document.createElement("a");
const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
link.download = `corrected-document-${timestamp}.png`;
link.href = dataURL;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);

// After:
const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
const filename = `corrected-document-${timestamp}.png`;

exportCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}, "image/png");
```

Since `downloadCorrectedImage` is already called from a click handler, wrapping in a callback is fine. The function signature doesn't need to change.

#### [x] 6. Add bilinear interpolation to simple path
**File**: `simplePerspectiveApply.js`
**Changes**: Replace nearest-neighbor sampling (Math.round, lines 45-46) with bilinear interpolation using the same `bilinearSampleDirect` pattern. This improves quality without significant performance cost (the bottleneck is the per-pixel homography, not the sampling).

Replace lines 44-61:
```js
const srcCoords = transform.transform(x, y);
const srcX = srcCoords[0];
const srcY = srcCoords[1];
const destIndex = (y * destWidth + x) * 4;

if (srcX >= -0.5 && srcX < sourceCtx.canvas.width && srcY >= -0.5 && srcY < sourceCtx.canvas.height) {
    // Bilinear interpolation
    const sx = Math.max(0, Math.min(sourceCtx.canvas.width - 1.001, srcX));
    const sy = Math.max(0, Math.min(sourceCtx.canvas.height - 1.001, srcY));
    const x1 = Math.floor(sx), y1 = Math.floor(sy);
    const x2 = Math.min(x1 + 1, sourceCtx.canvas.width - 1);
    const y2 = Math.min(y1 + 1, sourceCtx.canvas.height - 1);
    const dx = sx - x1, dy = sy - y1;
    const w11 = (1-dx)*(1-dy), w12 = dx*(1-dy), w21 = (1-dx)*dy, w22 = dx*dy;
    const d = imageData.data;
    const i11 = (y1 * sourceCtx.canvas.width + x1) * 4;
    const i12 = (y1 * sourceCtx.canvas.width + x2) * 4;
    const i21 = (y2 * sourceCtx.canvas.width + x1) * 4;
    const i22 = (y2 * sourceCtx.canvas.width + x2) * 4;
    destImageData.data[destIndex]     = (d[i11]*w11 + d[i12]*w12 + d[i21]*w21 + d[i22]*w22 + 0.5) | 0;
    destImageData.data[destIndex + 1] = (d[i11+1]*w11 + d[i12+1]*w12 + d[i21+1]*w21 + d[i22+1]*w22 + 0.5) | 0;
    destImageData.data[destIndex + 2] = (d[i11+2]*w11 + d[i12+2]*w12 + d[i21+2]*w21 + d[i22+2]*w22 + 0.5) | 0;
    destImageData.data[destIndex + 3] = 255;
} else {
    destImageData.data[destIndex] = 255;
    destImageData.data[destIndex + 1] = 255;
    destImageData.data[destIndex + 2] = 255;
    destImageData.data[destIndex + 3] = 255;
}
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm test`
- [x] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [ ] Load a large image (4000×3000+), apply 4-point correction — verify identical visual output
- [ ] Load a large image, apply 5+ point correction — verify identical visual output AND noticeably faster processing
- [ ] Download corrected image — verify download works and no UI freeze
- [ ] Measure correction time with `performance.now()` before and after changes on same image
- [ ] Check browser console for no new warnings/errors

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: WebGL for 4-Point Perspective Transform

### Overview
Implement a WebGL fragment shader that performs the homography warp with hardware bilinear interpolation. This replaces the JS pixel loop for the 4-point path with GPU-parallel processing, achieving 100-1000x speedup. Falls back to the current JS path if WebGL is unavailable.

### Changes Required:

#### [x] 1. Create WebGL perspective transform module
**File**: `webglPerspective.js` (new)
**Changes**: Self-contained WebGL module that:
- Creates an offscreen WebGL canvas
- Uploads source image as texture
- Passes 3×3 homography matrix as uniform
- Renders via fragment shader with `texture2DProj`
- Returns result as a canvas element

```js
// Public API:
export function isWebGLSupported() { ... }
export function applyWebGLPerspective(sourceCanvas, srcPoints, dstPoints, destWidth, destHeight) { ... }
```

Fragment shader (~10 lines GLSL):
```glsl
precision mediump float;
uniform mat3 u_matrix;
uniform sampler2D u_texture;
uniform vec2 u_texSize;
void main() {
    vec3 srcCoord = u_matrix * vec3(gl_FragCoord.xy, 1.0);
    vec2 uv = srcCoord.xy / srcCoord.z / u_texSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    } else {
        gl_FragColor = texture2D(u_texture, uv);
    }
}
```

Boilerplate (~100-150 lines): context setup, shader compilation, texture upload, uniform binding, full-screen quad rendering.

#### [x] 2. Integrate WebGL into correction pipeline
**File**: `script.js`
**Changes**: In the correction orchestration code, check `isWebGLSupported()` and use `applyWebGLPerspective()` for 4-point corrections. Fall back to `applySimplePerspective()` if WebGL unavailable.

```js
import { isWebGLSupported, applyWebGLPerspective } from './webglPerspective.js';

// In the correction handler:
if (points.length === 4 && isWebGLSupported()) {
    result = applyWebGLPerspective(sourceCanvas, orderedPoints, dstPoints, destWidth, destHeight);
} else if (points.length === 4) {
    result = applySimplePerspective(sourceCtx, orderedPoints, destWidth, destHeight);
} else {
    result = applyComplexPerspective(...);
}
```

#### [x] 3. Handle download from WebGL canvas
**File**: `download.js`
**Changes**: Ensure `toBlob()` works correctly when the source is a WebGL canvas (may need `preserveDrawingBuffer: true` on the WebGL context, or render-then-immediately-read).

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm test`
- [x] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [ ] 4-point correction completes in <100ms (vs seconds before) on a large image
- [ ] Visual output matches the JS path (compare screenshots)
- [ ] Download works correctly from WebGL-rendered result
- [ ] Correction works on Chrome, Firefox, and Safari
- [ ] Fallback to JS path works when WebGL is disabled (test by overriding `isWebGLSupported`)
- [ ] No WebGL warnings/errors in console

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Web Worker for Complex Path (5+ Points)

### Overview
Move `applyComplexPerspective` and `applySharpen` into a dedicated Web Worker so the UI stays responsive during processing. The worker receives the image data and point coordinates, processes off-thread, and returns the result. Optional: show a low-res preview immediately.

### Changes Required:

#### [ ] 1. Create perspective correction worker
**File**: `perspectiveWorker.js` (new)
**Changes**: A Web Worker that:
- Receives image data buffer (via Transferable), dimensions, corner points, edge constraints
- Runs the complex perspective correction loop
- Runs sharpening
- Sends result buffer back (via Transferable)
- Reports progress via `postMessage`

```js
// perspectiveWorker.js
self.onmessage = function(e) {
    const { srcBuffer, srcWidth, srcHeight, cornerPts, dstCorners, edgeConstraints, destWidth, destHeight } = e.data;

    const srcData = new Uint8ClampedArray(srcBuffer);
    const dstData = new Uint8ClampedArray(destWidth * destHeight * 4);

    // ... run pixel loop (same logic as applyComplexPerspective) ...
    // ... run sharpen ...

    // Transfer result back (zero-copy)
    self.postMessage({ buffer: dstData.buffer, width: destWidth, height: destHeight }, [dstData.buffer]);
};
```

#### [ ] 2. Extract shared functions into importable module
**File**: `perspectiveCore.js` (new)
**Changes**: Extract the pure math functions used by both the main thread and worker:
- `computeHomography`, `invertHomography`, `applyHomography`
- `applyConstrainedMapping`
- `bilinearSampleDirect`
- `applySharpen` (adapted to work on raw buffers)
- `calculateOutputDimensions`, `orderCorners`

These must be importable from both `complexPerspectiveApply.js` and the worker (via `importScripts` or ES module worker).

#### [ ] 3. Create worker wrapper with progress reporting
**File**: `perspectiveWorkerClient.js` (new)
**Changes**: Async wrapper that:
- Spawns the worker
- Transfers image data
- Listens for progress updates → updates `statusMessage.textContent`
- Returns a Promise that resolves with the result canvas

```js
export async function applyComplexPerspectiveAsync(sourceCtx, cornerPts, edgeConstraints, statusMessage) {
    return new Promise((resolve, reject) => {
        const worker = new Worker('./perspectiveWorker.js', { type: 'module' });
        const imageData = sourceCtx.getImageData(0, 0, ...);

        worker.onmessage = (e) => {
            if (e.data.progress) {
                statusMessage.textContent = `Processing: ${e.data.progress}%`;
            } else {
                // Result received
                const canvas = document.createElement('canvas');
                // ... put result data on canvas ...
                worker.terminate();
                resolve({ canvas, width: e.data.width, height: e.data.height });
            }
        };

        worker.postMessage({
            srcBuffer: imageData.data.buffer,
            srcWidth: imageData.width,
            srcHeight: imageData.height,
            cornerPts, edgeConstraints
        }, [imageData.data.buffer]);
    });
}
```

#### [ ] 4. Integrate worker into correction pipeline
**File**: `script.js`
**Changes**: For 5+ point corrections, use the async worker wrapper instead of the synchronous `applyComplexPerspective()`.

#### [ ] 5. Optional: Low-res progressive preview
**Changes**: Before dispatching to the worker, downscale the image 4x and run a quick correction on the main thread (~50ms for a 750px image). Display this immediately, then swap in the full-res result when the worker finishes.

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `npm test`
- [ ] E2E tests pass: `npx playwright test`

#### Manual Verification:
- [ ] 5+ point correction runs without freezing the UI
- [ ] Progress percentage updates during correction
- [ ] Visual output identical to previous synchronous path
- [ ] Download works correctly after worker-based correction
- [ ] No "page unresponsive" warning on large images
- [ ] Worker terminates cleanly after completion

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: WebAssembly for MVC Download Path (Optional)

### Overview
Compile the MVC (Mean Value Coordinates) interpolation to Rust+Wasm with SIMD for ~10-15x speedup on the download path's trig-heavy per-pixel math. This phase is optional — it provides the most benefit for users who download full-resolution corrected images with 5+ control points.

### Changes Required:

#### [ ] 1. Create Rust Wasm module for MVC interpolation
**Directory**: `wasm/` (new)
**Changes**: Rust crate with `wasm-bindgen` that exposes `map_point_using_mvc()`:
- Takes polygon vertices and a point
- Computes MVC weights using SIMD-accelerated `acos`/`tan`
- Returns mapped coordinates

#### [ ] 2. Build pipeline for Wasm
**File**: `wasm/Makefile` or build script
**Changes**: `wasm-pack build --target web` produces a `.wasm` binary + JS glue (~50-100KB)

#### [ ] 3. Integrate Wasm MVC into download path
**File**: `download.js` and/or `mvc.js`
**Changes**: Feature-detect Wasm, load the module, use it for the per-pixel MVC interpolation in the download path. Fall back to current JS implementation if Wasm unavailable.

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `npm test`
- [ ] Wasm module unit tests pass (Rust `cargo test`)

#### Manual Verification:
- [ ] Download with 5+ points completes noticeably faster
- [ ] Downloaded image quality matches current output
- [ ] Fallback to JS MVC works when Wasm unavailable
- [ ] Wasm binary size <100KB

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding.

---

## Testing Strategy

### Test Design Techniques Applied

Phase 1 changes are primarily internal optimizations that should produce identical output. Testing focuses on regression — verifying that the output doesn't change.

### Unit Tests (base of pyramid):

**Phase 1 — Bottleneck Fixes:**

**Happy path:**
- [ ] `tests/unit/bilinearSample.test.js:bilinearSampleDirect writes correct RGBA to buffer` — center of a 2×2 checkerboard pattern `[HAPPY]`
- [ ] `tests/unit/bilinearSample.test.js:bilinearSampleDirect matches bilinearSample output` — compare old vs new function on same inputs `[HAPPY]`

**Negative testing:**
- [ ] `tests/unit/bilinearSample.test.js:bilinearSampleDirect writes white for out-of-bounds coordinates` — x<0, y<0, x>=w, y>=h `[NEG]`

**Edge cases and boundary values:**
- [ ] `tests/unit/bilinearSample.test.js:bilinearSampleDirect at exact pixel center (integer coords)` — should return exact pixel value `[BVA]`
- [ ] `tests/unit/bilinearSample.test.js:bilinearSampleDirect at pixel boundary (x=0, y=0)` — top-left corner `[BVA]`
- [ ] `tests/unit/bilinearSample.test.js:bilinearSampleDirect at max boundary (x=w-1, y=h-1)` — bottom-right corner `[BVA]`
- [ ] `tests/unit/bilinearSample.test.js:bilinearSampleDirect at half-pixel offset` — should blend 4 neighbors equally `[BVA]`

**Phase 1 — Constraint precomputation:**

- [ ] `tests/unit/constraintPrecompute.test.js:precomputed constraint corrections match per-pixel computation` — compare results with and without precomputation for known inputs `[HAPPY]`
- [ ] `tests/unit/constraintPrecompute.test.js:empty constraints array handled` — no crash `[NEG]`

**Phase 2 — WebGL:**

- [ ] `tests/unit/webglPerspective.test.js:isWebGLSupported returns boolean` — basic feature detection `[HAPPY]`

### Integration Tests (middle of pyramid):

- [ ] `tests/integration/perspectiveOutput.test.js:4-point correction produces same output after optimization` — pixel-level comparison `[HAPPY]`
- [ ] `tests/integration/perspectiveOutput.test.js:5-point correction produces same output after constraint precomputation` — pixel-level comparison `[HAPPY]`

### End-to-End Tests (top of pyramid):

- [ ] `tests/e2e/performance.spec.js:4-point correction completes without page freeze` — apply correction on test image, verify no timeout `[HAPPY]`
- [ ] `tests/e2e/performance.spec.js:download works with toBlob` — click download, verify file received `[HAPPY]`

### Regression — Affected Existing Functionality:

- [ ] All existing unit tests pass: `npm test`
- [ ] All existing e2e tests pass: `npx playwright test`
- [ ] `tests/e2e/folderBrowser.spec.js` — save-to-out still works (uses correction pipeline internally)

### Manual Testing Steps:
1. Load a 4000×3000 image, place 4 points, apply correction — compare output visually with a screenshot from before the changes
2. Same with 5+ points
3. Download the corrected image and verify file integrity
4. Test on Chrome, Firefox, Safari
5. Time corrections with DevTools Performance panel

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

| Change | Expected Impact | Risk |
|--------|----------------|------|
| Fix invertHomography bug | Major speedup for 5+ point path (eliminates millions of matrix inversions) | Low — pure optimization, same math |
| bilinearSampleDirect | Moderate (eliminates ~12M array allocations) | Low — same interpolation logic |
| willReadFrequently | Moderate (avoids GPU↔CPU sync) | None — hint only |
| alpha: false | Minor (5-15%) | None — images have no transparency |
| toBlob | UI responsiveness during download | Low — async vs sync encoding |
| WebGL (Phase 2) | 100-1000x for 4-point path | Medium — new code, fallback needed |
| Web Worker (Phase 3) | UI unblocked + potential multi-worker parallelism | Medium — architecture change |

## Migration Notes

- All changes are backward-compatible
- WebGL and Worker paths include automatic fallback to current JS implementation
- No data format changes
- No API changes for exported functions (except new optional parameters)

## References

- [Research: Performance Bottlenecks and Alternative Architectures](../research/2026-03-28-performance-alternative-architectures.md)
- [Research: Image Processing Performance Optimization](../research/2026-03-28-image-processing-performance-optimization.md)
- [MDN Canvas Optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [WebGL Perspective Transform Gist](https://gist.github.com/mildsunrise/d21cec18ce1709b0e73ebce3bfdb1760)
- [Comlink GitHub](https://github.com/GoogleChromeLabs/comlink)
