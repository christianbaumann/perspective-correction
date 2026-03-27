---
date: 2026-03-27T05:38:50.979492+00:00
git_commit: ee3cc6afa28008568d235af2494dcabe0d7ef1ab
branch: main
topic: "How selected points behave when 'Apply Corrections' is clicked"
tags: [research, codebase, points, apply-correction, perspective-transform]
status: complete
---

# Research: How selected points behave when "Apply Corrections" is clicked

## Research Question
What happens to the user's selected points when clicking "Apply Corrections"? Should the points be kept from the previous image after applying corrections?

## Summary

When the user clicks "Apply Correction", the `applyPerspectiveCorrection()` function in `script.js` is invoked. **The `points` array is never cleared during the correction flow itself.** However, the `pointsCanvas` has its `pointerEvents` set to `'none'` by both `applySimplePerspective()` and `applyComplexPerspective()`, which effectively disables all further point interaction (add/move/delete) after a correction is applied. The points remain in memory but become invisible/unreachable to the user because the points overlay canvas no longer responds to mouse events. The `drawPoints()` function is not called after the correction, so the visual point markers disappear when the source canvas is cleared and redrawn with the corrected image.

The points are only explicitly cleared in two places:
1. `setupCanvas()` (line 204): sets `points = []` — called when a **new image** is loaded
2. `resetAllPoints()` (line 521): sets `points = []` — called when the user clicks "Reset All Points"

## Detailed Findings

### The `points` array lifecycle

- **Declaration**: `script.js:37` — `let points = [];`
- **Points added**: `script.js:286` — in `handleCanvasMouseDown()` when `mode === 'add'`
- **Points moved**: `script.js:301-302` — in `handleCanvasMouseMove()` when dragging
- **Points deleted**: `script.js:271` — in `handleCanvasMouseDown()` when `mode === 'delete'`
- **Points cleared**: `script.js:204` (`setupCanvas()`) and `script.js:521` (`resetAllPoints()`)

### The "Apply Correction" flow (`applyPerspectiveCorrection`)

**Location**: `script.js:369-400`

1. Checks that `image` exists and `points.length >= 4`
2. Calls `orderPoints(points)` from `helpers.js` — this sorts points by angle from centroid, starting with the top-left point. **This does not mutate the original `points` array**; it returns a new sorted array.
3. Routes to either:
   - `applySimplePerspective(orderedPoints)` if exactly 4 points
   - `applyComplexPerspective(orderedPoints)` if 5+ points
4. After correction, redraws the grid overlay if enabled
5. In folder-browser mode, auto-saves to `out/` and loads the next image

**Critical observation**: At no point in this flow is the `points` array cleared or `drawPoints()` called. The points remain in the `points` array in memory.

### What `applySimplePerspective` does to the canvas

**Location**: `simplePerspectiveApply.js:76-84`

```js
sourceCtx.clearRect(0, 0, pointsCanvas.width, pointsCanvas.height);
sourceCtx.drawImage(tempCanvas, minX, minY, destWidth, destHeight);
// draws a green border
pointsCanvas.style.pointerEvents = 'none';  // ← disables point interaction
downloadBtn.disabled = false;
```

- Clears the entire source canvas and redraws with the corrected image
- **Sets `pointsCanvas.style.pointerEvents = 'none'`** — this blocks all mouse events on the points canvas, preventing the user from adding, moving, or deleting points
- Does NOT clear the `pointsCanvas` drawing (the point markers from the last `drawPoints()` call remain visually, overlaid on the corrected image)

### What `applyComplexPerspective` does to the canvas

**Location**: `complexPerspectiveApply.js:102-106`

```js
sourceCtx.clearRect(0, 0, pointsCanvas.width, pointsCanvas.height);
sourceCtx.drawImage(canvas, 0, 0);
pointsCanvas.style.pointerEvents = 'none';  // ← disables point interaction
downloadBtn.disabled = false;
```

