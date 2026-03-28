---
date: 2026-03-27T16:49:20Z
git_commit: dd6052d
branch: fix/delete-points-not-working
topic: "Image loading performance degradation and memory retention across multiple images"
tags: [research, codebase, performance, memory, folder-browser]
status: complete
---

# Research: Image Loading Performance & Memory Retention

## Research Question
After editing a couple of images, loading new images becomes really slow. Are previously edited images kept in memory?

## Summary

The codebase has several sources of large memory allocations that accumulate across image edits. While previous image *objects* are properly dereferenced and eligible for GC, several factors create memory pressure that the garbage collector may not relieve fast enough, causing progressive slowdown.

## Detailed Findings

### 1. `originalImageData` — Full-Resolution Pixel Copy Retained

**File:** `script.js:266`
```js
originalImageData = sourceCtx.getImageData(0, 0, imageWidth, imageHeight);
```

Every call to `setupCanvas()` reads the entire source canvas into an `ImageData` object. For a 4000×3000 photo, this is **48 MB** of raw RGBA pixel data. This object is kept in the module-level variable `originalImageData` (line 67) for the "Reset All Points" feature to restore the original image.

When a new image loads, `setupCanvas()` overwrites this variable — the old `ImageData` becomes eligible for GC but may not be freed immediately, so two 48 MB objects can coexist briefly.

### 2. `transformedImageData` — Retains a Full Temp Canvas

**Files:** `script.js:66`, `simplePerspectiveApply.js:34-37,67-74`, `complexPerspectiveApply.js:39-42,112-119`

After applying perspective correction, a **temp canvas** with the corrected image is stored in the `transformedImageData` object. This canvas has its own GPU-backed pixel buffer. It is only released when:
- `resetAllPoints()` sets `transformedImageData = null` (line 897)
- A new image loads via `selectFolderImage()` which calls `resetAllPoints()`

In the folder browser auto-save flow (`applyPerspectiveCorrection` → `handleSaveToOut` → `selectFolderImage`), `transformedImageData` is set during correction, then `handleSaveToOut` uses `sourceCanvas` (not the temp canvas) for saving, and only the subsequent `selectFolderImage` → `setupCanvas` → `resetAllPoints` clears it. So during the save+advance sequence, both the old transformed canvas and the new image's `originalImageData` coexist.

### 3. `handleImageUpload` Uses Data URLs (Not Object URLs)

**File:** `script.js:193-210`
```js
reader.readAsDataURL(file);  // line 210
...
img.src = e.target.result;    // line 208 — assigns base64 data URL
```

When uploading via the file picker, the entire image is read as a **base64 data URL** (~33% larger than the binary). This string is assigned to the Image's `src` and remains in memory as long as the Image object lives. For a 5 MB JPEG, this is ~6.7 MB of string data, on top of the decoded pixel buffer.

**In contrast**, `selectFolderImage` correctly uses `URL.createObjectURL` + `URL.revokeObjectURL` (lines 848-856), which is more memory-efficient.

### 4. Canvas Backing Stores — 4 Full-Resolution Canvases

**File:** `script.js:238-241`
```js
sourceCanvas.width = imageWidth;
sourceCanvas.height = imageHeight;
pointsCanvas.width = imageWidth;
pointsCanvas.height = imageHeight;
```

Both `sourceCanvas` and `pointsCanvas` are set to the **full original image resolution**. Each canvas has a GPU-backed pixel buffer. For a 4000×3000 image:
- `sourceCanvas`: 48 MB
- `pointsCanvas`: 48 MB
- `gridCanvas` (if enabled, via `drawGrid`): 48 MB
- Plus any temp canvases from correction

Total: **144-192+ MB** of canvas buffers per image.

When canvas dimensions are changed (on new image load), browsers *should* release old buffers, but this is implementation-dependent and may not happen synchronously.

### 5. Grid Overlay Reads Full ImageData Every Draw

**File:** `index.html:259`
```js
const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
```

When the grid overlay is enabled, `drawGrid()` reads the **entire source canvas** into a temporary `ImageData` to compute average brightness. For a 4000×3000 image, this is another 48 MB allocation. This is called on every `setupCanvas()` and after every correction.

### 6. Folder Browser Flow — Memory Timeline

For each image in the folder browser auto-save workflow:

