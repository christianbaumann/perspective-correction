---
date: 2026-03-28T16:53:23+00:00
git_commit: cc1c03a
branch: fix/spinner-forever-on-image-load
topic: "Pre-decode next image and createImageBitmap() with display-size resizing"
tags: [research, performance, createImageBitmap, prefetch, image-decode]
status: complete
---

# Research: Pre-decode Next Image & createImageBitmap() with Resizing

## Research Question

Two optimization strategies for the folder browser image loading pipeline:
1. **Pre-decode the next image** while the user works on the current one
2. **Use `createImageBitmap()` with resizing** to decode at actual display size rather than full resolution

## Summary

The PERF logs show that **image decoding is the dominant bottleneck** at ~4140ms for a 2268×4032 PNG. Two complementary strategies can virtually eliminate this wait:

- **`createImageBitmap(blob)`** decodes off the main thread in Chrome (when given a Blob/File source), and supports `resizeWidth`/`resizeHeight` options to produce a smaller bitmap. This reduces both decode time and memory.
- **Pre-decoding the next image** during user idle time means the bitmap is already ready when the user advances. Combined, these should reduce perceived image-load time from ~4s to near-instant.

## Detailed Findings

### 1. `createImageBitmap()` API

#### Signature
```js
createImageBitmap(image)
createImageBitmap(image, options)
createImageBitmap(image, sx, sy, sw, sh, options)
```

#### Accepted sources
`Blob`, `File`, `ImageData`, `HTMLImageElement`, `HTMLCanvasElement`, `OffscreenCanvas`, `ImageBitmap`, `HTMLVideoElement`, `SVGImageElement`, `VideoFrame`.

#### Key options

| Option | Values | Description |
|--------|--------|-------------|
| `resizeWidth` | positive integer | Output width in pixels |
| `resizeHeight` | positive integer | Output height in pixels |
| `resizeQuality` | `"pixelated"`, `"low"`, `"medium"`, `"high"` | Scaling algorithm hint |
| `imageOrientation` | `"from-image"`, `"flipY"`, `"none"` | EXIF orientation handling |

Returns `Promise<ImageBitmap>`.

#### Off-thread decoding behavior (critical nuance)

The decoding thread depends on **source type AND browser**:

| Source type | Chrome | Firefox | Safari |
|-------------|--------|---------|--------|
| `Blob`/`File` | Off main thread | Off main thread | Off main thread |
| `HTMLImageElement` | **Blocks main thread** | Off main thread | Off main thread |

**For Chrome, always use a Blob/File source** to get non-blocking decode. The `File` object from the File System Access API (`fileHandle.getFile()`) is a `Blob` subclass, so it works directly:

```js
const file = await fileHandle.getFile();
const bitmap = await createImageBitmap(file, { resizeWidth: 433, resizeHeight: 770 });
```

#### Resize during decode

The browser decodes at full resolution then downsamples — there is no "decode at 1/4 size" optimization as exists in Android's `BitmapFactory`. However, the **resulting bitmap uses less memory**: a 2268×4032 image resized to 433×770 uses ~1.3 MB instead of ~35 MB RGBA.

#### Using the result

- `ctx.drawImage(bitmap, 0, 0)` — works directly, same as any image source
- `getImageData()` works normally after drawing to canvas
- `ImageBitmap` is **Transferable** — can be zero-copy transferred to/from Web Workers via `postMessage`

#### Memory and cleanup

- `ImageBitmap` may hold GPU-resident memory
- **`bitmap.close()` is essential** — releases GPU/system memory immediately. Without it, memory waits for GC which can be significantly delayed
- After `.close()`, width/height become 0 and the bitmap is unusable

#### Browser support

- **Chrome 59+**: Full support including all options
- **Firefox 98+**: `resizeWidth`/`resizeHeight` added in v98; `resizeQuality` added later (v144+)
- **Safari 15.2+**: Basic support; full options support from 18.5+
- **Edge 79+**: Matches Chrome (Chromium-based)

### 2. Display Size Calculation

The current `setupCanvas()` function (`script.js:238-307`) calculates display dimensions by fitting the image to the `.canvas-wrapper` container while preserving aspect ratio:

