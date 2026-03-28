# Browser-Based Image Processing Performance Optimization Research

Date: 2026-03-28

---

## 1. Web Workers for Image Processing

### What It Is
Web Workers run JavaScript in background threads, preventing heavy pixel manipulation from blocking the UI. Combined with `OffscreenCanvas` and Transferable objects, they enable efficient parallel image processing entirely off the main thread.

### How It Works

**Transferable Objects (ArrayBuffer transfer):**
Instead of copying pixel data to the worker (structured clone), you *transfer* ownership of the underlying `ArrayBuffer`. This is near-instantaneous regardless of data size, but the sending thread loses access.

```javascript
// Main thread: send ImageData's buffer as transferable
const imageData = ctx.getImageData(0, 0, w, h);
worker.postMessage(
  { buffer: imageData.data.buffer, width: w, height: h },
  [imageData.data.buffer]  // transfer list
);

// Worker: reconstruct and process
self.onmessage = (e) => {
  const pixels = new Uint8ClampedArray(e.data.buffer);
  // ... manipulate pixels ...
  self.postMessage({ buffer: pixels.buffer }, [pixels.buffer]);
};
```

**OffscreenCanvas:**
Transfer a canvas to a worker via `canvas.transferControlToOffscreen()`. The worker can then draw, apply transforms, and use `getImageData`/`putImageData` without touching the main thread.

```javascript
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ canvas: offscreen }, [offscreen]);
```

**SharedArrayBuffer (multi-worker parallelism):**
For splitting work across N workers, `SharedArrayBuffer` allows all workers to read/write the same memory. Each worker processes a horizontal strip of the image. Requires `Cross-Origin-Isolation` headers (`COOP`/`COEP`).

### Typical Performance Gains
- **Transferable vs. structured clone:** 50% reduction in transfer overhead (20ms to 10ms for typical images)
- **Multi-worker pixel processing:** 4K image processing improved from 2800ms to 650ms (4.3x speedup)
- **Main thread impact:** Near-zero jank since all processing moves off the main thread

