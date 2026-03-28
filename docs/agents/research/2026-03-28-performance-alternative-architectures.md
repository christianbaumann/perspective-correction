---
date: 2026-03-28T14:47:32.352038+00:00
git_commit: cc1c03ac8c643bf57208f209db8701d0d241a528
branch: main
topic: "Performance bottlenecks and alternative architectural approaches for image processing"
tags: [research, performance, architecture, web-workers, webgl, webassembly, wasm, offscreen-canvas]
status: complete
---

# Research: Performance Bottlenecks and Alternative Architectural Approaches

## Research Question

Performance is really bad; think about alternative designs/architectural approaches; how about a component decoupled from the UI, that does the heavy lifting in the background? The UI sends a task (image + coordinates + whatever else is needed) to a queue/other system, and that other system does the image processing? But also go for other/different approaches.

## Summary

The current perspective correction pipeline runs entirely on the main thread with synchronous, pixel-by-pixel JavaScript loops. For a typical 4000x3000 image (12 million pixels), both the simple and complex correction paths iterate over every destination pixel, computing a homography transform and bilinear interpolation per pixel — all blocking the UI. The complex path adds per-pixel inverse-distance-weighted constraint corrections and a second full-image pass for sharpening. The download path additionally uses Mean Value Coordinates (MVC) with expensive `acos()` + `tan()` calls per pixel per polygon vertex.

Six alternative architectural approaches exist, ranging from low-effort Canvas API tweaks to high-impact WebGL GPU acceleration, with Web Workers + Comlink offering the best balance of UI responsiveness and implementation simplicity for this project's constraints (client-side only, hosted on GitHub Pages, no bundler).

## Detailed Findings

### Current Performance Bottlenecks

#### 1. Simple Perspective Correction (`simplePerspectiveApply.js`)

The core loop (lines 42-63) iterates `destWidth * destHeight` pixels on the main thread:

```js
for (let y = 0; y < destHeight; y++) {
    for (let x = 0; x < destWidth; x++) {
        const srcCoords = transform.transform(x, y);  // homography per pixel
        // ... nearest-neighbor sampling, 4 byte copies per pixel
    }
}
```

- **No bilinear interpolation** — uses `Math.round()` for nearest-neighbor sampling
- **No progress reporting** — UI is frozen for the entire duration
- **Blocking `getImageData()` and `putImageData()`** — synchronous full-image reads/writes
- For a 4000x3000 image: ~12M iterations with a matrix multiply each

#### 2. Complex Perspective Correction (`complexPerspectiveApply.js`)

The core loop (lines 67-94) is similar but heavier per pixel:

```js
for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
        if (edgeConstraints && edgeConstraints.length > 0) {
            src = applyConstrainedMapping(x, y, H_inv, edgeConstraints, width, height);
            // Per pixel: base homography + distance calc per constraint + IDW weighting
            // + invertHomography() called INSIDE the loop (line 441) — a 3x3 matrix inversion per constraint per pixel
        } else {
            src = applyHomography(x, y, H_inv);
        }
        const rgba = bilinearSample(srcImg, src.x, src.y);  // 4 lerps per pixel
    }
}
```

- **`invertHomography()` called per-pixel per-constraint** (line 441 inside `applyConstrainedMapping`) — this inverts a 3x3 matrix for every pixel that's within influence range of a constraint. This is a significant performance bug.
- **Bilinear interpolation** — 4 lerps and 4 array index calculations per pixel
- **Progress updates every 10,000 pixels** (line 89) — `statusMessage.textContent = ...` triggers layout/paint reflow, but the browser can't actually repaint because the main thread is blocked in the loop
- **Post-processing sharpening** (`applySharpen`, lines 684-718) — another full-image pass with 8-neighbor kernel, allocates a `Uint8ClampedArray` copy of the entire image

#### 3. Download Path (`download.js` + `mvc.js`)

- **`toDataURL("image/png")`** (line 32) — synchronous PNG encoding of the entire image, blocking main thread
- **MVC interpolation** (`mvc.js`) — when used from the download path, calls `Math.acos()` and `Math.tan()` twice per polygon vertex per pixel. For a 4-vertex polygon on a 12M pixel image: ~96M trig function calls

#### 4. Memory Patterns

- `getImageData()` allocates a full RGBA buffer: 4000x3000x4 = ~46MB per call
- `originalImageData` stored in module scope (~46MB retained)
- Temporary canvas + `createImageData()` for destination: another ~46MB
- Sharpening pass copies the entire pixel buffer: `new Uint8ClampedArray(data)` — another ~46MB
- **Peak memory during complex correction: ~180-230MB** for a single 12MP image

