# Research: Image Prefetching/Pre-decoding Patterns for Browser Image Viewer

**Date:** 2026-03-28
**Context:** User works on image N, we want image N+1 decoded and ready when they advance.

---

## 1. `createImageBitmap()` for Prefetching

### Can you call it in the background?

Yes. `createImageBitmap(blob)` is fully asynchronous and returns a `Promise<ImageBitmap>`. You can call it at any time, and decoding happens off the main thread (when using a Blob source in Chrome). The returned ImageBitmap stays valid until you call `.close()` on it or it's garbage collected.

### Pattern for prefetching next image

```javascript
let prefetchedBitmap = null;
let prefetchedIndex = -1;

async function prefetchImage(index) {
    const file = await loadImageFile(folderImages[index].handle);
    const blob = file; // File is a Blob subclass
    const bitmap = await createImageBitmap(blob);
    prefetchedBitmap = bitmap;
    prefetchedIndex = index;
}

// When advancing to next image:
async function selectFolderImage(index) {
    let bitmap;
    if (prefetchedIndex === index && prefetchedBitmap) {
        bitmap = prefetchedBitmap;
        prefetchedBitmap = null;
    } else {
        // Cache miss - decode synchronously
        if (prefetchedBitmap) prefetchedBitmap.close();
        const file = await loadImageFile(folderImages[index].handle);
        bitmap = await createImageBitmap(file);
    }
    // Draw bitmap to sourceCanvas
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close(); // Release after drawing
    // Trigger prefetch of next
    prefetchImage(getNextImageIndex(index, folderImages.length));
}
```

### Key finding: Blob source is critical for Chrome

`createImageBitmap(blob)` decodes on a separate thread in Chrome. When used with `HTMLImageElement`, Chrome still blocks the main thread during decode. Firefox and Safari handle both paths off-thread.

### Does the ImageBitmap stay valid?

Yes. The ImageBitmap remains valid and usable until `.close()` is called. It holds decoded pixel data in memory (possibly GPU-backed). There is no expiration.

---

## 2. Web Worker for Pre-decoding

### Can `createImageBitmap()` be called in a Worker?

Yes. `createImageBitmap()` is available on `WorkerGlobalScope` (i.e., inside Web Workers). This is a well-supported, widely-available API.

### Can ImageBitmap be transferred via `postMessage`?

Yes. **ImageBitmap is a Transferable object.** This means zero-copy transfer back to the main thread:

```javascript
// worker.js
self.onmessage = async (e) => {
    const { fileData, index } = e.data;
    const blob = new Blob([fileData]);
    const bitmap = await createImageBitmap(blob);
    // Transfer (not copy) the bitmap back
    self.postMessage({ bitmap, index }, [bitmap]);
};

// main thread
const worker = new Worker('prefetch-worker.js');
worker.postMessage({ fileData: arrayBuffer, index: nextIndex }, [arrayBuffer]);
worker.onmessage = (e) => {
    prefetchedBitmap = e.data.bitmap; // Zero-copy transfer
    prefetchedIndex = e.data.index;
};
```

### Is a Worker necessary?

**For this use case, probably not.** Since `createImageBitmap(blob)` already decodes off the main thread in Chrome, using a Worker adds complexity without much benefit for single-image prefetching. The main benefit of a Worker would be if you need to do CPU-intensive preprocessing (like computing a thumbnail) alongside decoding.

However, there is one practical issue: with the File System Access API, you cannot pass `FileSystemFileHandle` to a Worker. You'd need to call `handle.getFile()` on the main thread, then transfer the resulting `ArrayBuffer` to the Worker. This adds a copy step that partially negates the zero-copy benefit.

### Recommendation

Use `createImageBitmap(blob)` directly on the main thread. It's simpler and already non-blocking.

---

## 3. `HTMLImageElement.decode()`

### What does it do?

`img.decode()` returns a `Promise<undefined>` that resolves once the image is decoded and safe to append to the DOM. It ensures no blank-frame flash when inserting an image.

### How does it compare to `createImageBitmap()`?