### Browser Support
- Web Workers: All browsers (universal)
- Transferable ArrayBuffer: All browsers
- OffscreenCanvas: Baseline Widely Available since September 2025 (Chrome 69+, Firefox 105+, Safari 16.4+, Edge 79+)
- SharedArrayBuffer: All modern browsers (requires `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers)

### Implementation Complexity: **Low to Medium**
- Basic worker + transferable: straightforward, 50-100 lines of scaffolding
- Multi-worker with SharedArrayBuffer: moderate, requires careful index partitioning and CORS headers
- OffscreenCanvas: straightforward for rendering; some libraries need DOM stubs

### Relevance to This Project
The perspective correction pipeline (`applySimplePerspective` / `applyComplexPerspective`) performs per-pixel inverse mapping which is embarrassingly parallel. Moving this to a Web Worker would unblock the UI during correction. Splitting the destination image into horizontal strips across multiple workers would provide near-linear speedup.

### Sources
- [Using Web Workers to Improve Image Manipulation Performance (SitePoint)](https://www.sitepoint.com/using-web-workers-to-improve-image-manipulation-performance/)
- [OffscreenCanvas - MDN](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)
- [OffscreenCanvas: speed up your canvas operations with a web worker (web.dev)](https://web.dev/articles/offscreen-canvas)
- [Use Web Worker and SharedArrayBuffer for Image Convolution](https://dev.to/paradeto/use-web-worker-and-sharedarraybuffer-for-image-convolution-58cn)
- [High-performance Web Worker messages (Nolan Lawson)](https://nolanlawson.com/2016/02/29/high-performance-web-worker-messages/)
- [Workers love ArrayBuffer (Chrome Developers)](https://developers.google.com/web/updates/2011/09/Workers-ArrayBuffer)
- [Transferable ImageData](https://kevinhoyt.com/2018/10/31/transferable-imagedata/)
- [Communicating Large Objects with Web Workers (Red Hat)](https://developers.redhat.com/blog/2014/05/20/communicating-large-objects-with-web-workers-in-javascript)
- [Performance issue of using massive transferable objects](https://joji.me/en-us/blog/performance-issue-of-using-massive-transferable-objects-in-web-worker/)

---

## 2. WebAssembly (Wasm) for Image Processing

### What It Is
WebAssembly is a binary instruction format that runs at near-native speed in browsers. Languages like Rust, C, and C++ compile to Wasm, enabling pixel-level image transforms that are dramatically faster than equivalent JavaScript, especially with SIMD (Single Instruction Multiple Data) support.

### How It Works

**Custom Wasm modules (e.g., Rust):**
Write pixel manipulation in Rust, compile to Wasm with `wasm-pack`, and call from JS via `wasm-bindgen`. The Wasm module receives a pointer to pixel data in linear memory, processes it, and returns.

```rust
// Rust side
#[wasm_bindgen]
pub fn apply_perspective(pixels: &mut [u8], width: u32, height: u32, matrix: &[f64]) {
    // Per-pixel inverse mapping with bilinear interpolation
    // SIMD: process 4 pixels at once via std::arch::wasm32::simd128
}
```

```javascript
// JS side
import init, { apply_perspective } from './perspective_wasm.js';
await init();
const imageData = ctx.getImageData(0, 0, w, h);
apply_perspective(imageData.data, w, h, homographyMatrix);
ctx.putImageData(imageData, 0, 0);
```

**SIMD acceleration:**
128-bit SIMD operations process 4 pixels (16 bytes RGBA) in a single instruction. Enabled via `rustc` flag `-C target-feature=+simd128`.

**OpenCV.js:**
Full OpenCV compiled to WebAssembly. Provides `cv.warpPerspective()` which directly implements homography-based perspective correction. Heavy (~8MB), but feature-complete.

**Photon (lightweight alternative):**
Rust-based Wasm image processing library with 90+ operations. 4-10x faster than JS Canvas API. Lighter than OpenCV.js but does not include perspective transforms out of the box.

### Typical Performance Gains
- **Wasm vs. JS:** 4-10x faster for pixel manipulation (Photon benchmarks)
- **Wasm + SIMD vs. JS:** 10-15x faster (late 2025 benchmarks)
- **Rust+Wasm vs. C++:** Rust showed 9% edge in binary size and speed (Dec 2025 benchmark)
- **Array operations:** 1.4ms (JS) vs 0.231ms (Wasm+SIMD) = 6x improvement

### Browser Support
- WebAssembly: All modern browsers (universal since 2017)
- SIMD (128-bit fixed-width): All major browsers including Safari (since 2024)
- Wasm Threads: All major browsers (requires same COOP/COEP headers as SharedArrayBuffer)
- Component Model: Still in transpilation phase via `jco`, not natively supported yet

### Implementation Complexity: **Medium to High**
- Using OpenCV.js: Medium - include the ~8MB JS file, call `cv.warpPerspective()`, done. But large download.
- Custom Rust+Wasm module: High - requires Rust toolchain, `wasm-pack`, `wasm-bindgen`, and understanding of memory layout. However, you get exact control over the algorithm.
- Photon: Low - npm install, call functions. But lacks perspective transforms.

### Relevance to This Project
The inner loops of `applySimplePerspective` and `applyComplexPerspective` (inverse mapping + bilinear interpolation for every destination pixel) are the performance bottleneck. Porting these to Rust+Wasm with SIMD could yield 10-15x speedup. Alternatively, OpenCV.js provides `warpPerspective` out of the box but adds significant download size.

### Sources
- [Rust & WASM in 2026: A Deep Dive into High-Performance Web Apps](https://dev.to/dataformathub/rust-wasm-in-2026-a-deep-dive-into-high-performance-web-apps-20c6)
- [The State of WebAssembly 2025 and 2026](https://platform.uno/blog/the-state-of-webassembly-2025-2026/)
- [Photon: High-performance WebAssembly image processing library](https://silvia-odwyer.github.io/photon/)
- [OpenCV.js Wasm (GitHub)](https://github.com/echamudi/opencv-wasm)
- [opencv-js-wasm (GitHub)](https://github.com/ttop32/opencv-js-wasm)
- [WebAssembly Image Processing Optimization: A Practical Guide](https://www.webkt.com/article/10383)
- [Experimenting with WebAssembly and Computer Vision (Mozilla Hacks)](https://hacks.mozilla.org/2017/09/bootcamps-webassembly-and-computer-vision/)

---

## 3. WebGPU / WebGL for Perspective Transforms

### What It Is
GPU-based rendering offloads perspective warping to the graphics card. The homography matrix is passed to a shader that runs for every output pixel in parallel (thousands of GPU cores). WebGL is the established API; WebGPU is the modern successor with compute shader support.

### How It Works

**WebGL approach (fragment shader homography):**
Render a full-screen quad. In the fragment shader, multiply each output pixel's coordinates by the inverse homography matrix to find the source texture coordinate, then sample the source image.

```glsl
// Vertex shader
precision mediump float;
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 1, 1);
}