Same behavior as simple: clears source canvas, redraws with corrected image, disables pointer events on points canvas.

### Where points ARE cleared

1. **`setupCanvas()`** (`script.js:204`):
   ```js
   points = [];
   selectedPointIndex = -1;
   ```
   Called by: `handleImageUpload()` (line 139), `loadSampleImage()` (line 117), `selectFolderImage()` (line 470)

2. **`resetAllPoints()`** (`script.js:520-548`):
   ```js
   points = [];
   selectedPointIndex = -1;
   isDragging = false;
   transformedImageData = null;
   ```
   Also restores the original image from `originalImageData`, re-enables `pointsCanvas.style.pointerEvents = 'all'`, and disables download/print buttons.
   Called by: `handleImageUpload()` (line 140), `selectFolderImage()` (line 471), and the Reset button click handler (line 71)

### Where `pointerEvents` is re-enabled

Only in `resetAllPoints()` (`script.js:534`):
```js
pointsCanvas.style.pointerEvents = 'all';
```

This means the only way a user can interact with the points canvas again after applying a correction is to click "Reset All Points", which also clears all points and restores the original image.

### Folder browser flow and point retention

In folder-browser mode (`script.js:392-394`), after applying corrections:
```js
if (folderHandle && currentFolderImageIndex >= 0) {
    handleSaveToOut();
}
```

`handleSaveToOut()` saves the corrected image, then calls `selectFolderImage(nextIndex)` which in turn calls `setupCanvas()` and `resetAllPoints()`, clearing all points for the next image.

## Code References

- `script.js:37` — `points` array declaration
- `script.js:204` — `points = []` in `setupCanvas()`
- `script.js:286` — Point addition in `handleCanvasMouseDown()`
- `script.js:369-400` — `applyPerspectiveCorrection()` function
- `script.js:403-408` — `applySimplePerspective()` wrapper
- `script.js:411-416` — `applyComplexPerspective()` wrapper
- `script.js:520-548` — `resetAllPoints()` function
- `simplePerspectiveApply.js:76-84` — Canvas clearing and pointer events disabled
- `complexPerspectiveApply.js:102-106` — Canvas clearing and pointer events disabled
- `helpers.js:2-35` — `orderPoints()` function (returns new array, does not mutate)

## Architecture Documentation

### State flow after "Apply Correction"

```
User clicks "Apply Correction"
  → applyPerspectiveCorrection()
    → orderPoints(points)           // creates sorted copy; `points` unchanged
    → applySimple/ComplexPerspective(orderedPoints)
      → sourceCtx.clearRect(...)    // clears source canvas
      → sourceCtx.drawImage(...)    // draws corrected image
      → pointsCanvas.pointerEvents = 'none'  // disables point interaction
      → downloadBtn.disabled = false
    → drawGrid() if enabled
    → (folder mode) handleSaveToOut() → selectFolderImage() → setupCanvas() + resetAllPoints()
```

### Points are retained in memory but inaccessible

After correction, the `points` array still holds all original point coordinates. However:
- The `pointsCanvas` has `pointerEvents: none`, so no mouse events reach the canvas handlers
- The points drawn on `pointsCanvas` remain visually (they are not cleared by the correction functions)
- The only way to re-enable point interaction is `resetAllPoints()`, which also clears the points

### No mechanism to re-use points on a new image

When a new image is loaded (via upload, paste, or folder selection), both `setupCanvas()` and `resetAllPoints()` are called, which reset `points = []`. There is currently no mechanism to preserve points across image loads.

## Open Questions

- When the user says "keep the selected points from the previous image", do they mean:
  - (A) After applying correction on the **same** image, they want to see the points still drawn and be able to adjust and re-apply?
  - (B) When loading a **new/next** image (especially in folder-browser mode), they want the point positions from the previous image to be reused on the new image?
  - (C) Both — retain points after correction AND when switching images?