```js
const container = document.querySelector('.canvas-wrapper');
const containerWidth = container.clientWidth;
const containerHeight = container.clientHeight;
const imageAspectRatio = imageWidth / imageHeight;

if (containerWidth / containerHeight > imageAspectRatio) {
    displayHeight = containerHeight;
    displayWidth = displayHeight * imageAspectRatio;
} else {
    displayWidth = containerWidth;
    displayHeight = displayWidth / imageAspectRatio;
}
```

The display size varies by screen. From the PERF logs:
- One run: `Display: 433×770, Scale: 5.24x`
- Another run: `Display: 315×560, Scale: 7.20x`

The `sourceCanvas` is set to **full image resolution** (`2268×4032`), and CSS scales it down to display size. The `pointsCanvas` uses display resolution.

**For pre-decoding at display size**, the container dimensions must be known at prefetch time. Since the container size doesn't change between images (only on window resize), the current `containerWidth`/`containerHeight` can be captured and reused.

### 3. Where `image` (HTMLImageElement) is used in the codebase

The global `image` variable (`script.js:62`) is used in these places:

| Location | Usage | Needs full-res? |
|----------|-------|-----------------|
| `setupCanvas()` line 289 | `sourceCtx.drawImage(image, ...)` at full resolution | Yes — sourceCanvas is full-res |
| `setupCanvas()` line 290 | `sourceCtx.getImageData(...)` → `originalImageData` | Yes — full pixel data for correction |
| `resetAllPoints()` line 1017 | `sourceCtx.drawImage(image, ...)` fallback | Yes — restores full-res image |
| `handleImageUpload()` line 221 | Reads `naturalWidth`/`naturalHeight` | Just metadata |
| Various guards | `if (!image) return` checks | Just truthiness |

**Key insight**: The `image` variable is used to draw at **full resolution** onto `sourceCanvas` (which operates at full image resolution for the correction pipeline). A display-resolution bitmap alone would not suffice — full-resolution pixel data is needed for `getImageData()` and the correction algorithms.

### 4. Two-resolution strategy

A two-resolution approach would work as follows:

1. **Pre-decode at display resolution** for fast visual display (~1.3 MB, near-instant)
2. **Decode at full resolution** in the background for correction (~35 MB, can happen while user places points)

However, the current architecture tightly couples image display with full-resolution canvas setup:
- `setupCanvas()` sets `sourceCanvas` to full image dimensions and calls `getImageData()` to store `originalImageData`
- The zoom previews read directly from `sourceCanvas` at full resolution
- Corner zoom boxes sample `sourceCanvas` at full resolution

Decoupling display from full-res processing would require significant refactoring of `setupCanvas()`, zoom preview, and the correction pipeline entry points.

### 5. Pre-decoding the next image

#### Pattern
While the user works on image N, call `createImageBitmap()` on image N+1's file. Store the result. When the user advances, the bitmap is already decoded and ready.

#### Implementation considerations

**Source**: `folderImages[nextIndex].handle.getFile()` returns a `File` (Blob subclass) — ideal for off-thread decode in Chrome.

**Memory**: Pre-decoding one image at full resolution adds ~35 MB (2268×4032 × 4 bytes). Current memory usage is already ~110 MB (sourceCanvas + originalImageData + working data), so total goes to ~145 MB — acceptable for desktop Chrome.

**Cancellation**: `createImageBitmap()` does **not** support `AbortController`. If the user clicks a different image, the pending decode cannot be cancelled. Workaround: use a generation counter to detect stale results and call `.close()` on the orphaned bitmap.

```js
let prefetchGeneration = 0;
let prefetchedBitmap = null;
let prefetchedIndex = -1;

async function prefetchNextImage(nextIndex) {
    const gen = ++prefetchGeneration;
    try {
        const file = await folderImages[nextIndex].handle.getFile();
        const bitmap = await createImageBitmap(file);
        if (gen !== prefetchGeneration) {
            bitmap.close(); // stale, discard
            return;
        }
        if (prefetchedBitmap) prefetchedBitmap.close();
        prefetchedBitmap = bitmap;
        prefetchedIndex = nextIndex;
    } catch (e) {
        // prefetch failure is non-critical
        console.warn('Prefetch failed:', e);
    }
}
```