// Fragment shader
precision mediump float;
uniform mat3 matrix;     // 3x3 homography matrix
uniform sampler2D texture;
void main() {
  // texture2DProj does the perspective-correct lookup
  gl_FragColor = texture2DProj(texture, matrix * vec3(gl_FragCoord.xy, 1.0));
}
```

The homography matrix is uploaded via `gl.uniformMatrix3fv()`. The GPU's texture sampling hardware provides free bilinear interpolation.

**WebGPU compute shader approach:**
Instead of the graphics pipeline, use a compute shader that writes directly to an output buffer. This is more flexible (no need for a "rendering" metaphor) and supports arbitrary data layouts.

```wgsl
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var out: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> matrix: mat3x3<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dst_coord = vec3<f32>(f32(id.x), f32(id.y), 1.0);
  let src_coord = matrix * dst_coord;
  let uv = src_coord.xy / src_coord.z;
  let color = textureSampleLevel(src, sampler, uv / texDims, 0.0);
  textureStore(out, vec2<i32>(id.xy), color);
}
```

### Typical Performance Gains
- **GPU vs. CPU pixel processing:** 100-1000x for large images (GPU has thousands of parallel cores)
- **WebGL perspective warp:** Near-instantaneous for any image size (< 1ms for typical document photos)
- **Per-pixel vs. per-line:** WebGL enables per-pixel warping at speeds impossible with Canvas API (which would be "too slow" per-pixel according to WebGL Fundamentals)
- **Texture sampling:** Hardware bilinear interpolation is "free" -- no manual implementation needed

### Browser Support
- **WebGL 1.0:** Universal (all browsers, even old mobile)
- **WebGL 2.0:** All modern browsers (Chrome, Firefox, Safari 15+, Edge)
- **WebGPU:** Chrome 113+ (stable since April 2023), Firefox (behind flag / Nightly), Safari (partial in Technology Preview). Not yet universally available.

### Implementation Complexity: **Medium**
- WebGL for perspective transform: Medium - requires understanding shaders, but the actual shader is ~10 lines. Boilerplate for context setup, texture upload, and readback is ~100-150 lines. Libraries like TWGL reduce this.
- WebGPU compute: Medium-High - newer API, less documentation, but more flexible. WGSL shading language is cleaner than GLSL.
- Readback penalty: Reading pixels back from GPU to CPU (via `readPixels` or `mapAsync`) has latency. If you need the result as ImageData, this adds ~5-20ms.

### Relevance to This Project
This is the highest-impact optimization for the perspective correction pipeline. The current JS implementation does per-pixel inverse mapping with bilinear interpolation -- exactly what GPUs excel at. A WebGL implementation would reduce correction time from seconds to milliseconds. The fragment shader approach with `texture2DProj` handles the homography and bilinear interpolation in ~5 lines of shader code. WebGL's universal support makes it deployable today; WebGPU could be a future enhancement.

### Sources
- [Use WebGL to apply a perspective transform to an image (GitHub Gist)](https://gist.github.com/mildsunrise/d21cec18ce1709b0e73ebce3bfdb1760)
- [Create image warping effect in WebGL (WebGL Fundamentals)](https://webglfundamentals.org/webgl/lessons/webgl-qna-create-image-warping-effect-in-webgl.html)
- [WebGL 3D Perspective Correct Texture Mapping](https://webglfundamentals.org/webgl/lessons/webgl-3d-perspective-correct-texturemapping.html)
- [WebGPU: All of the cores, none of the canvas (Surma)](https://surma.dev/things/webgpu/)
- [WebGPU: Unlocking modern GPU access in the browser (Chrome Developers)](https://developer.chrome.com/blog/webgpu-io2023)
- [WebGPU API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)
- [From WebGL to WebGPU (Chrome Developers)](https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu)
- [WebGL Planar and Perspective Projection Mapping](https://webglfundamentals.org/webgl/lessons/webgl-planar-projection-mapping.html)
- [Faster WebGL/Three.js with OffscreenCanvas and Web Workers (Evil Martians)](https://evilmartians.com/chronicles/faster-webgl-three-js-3d-graphics-with-offscreencanvas-and-web-workers)

---

## 4. Canvas API Optimizations

### What It Is
A collection of techniques to optimize the standard Canvas 2D API for image processing, avoiding common performance pitfalls and leveraging newer APIs like `createImageBitmap` and `OffscreenCanvas`.

### How It Works

**`createImageBitmap()` for fast image decoding:**
Decodes images asynchronously and returns an `ImageBitmap` that can be drawn directly with `drawImage()`. Faster than loading into an `<img>` element and avoids blocking the main thread during decode.

```javascript
const response = await fetch('image.jpg');
const blob = await response.blob();
const bitmap = await createImageBitmap(blob);
ctx.drawImage(bitmap, 0, 0);  // fast, hardware-accelerated
```

**`willReadFrequently` context option:**
When you know you will call `getImageData()` repeatedly, set this flag at context creation. This tells the browser to use CPU-backed rendering from the start, avoiding the expensive GPU-to-CPU readback on every `getImageData()` call.

```javascript
const ctx = canvas.getContext('2d', { willReadFrequently: true });
// Subsequent getImageData() calls are much faster
```

**Avoid full-canvas `getImageData`/`putImageData`:**
These are expensive because they copy pixel data between GPU and CPU memory. Strategies to minimize impact:
- Read only the region you need (pass x, y, width, height)
- Use a small secondary canvas to sample specific regions
- Use `drawImage()` instead of `putImageData()` when possible (drawImage is GPU-accelerated)

**Disable alpha channel when not needed:**
```javascript
const ctx = canvas.getContext('2d', { alpha: false });
```
Eliminates alpha compositing overhead on every draw operation.

**Use integer coordinates:**
Floating-point coordinates trigger sub-pixel anti-aliasing. Use `Math.floor()` or `Math.round()` for pixel-aligned drawing.

**CSS transforms instead of canvas scaling:**
Use `element.style.transform = 'scale(2)'` for display scaling rather than changing canvas dimensions. CSS transforms are GPU-accelerated.

**Layered canvases:**
Use separate canvas elements for different update frequencies (e.g., static background vs. animated foreground). Only redraw what changed.

**Batch `ImageBitmap` rendering:**
Pre-render repeated elements to offscreen canvases/ImageBitmaps. Benchmarks show rendering 100,000 data points drops from 287ms (naive) to 15ms (cached ImageBitmap).

### Typical Performance Gains
- **`willReadFrequently`:** Avoids GPU-to-CPU sync penalty; can be 2-10x faster for repeated `getImageData()` on GPU-accelerated canvases
- **`createImageBitmap`:** Async decode, no main-thread blocking; ~2x faster image loading
- **`alpha: false`:** 5-15% improvement in compositing-heavy scenarios
- **Cached ImageBitmap:** 287ms to 15ms (19x) for repeated rendering
- **Integer coordinates:** Eliminates anti-aliasing overhead

### Browser Support
- `createImageBitmap()`: All modern browsers (Chrome 50+, Firefox 42+, Safari 15+, Edge 79+)
- `willReadFrequently`: Chrome 97+, Firefox 97+, Safari 15.4+, Edge 97+
- `OffscreenCanvas`: Baseline Widely Available (Sep 2025), all modern browsers
- `alpha: false` context option: All modern browsers
- Color space options (`display-p3`, float16): Chrome 110+, Firefox 120+, Safari 17+

### Implementation Complexity: **Low**
Most of these are one-line configuration changes or minor code adjustments. The biggest effort is restructuring code to avoid `getImageData`/`putImageData` round-trips, which may require architectural changes.

### Relevance to This Project
Several quick wins apply directly:
1. The project already uses layered canvases (good).
2. Adding `willReadFrequently: true` to the `sourceCanvas` context (used for reading pixel data during correction) would help.
3. Using `createImageBitmap()` for image loading instead of `Image()` + `onload` would speed up initial load.
4. The `pointsCanvas` uses `alpha: false` potential -- but it needs transparency for overlaying points, so this applies mainly to `sourceCanvas`.
5. The zoom preview could use `drawImage()` with source rect instead of `getImageData` + `putImageData`.

### Sources
- [Optimizing canvas - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- [OffscreenCanvas: speed up your canvas operations (web.dev)](https://web.dev/articles/offscreen-canvas)
- [Get Hit By Performance Bottleneck In Canvas](https://dev.to/ikhwanal/get-hit-by-performance-bottleneck-in-canvas-5che)
- [drawImage and getImageData benchmark: Canvas vs OffscreenCanvas](https://www.measurethat.net/Benchmarks/Show/6873/0/drawimage-and-getimagedata-on-canvas-vs-offscreencanvas)
- [HTML5 Canvas getImageData vs toDataURL: Memory Usage and Performance](https://copyprogramming.com/howto/result-of-html5-canvas-getimagedata-or-todataurl)
- [Proposal: ImageBitmap.getImageData (WHATWG)](https://github.com/whatwg/html/issues/4785)
- [Slow getImageData/putImageData performance (Firefox bug)](https://bugzilla.mozilla.org/show_bug.cgi?id=1001069)

---

## Summary Comparison

| Approach | Performance Gain | Browser Support | Complexity | Best For |
|----------|-----------------|-----------------|------------|----------|
| Web Workers | 4-5x (parallelism) | Universal | Low-Medium | Unblocking UI, multi-core utilization |
| WebAssembly + SIMD | 10-15x | Universal (SIMD since 2024) | Medium-High | CPU-bound pixel math |
| WebGL shaders | 100-1000x | Universal | Medium | Perspective transforms, any per-pixel mapping |
| Canvas API tweaks | 2-19x (varies) | Universal | Low | Quick wins, image loading, readback |

## Recommended Priority for This Project

1. **WebGL (highest impact, medium effort):** The perspective correction is a textbook GPU problem. A fragment shader with `texture2DProj` replaces hundreds of lines of JS per-pixel mapping with ~10 lines of GLSL and runs in <1ms. Universal browser support.

2. **Canvas API quick wins (low effort):** Add `willReadFrequently`, use `createImageBitmap`, ensure integer coordinates. Minimal code changes for measurable improvement.

3. **Web Workers (medium effort):** Move the correction pipeline to a worker to unblock UI. Even without WebGL, this prevents the "page unresponsive" warning on large images.

4. **WebAssembly (high effort, diminishing returns if WebGL is used):** Most valuable if WebGL cannot be used (e.g., for the complex 5+ point correction with MVC interpolation that doesn't map cleanly to a single homography shader). Rust+SIMD would provide 10-15x over current JS.