| Step | Allocation | Size (4000×3000) |
|------|-----------|-------------------|
| `selectFolderImage` → `new Image()` | Decoded image pixels | ~48 MB |
| `setupCanvas` → canvas resize | sourceCanvas + pointsCanvas buffers | ~96 MB |
| `setupCanvas` → `getImageData` | `originalImageData` | ~48 MB |
| `drawGrid` (if enabled) → `getImageData` | Temporary ImageData | ~48 MB |
| `applyPerspectiveCorrection` → `getImageData` | Source pixels read | ~48 MB |
| Correction → temp canvas + `destImageData` | `transformedImageData` | ~48 MB |
| `applySharpen` (complex path) → copy + `getImageData` | Two temp copies | ~96 MB |

Peak memory during correction of a single 4000×3000 image can reach **400+ MB**. Between images, the minimum retained is ~192 MB (two canvas buffers + `originalImageData`).

### 7. What IS Properly Cleaned Up

- **Object URLs** in `selectFolderImage`: `URL.revokeObjectURL(url)` is called at line 856
- **`transformedImageData`**: Set to `null` in `resetAllPoints()` (line 897)
- **`points` array**: Reset to `[]` in both `resetAllPoints` (line 892) and `setupCanvas` (line 268)
- **Event listeners on folder list items**: `innerHTML = ''` in `renderFolderImageList` (line 828) removes old DOM + listeners
- **`image` variable**: Old Image object is overwritten when new one loads, becoming eligible for GC

### 8. What Is NOT Cleaned Up Proactively

- **`originalImageData`** is never set to `null` before `setupCanvas` creates a new one — briefly two copies coexist
- **Canvas backing stores** are not explicitly zeroed before resize (setting `width`/`height` does reset, but GPU memory release timing varies)
- **`transformedImageData.canvas`** (a detached DOM canvas) persists until `resetAllPoints` — not freed at the moment the new image starts loading
- **The `image` variable's decoded pixel data** may linger if GC is delayed

## Code References

- `script.js:61` — `let image = null` (module-level Image reference)
- `script.js:66` — `let transformedImageData = null` (module-level, holds temp canvas)
- `script.js:67` — `let originalImageData = null` (module-level, holds full ImageData)
- `script.js:214-283` — `setupCanvas()` — allocates canvas buffers + ImageData
- `script.js:266` — `originalImageData = sourceCtx.getImageData(...)` — 48MB+ allocation
- `script.js:841-871` — `selectFolderImage()` — image loading flow
- `script.js:891-921` — `resetAllPoints()` — cleanup of transformedImageData
- `script.js:187-211` — `handleImageUpload()` — uses data URL (not object URL)
- `simplePerspectiveApply.js:34-37` — temp canvas creation
- `simplePerspectiveApply.js:39` — `getImageData` of full source (another 48MB read)
- `complexPerspectiveApply.js:44-46` — `getImageData` of full source
- `complexPerspectiveApply.js:687` — `applySharpen` creates Uint8ClampedArray copy
- `index.html:259` — grid `drawGrid` reads full `getImageData` for brightness calc

## Architecture Documentation

### Memory-Relevant Module Boundaries

All large allocations are concentrated in `script.js` (the main orchestrator) and the two correction modules. The correction modules receive `sourceCtx` and return objects containing temp canvases. The main module retains these return values in `transformedImageData`.

The `folderBrowser.js` module is thin — it handles file I/O only and does not retain image data. Memory management responsibility falls entirely on `script.js`.

### Data Flow for Folder Browser (the slow path)

```
selectFolderImage(i)
  → loadImageFile(handle)        [File object, small]
  → URL.createObjectURL(file)    [blob URL, efficient]
  → new Image() + img.src = url  [decodes into GPU memory]
  → img.onload:
      → image = img              [old Image eligible for GC]
      → setupCanvas()            [allocs: canvas buffers + originalImageData]
      → resetAllPoints()         [frees: transformedImageData]
      → URL.revokeObjectURL(url) [frees: blob URL]
      → denormalizePoints(...)   [restores points from previous image]
```

The correction + save + advance flow:
```
applyPerspectiveCorrection()
  → applySimple/Complex(...)     [allocs: temp canvas, ImageData, destImageData]
  → transformedImageData = result [retains temp canvas]
  → handleSaveToOut()
      → saveToOut(sourceCanvas)  [reads sourceCanvas, creates blob]
      → selectFolderImage(next)  [triggers full cycle above]
```

## Open Questions

- What specific image dimensions/file sizes is the user working with? Larger images amplify all of these effects proportionally.
- Is the grid overlay enabled during batch processing? It adds an extra full-resolution `getImageData` per image.
- Is the browser's memory limit being approached, causing the GC to run more aggressively (and more slowly)?
- Could canvas context loss be occurring (browser reclaiming GPU memory), forcing re-upload on next draw?