**When to trigger**: After `selectFolderImage()` completes (image N is loaded and displayed), immediately start prefetching N+1.

**Cache hit on advance**: In `selectFolderImage()`, before the `new Image()` path, check if `prefetchedIndex === index`. If so, use the bitmap directly via `ctx.drawImage(prefetchedBitmap, ...)` and skip the decode step entirely.

#### Using ImageBitmap instead of HTMLImageElement

`ImageBitmap` can be used with `drawImage()` just like an `HTMLImageElement`. The `setupCanvas()` function currently does:
```js
sourceCtx.drawImage(image, 0, 0, imageWidth, imageHeight);
```

This works identically with an `ImageBitmap`. The bitmap's `.width` and `.height` properties provide the dimensions (equivalent to `naturalWidth`/`naturalHeight`).

However, `resetAllPoints()` also uses `image` as a fallback (`script.js:1017`). Since `originalImageData` (the `ImageData` snapshot) is the primary restore path and is always set by `setupCanvas()`, the `image` fallback is rarely hit. But if the bitmap is `.close()`'d after `setupCanvas()`, this fallback would fail. Options:
- Keep the bitmap alive until the next image loads (don't close it)
- Rely solely on `originalImageData` for restore (it's always set)

### 6. `img.decode()` comparison

`HTMLImageElement.decode()` is an alternative but **inferior** for this use case:

| Feature | `createImageBitmap(blob)` | `img.decode()` |
|---------|--------------------------|-----------------|
| Off-thread decode (Chrome) | Yes (with Blob source) | No |
| Resize during decode | Yes (`resizeWidth`/`resizeHeight`) | No |
| Works in Web Workers | Yes | No |
| Memory cleanup | `.close()` | No equivalent |
| Returns | `ImageBitmap` (drawable) | `undefined` (img is ready) |

Using `img.decode()` followed by `createImageBitmap(img)` causes **double-decoding** and blocks the main thread in Chrome. Avoid this combination.

## Code References

- `script.js:62` — `let image = null` global variable
- `script.js:238-307` — `setupCanvas()` with display size calculation and full-res draw
- `script.js:289-290` — `drawImage` + `getImageData` at full resolution
- `script.js:911-978` — `selectFolderImage()` — current image loading flow
- `script.js:1012-1018` — `resetAllPoints()` — uses `image` as fallback for restore
- `folderBrowser.js:34-36` — `loadImageFile()` returns `File` object
- `script.js:269-270` — `displayScale = imageWidth / displayWidth` calculation

## Architecture Documentation

### Current image loading flow (folder browser)

```
selectFolderImage(index)
  → loadImageFile(handle)           // ~1.5ms, returns File object
  → URL.createObjectURL(file)       // instant
  → new Image(); img.src = url      // triggers decode
  → img.onload                      // ~4140ms later (PNG decode on main thread)
    → releaseImageMemory()          // frees previous canvas/imagedata
    → setupCanvas()                 // sets sourceCanvas to full-res, draws image, getImageData
    → resetAllPoints()              // clears points, may redraw image from originalImageData
    → hideLoading()                 // removes spinner
```

### Key constraint

`sourceCanvas` operates at full image resolution (2268×4032) — not display resolution. This is required because:
1. The correction algorithms (`applySimplePerspective`, `applyComplexPerspective`) work on full-res pixel data via `getImageData()`
2. The WebGL path reads `sourceCanvas` as a texture at full resolution
3. Zoom previews sample `sourceCanvas` at full resolution for magnified views
4. `originalImageData` stores a full-res snapshot for reset/restore

## Open Questions

1. **Would a display-res preview + deferred full-res decode** be worth the refactoring? The user spends several seconds placing points — enough time to decode full-res in the background. But it requires splitting `setupCanvas()` into a fast display path and a deferred data path.

2. **PNG vs JPEG source images**: PNG decode is inherently slower than JPEG for photographic content. If source images were JPEG, the 4140ms decode could drop to ~400-800ms, making prefetch less critical. This is an upstream data decision, not a code change.

3. **`createImageBitmap` with resize for the zoom preview canvases**: Currently zoom previews sample `sourceCanvas` via `drawImage()` sub-rectangles. Could an intermediate-resolution bitmap serve the zoom previews adequately while saving memory?