### Alternative Architectural Approaches

#### Approach 1: WebGL / GPU-Based Perspective Transform

**Concept:** The entire homography warp is a textbook GPU operation — a fragment shader applies the inverse homography matrix to each pixel's coordinates and samples the source texture with hardware bilinear interpolation.

**How it works:**
- Upload source image as a WebGL texture
- Pass the 3x3 homography matrix as a uniform
- A fragment shader computes `vec3 src = H_inv * vec3(gl_FragCoord.xy, 1.0)` and samples `texture2D(source, src.xy / src.z)`
- The GPU processes all pixels in parallel with hardware-accelerated texture sampling
- Result is read back via `readPixels()` or rendered directly to an on-screen canvas

**Performance:** 100-1000x faster than JS pixel loops. A 12MP perspective correction completes in <1ms on a modern GPU, vs. seconds in JS. The hardware bilinear interpolation is essentially free.

**Browser support:** WebGL 2.0 is universally supported (all major browsers since 2017+). WebGPU adds compute shaders but is Chrome/Edge-only stable as of March 2026.

**Complexity:** Medium — ~150 lines of JS boilerplate + ~10 lines of GLSL shader code. No build tools required.

**Trade-offs:**
- (+) Largest performance gain by far
- (+) Universal browser support (WebGL)
- (+) Hardware bilinear interpolation and anti-aliasing for free
- (-) Edge constraints (5+ points) need a more complex shader or multi-pass approach
- (-) `readPixels()` for downloading the result back to CPU is a synchronous GPU-to-CPU transfer
- (-) Sharpening post-processing needs a second shader pass or can remain in JS on the GPU output