| Aspect | `img.decode()` | `createImageBitmap()` |
|--------|----------------|----------------------|
| Returns | `Promise<undefined>` | `Promise<ImageBitmap>` |
| Result | The img element itself is ready | A new ImageBitmap object |
| Canvas use | Need to draw `img` element | Draw `bitmap` directly |
| Worker support | No (needs DOM) | Yes |
| Transferable | No | Yes |
| Resize during decode | No | Yes (`resizeWidth`/`resizeHeight`) |
| Memory control | No `.close()` method | `.close()` releases memory |

### Can it be used for prefetching?

Technically yes, but it's inferior for this use case:
- You must create an `HTMLImageElement` and set its `src`, which requires the DOM context
- The decoded state is tied to the img element, not a standalone bitmap
- No explicit memory release (no `.close()`)
- Cannot be used in a Worker
- Combining `img.decode()` then `createImageBitmap(img)` causes double-decoding (wasteful)

### Verdict

**Use `createImageBitmap(blob)` instead.** It's more suitable for canvas-based workflows, offers better memory control, and works off the main thread.

---

## 4. Two-Resolution Strategy

### Pattern

1. When prefetching, decode at **display resolution** (e.g., 800x1422) using `createImageBitmap(blob, { resizeWidth, resizeHeight })`
2. Keep the original **File/Blob** reference for when full-res correction is needed
3. On image select: instantly draw the low-res bitmap; if user triggers correction, decode full-res on demand

```javascript
async function prefetchImage(index) {
    const file = await loadImageFile(folderImages[index].handle);
    // Decode at display resolution only (~1.4MB vs ~35MB)
    const displayBitmap = await createImageBitmap(file, {
        resizeWidth: displayWidth,
        resizeHeight: displayHeight,
        resizeQuality: 'medium'
    });
    prefetchCache = { index, displayBitmap, file };
}

async function selectFolderImage(index) {
    if (prefetchCache?.index === index) {
        // Instant display from pre-decoded low-res bitmap
        displayCtx.drawImage(prefetchCache.displayBitmap, 0, 0);
        prefetchCache.displayBitmap.close();
        // Full-res decode happens when needed (on correction)
        currentFile = prefetchCache.file;
    }
}

async function applyCorrection() {
    // Now decode full-res from the kept Blob
    const fullBitmap = await createImageBitmap(currentFile);
    sourceCtx.drawImage(fullBitmap, 0, 0);
    fullBitmap.close();
    // ... run perspective correction
}
```

### Feasibility

Good. The `resizeWidth`/`resizeHeight` options are supported in Chrome, Firefox, and Safari. The resize happens during decode, so you never hold the full-res pixels in memory until needed. The `resizeQuality` option controls the downsampling algorithm (`"pixelated"`, `"low"`, `"medium"`, `"high"`).

### Complexity concern for this project