**References:**
- [WebGL perspective transform gist](https://gist.github.com/mildsunrise/d21cec18ce1709b0e73ebce3bfdb1760)
- [Surma's WebGPU guide](https://surma.dev/things/webgpu/)

#### Approach 2: Web Workers + Comlink (Decoupled Processing Queue)

**Concept:** Move the pixel-processing pipeline into a dedicated Web Worker. The main thread sends `ImageData` (or an `ImageBitmap`) plus coordinates to the worker, which processes it off-thread and returns the result. Comlink (~1.1KB) wraps `postMessage` with an RPC-like API so worker code looks like normal async function calls.

**How it works:**
```
Main Thread                          Worker Thread
─────────────                        ─────────────
UI interaction
  ↓
transfer(imageData, points) ──────→  receive imageData + points
  ↓ (UI stays responsive)             ↓
show spinner / low-res preview       run pixel loop (homography + bilinear)
  ↓                                    ↓
receive result ←──────────────────── transfer(resultImageData)
  ↓
display on canvas
```

- **Zero-copy transfer** via Transferable objects: `ImageData.data.buffer` ownership moves to the worker without copying (~46MB moved in <1ms)
- **Multi-worker parallelism**: Split the image into row ranges, dispatch to a pool of workers (one per CPU core), each processes a horizontal strip
- **SharedArrayBuffer**: All workers read from the same source buffer and write to the same destination buffer — zero serialization overhead (requires `COOP/COEP` headers)

**Performance:**
- Single worker: main thread unblocked, same total processing time
- 4-worker pool: ~3-4x speedup on quad-core machines (4.3x measured on 4K images)
- Combined with low-res preview: perceived latency drops to ~50ms

**Browser support:** Web Workers universal; SharedArrayBuffer requires COOP/COEP headers (problematic for GitHub Pages without custom headers).

**Complexity:** Low-Medium. Comlink eliminates most Worker boilerplate. No build tools needed (ES module workers supported in Chrome/Edge/Safari).

**Trade-offs:**
- (+) UI stays responsive during processing
- (+) Parallelizable across CPU cores
- (+) Comlink is tiny (1.1KB) and requires no bundler
- (+) Progressive: can show a low-res preview immediately, swap in full-res when ready
- (-) Total processing time unchanged with a single worker (just moves it off-thread)
- (-) SharedArrayBuffer needs COOP/COEP headers, which GitHub Pages may not support
- (-) Worker startup overhead (~5-10ms) — negligible for large images, not worth it for tiny ones

**References:**
- [Comlink GitHub](https://github.com/GoogleChromeLabs/comlink)
- [web.dev OffscreenCanvas](https://web.dev/articles/offscreen-canvas)
- [SharedArrayBuffer MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)

#### Approach 3: WebAssembly (Wasm) for Compute Kernels

**Concept:** Compile the hot pixel loops (homography inverse mapping + bilinear interpolation) to WebAssembly from Rust or C++. Wasm runs at near-native speed with SIMD support.

**How it works:**
- Write the perspective transform kernel in Rust (or C++)
- Compile to `.wasm` with SIMD enabled (`-C target-feature=+simd128`)
- Load the Wasm module from JS, pass a pointer to the image buffer in Wasm linear memory
- Wasm processes all pixels using 128-bit SIMD (4 floats at once = 4 pixels' x-coordinates in parallel)
- Result remains in Wasm memory; JS reads it back as an `ImageData`

**Performance:** 10-15x over JS with SIMD enabled. The Photon library (Rust→Wasm) demonstrates 4-10x for image filters.

**Alternatives:**
- **OpenCV.js**: Provides `warpPerspective()` out of the box but is ~8MB (too large for this project)
- **Custom Rust module**: ~50-100KB Wasm binary with just the perspective transform

**Browser support:** Wasm baseline universal since 2017. Wasm SIMD supported in Chrome 91+, Firefox 89+, Safari 16.4+.

**Complexity:** Medium-High. Requires a Rust/C++ build toolchain (wasm-pack, Emscripten). No runtime dependencies.

**Trade-offs:**
- (+) Near-native performance for CPU-bound pixel math
- (+) SIMD processes 4 values per instruction
- (+) Can be combined with Web Workers (Wasm in a worker)
- (-) Build toolchain complexity (Rust + wasm-pack or Emscripten)
- (-) Adds `.wasm` binary to the project (~50-100KB)
- (-) Still CPU-bound; doesn't match GPU parallelism of WebGL

**References:**
- [Rust+Wasm deep dive](https://dev.to/dataformathub/rust-wasm-in-2026-a-deep-dive-into-high-performance-web-apps-20c6)
- [Photon image library](https://silvia-odwyer.github.io/photon/)

#### Approach 4: Hybrid Progressive Rendering

**Concept:** Combine a fast low-resolution preview on the main thread with full-resolution processing in the background.

**How it works:**
1. User clicks "Apply correction"
2. **Immediately** (main thread): Downscale the image 4x (3000px → 750px), run the perspective transform on the downscaled version (~187K pixels vs 12M). This takes ~50-100ms and provides instant visual feedback.
3. **In background** (Web Worker): Run the full-resolution transform. When done, swap the low-res result for the full-res one.
4. Optionally: **tiled processing** — divide the output into 256x256 tiles, process visible/center tiles first, render progressively.

**Performance:** Perceived latency drops to ~50ms. Full-resolution result arrives after the same total time as before, but the user sees an immediate response.

**Complexity:** Low-Medium. The low-res preview is just a smaller canvas with the same transform logic.

**Trade-offs:**
- (+) Dramatic improvement in perceived performance
- (+) Works with any processing backend (JS, Wasm, WebGL)
- (+) Tiled processing enables cancellation if user changes points
- (-) Brief moment of lower-quality preview visible
- (-) More state management (preview vs. final result)

#### Approach 5: Server-Side Offloading

**Concept:** Send the image + coordinates to a backend service (REST API, WebSocket, or serverless function) that performs the transform using native libraries (OpenCV, libvips) and returns the corrected image.

**Options:**
| Approach | Latency | Cost |
|---|---|---|
| REST API (Node/Python+OpenCV) | Upload + processing + download | Per-server |
| AWS Lambda | Cold start 100ms-1s + processing | Per invocation |
| Cloudflare Workers | <5ms cold start, edge proximity | Per request |

**Performance:** Native OpenCV `warpPerspective()` is 10-100x faster than JS, but network round-trip for uploading a multi-MB image adds significant latency.

**Trade-offs:**
- (+) Can use optimized native libraries
- (+) No client resource constraints
- (-) **Breaks the "no server" privacy model** — user documents leave the browser
- (-) Requires hosting infrastructure and operational cost
- (-) Network latency dominates for large images
- (-) Breaks offline capability

#### Approach 6: Canvas API Quick Wins

**Concept:** Optimize the existing code with low-effort Canvas API improvements before considering architectural changes.

**Specific optimizations:**
1. **`willReadFrequently: true`** on `sourceCtx` — currently not set. When the context is used with `getImageData()`, this hint avoids GPU-to-CPU readback penalties by keeping the bitmap in CPU-accessible memory.
2. **`createImageBitmap()`** for async image decode — replaces synchronous `Image.onload` + `drawImage()`. Decode happens off-thread.
3. **`{ alpha: false }`** on contexts — eliminates compositing overhead. Already used in `complexPerspectiveApply.js` but not in `simplePerspectiveApply.js` or `sourceCtx`.
4. **Avoid `getImageData()` where possible** — in the simple path, `drawImage()` with a WebGL canvas output would avoid the roundtrip entirely.
5. **Use `canvas.toBlob()` instead of `toDataURL()`** in `download.js` — asynchronous PNG encoding vs. the current synchronous `toDataURL()` that blocks the main thread.
6. **Remove redundant `invertHomography()` call inside the per-pixel loop** in `complexPerspectiveApply.js` line 441 — `invertHomography(H_inv)` is called inside `applyConstrainedMapping()` for every pixel, but the result is the original `H` (since `H_inv` is already the inverse). This should be computed once outside the loop.

**Performance:** Items 1-5 provide modest gains (2-20x for specific operations). Item 6 could significantly speed up the 5+-point path by eliminating millions of 3x3 matrix inversions.

**Complexity:** Very low — mostly one-line changes.

**References:**
- [MDN Canvas Optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)

## Code References

- `simplePerspectiveApply.js:42-63` — Main pixel loop (simple path), blocking main thread
- `complexPerspectiveApply.js:67-94` — Main pixel loop (complex path), blocking main thread
- `complexPerspectiveApply.js:414-469` — `applyConstrainedMapping()` with per-pixel homography inversion
- `complexPerspectiveApply.js:441` — **Performance bug**: `invertHomography(H_inv)` called per-pixel inside constraint loop
- `complexPerspectiveApply.js:684-718` — Sharpening pass, second full-image iteration + memory copy
- `mvc.js:24-43` — MVC weight computation with 2x `acos()` + `tan()` per vertex per pixel
- `download.js:32` — Synchronous `toDataURL()` blocks main thread during PNG encoding
- `script.js:276-277` — `getImageData()` for `originalImageData` storage (~46MB)

## Architecture Documentation

### Current Architecture (Synchronous, Main-Thread)

```
User clicks "Apply"
        ↓
Main Thread: getImageData() ──→ 46MB allocation
        ↓
Main Thread: pixel loop (12M iterations) ──→ UI frozen 2-10 seconds
        ↓
Main Thread: putImageData() ──→ result to canvas
        ↓
Main Thread: applySharpen() ──→ another full pass + 46MB copy
        ↓
UI unfreezes, result displayed
```

### Recommended Architecture (Tiered)

**Tier 1 — Quick wins (hours of work):**
- Fix `invertHomography()` per-pixel bug
- Add `willReadFrequently: true`, `alpha: false` where missing
- Replace `toDataURL()` with `toBlob()` in download path

**Tier 2 — WebGL for the 4-point path (days of work):**
- Fragment shader for homography warp with hardware bilinear interpolation
- Falls back to current JS path for 5+ points (edge constraints harder to express in GLSL)
- 100-1000x speedup for the common case

**Tier 3 — Web Worker + Comlink for complex path (days of work):**
- Move `applyComplexPerspective` and sharpening to a worker
- Progressive preview: immediate low-res result + full-res swap
- UI stays responsive throughout

**Tier 4 — Wasm for MVC download path (week of work):**
- Compile MVC interpolation to Wasm with SIMD
- 10-15x speedup for the download path's per-pixel trig math

## Open Questions

1. **GitHub Pages COOP/COEP headers**: Can GitHub Pages serve the headers needed for `SharedArrayBuffer`? If not, multi-worker parallelism with shared memory won't work (but Transferable-based single workers still work fine).
2. **WebGL readback latency**: For the download path, `readPixels()` after a WebGL render may have non-trivial latency. Should the download path use a different strategy (e.g., `toBlob()` on the WebGL canvas)?
3. **5+ point constraint mapping in shaders**: The IDW constraint correction in `applyConstrainedMapping` uses dynamic loops over constraints. This can be expressed in GLSL but requires passing constraint data as a texture or uniform array — worth scoping separately.
4. **Mobile performance**: Web Workers and WebGL are available on mobile browsers, but GPU capabilities vary significantly. Should there be a quality/speed toggle?