The current architecture draws to `sourceCanvas` at **full image resolution** (that's where points are stored and correction happens). A two-resolution strategy would require separating display from correction, which is a significant refactor. Given that the user typically advances linearly through images, the simpler approach of prefetching at full resolution is likely adequate.

---

## 5. Memory Management

### Memory cost of a decoded image

An ImageBitmap holds decoded RGBA pixel data: **4 bytes per pixel**.

| Image size | Memory |
|-----------|--------|
| 2268 x 4032 (typical phone photo) | ~35 MB |
| 800 x 1422 (display resolution) | ~4.5 MB |
| 4000 x 6000 (high-res camera) | ~96 MB |

### Current memory budget (rough estimate)

The app already holds:
- `sourceCanvas` at full resolution: ~35 MB
- `pointsCanvas` at display resolution: ~4.5 MB
- `gridCanvas` at full resolution: ~35 MB
- The `Image` element: ~35 MB (browser-decoded)

Total current: ~110 MB for one image.

### Impact of prefetching next image at full res

Adding one prefetched ImageBitmap at full resolution: **+35 MB** (bringing total to ~145 MB). This is acceptable for desktop Chrome. Mobile may be more constrained.

### How to limit memory

1. **Prefetch at display resolution** using `resizeWidth`/`resizeHeight`: only ~4.5 MB overhead
2. **Always call `.close()`** on ImageBitmaps when done: `bitmap.close()` immediately releases the backing store (don't rely on GC)
3. **Only prefetch one image ahead** (not two or more)
4. **Cancel/close on navigation**: if user jumps to a different image, close the stale prefetched bitmap

### Critical: always call `.close()`

ImageBitmap objects are **not reliably garbage collected** for their GPU/pixel backing store. You must explicitly call `bitmap.close()` when done. Forgetting this causes memory leaks, especially in long-running sessions (which this app is, since users process many images in sequence).

---

## 6. Cancellation

### Does `createImageBitmap()` support AbortController?

**No.** `createImageBitmap()` does not accept an `AbortSignal` parameter. There is no built-in way to cancel a pending decode.

### Workaround patterns

**Pattern A: Ignore stale results**
```javascript
let prefetchGeneration = 0;

async function prefetchImage(index) {
    const gen = ++prefetchGeneration;
    const file = await loadImageFile(folderImages[index].handle);
    const bitmap = await createImageBitmap(file);
    if (gen !== prefetchGeneration) {
        // User navigated away - discard this result
        bitmap.close();
        return;
    }
    prefetchedBitmap = bitmap;
    prefetchedIndex = index;
}
```

**Pattern B: Close previous prefetch**
```javascript
async function prefetchImage(index) {
    // Discard any previous prefetch
    if (prefetchedBitmap) {
        prefetchedBitmap.close();
        prefetchedBitmap = null;
    }
    const file = await loadImageFile(folderImages[index].handle);
    const bitmap = await createImageBitmap(file);
    prefetchedBitmap = bitmap;
    prefetchedIndex = index;
}
```

**Pattern C: AbortController for the fetch portion**

If you're fetching from a URL (not File System Access), you can abort the `fetch()` that provides the Blob, which prevents the decode from starting:

```javascript
let abortController = new AbortController();

async function prefetchImage(url) {
    abortController.abort(); // Cancel previous fetch
    abortController = new AbortController();
    try {
        const resp = await fetch(url, { signal: abortController.signal });
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        // ... store bitmap
    } catch (e) {
        if (e.name === 'AbortError') return; // Expected
        throw e;
    }
}
```

For File System Access API (our case), `handle.getFile()` is fast (returns a File reference, not a copy), so there's little to cancel there. The decode via `createImageBitmap` cannot be cancelled but typically takes 50-200ms for a phone photo, which is acceptable to let complete and then discard.

### Recommendation for this project

Use **Pattern A (generation counter)** combined with **Pattern B (close previous)**. This is simple, correct, and avoids memory leaks.

---

## Recommended Approach for This Project

Given the architecture (full-resolution sourceCanvas, linear image browsing via folder browser):

1. **Use `createImageBitmap(file)` on the main thread** to prefetch the next image at full resolution
2. **Start prefetch after the current image finishes loading** (in `selectFolderImage` after `hideLoading()`)
3. **Store `{ bitmap, index }` in a simple cache variable** (not a Map of multiple images)
4. **On advance**: check if prefetched index matches; if yes, draw bitmap to canvas and skip the decode step; if no, fall back to normal loading
5. **Always call `bitmap.close()`** after drawing or when discarding stale prefetches
6. **Use a generation counter** to handle rapid navigation (user clicks through multiple images quickly)

Expected improvement: eliminates the ~100-300ms decode time when advancing to the next image, making transitions feel instant.

---

## Sources

- [MDN: Window.createImageBitmap()](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
- [MDN: ImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap)
- [MDN: HTMLImageElement.decode()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)
- [MDN: WorkerGlobalScope.createImageBitmap()](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/createImageBitmap)
- [Chrome Blog: createImageBitmap in Chrome 50](https://developer.chrome.com/blog/createimagebitmap-in-chrome-50)
- [Aerotwist: The Hack is Back (Worker + ImageBitmap pattern)](https://aerotwist.com/blog/the-hack-is-back/)
- [Web Performance Calendar 2025: Non-blocking cross-browser image rendering on canvas](https://calendar.perfplanet.com/2025/non-blocking-image-canvas/)
- [Look Scanned: 60% performance boost with ImageBitmap](https://blog.lookscanned.io/posts/boost-performance-with-imagebitmap/)
- [WebGL Fundamentals: Loading images with no jank](https://webglfundamentals.org/webgl/lessons/webgl-qna-how-to-load-images-in-the-background-with-no-jank.html)
- [Three.js issue: ImageBitmap.close() memory management](https://github.com/mrdoob/three.js/issues/23953)
