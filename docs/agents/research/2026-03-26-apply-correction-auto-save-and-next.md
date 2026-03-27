---
date: 2026-03-26T19:11:25Z
git_commit: ee3cc6afa28008568d235af2494dcabe0d7ef1ab
branch: main
topic: "Apply Correction auto-save to out/ and auto-load next image"
tags: [research, codebase, apply-correction, save-to-out, folder-browser, workflow]
status: complete
---

# Research: Apply Correction auto-save to out/ and auto-load next image

## Research Question

Clicking "Apply Correction" should also trigger the Download (to "out"), and then automatically load the next image.

## Summary

The codebase already has all the building blocks for this workflow. Currently, "Apply Correction" and "Save to Out" are separate user actions. The "Save to Out" button already auto-advances to the next image after saving. To achieve the desired behavior, the `applyPerspectiveCorrection` function needs to chain into the `handleSaveToOut` logic after a successful correction — but only when a folder is open and an image is selected from that folder.

## Detailed Findings

### 1. Apply Correction Flow

The "Apply Correction" button (`transformBtn`) is wired up in `init()` at `script.js:69`:

```js
if (transformBtn) transformBtn.addEventListener('click', applyPerspectiveCorrection);
```

The `applyPerspectiveCorrection` function (`script.js:369-395`) does:
1. Validates that `image` exists and `points.length >= 4`
2. Calls `orderPoints(points)` to sort points by angle from centroid
3. Routes to `applySimplePerspective()` (4 points) or `applyComplexPerspective()` (5+ points)
4. Enables the print button
5. Redraws the grid overlay

Both `applySimplePerspective` (`script.js:398-403`) and `applyComplexPerspective` (`script.js:406-411`) store the result in `transformedImageData` and enable `saveToOutBtn` when a folder is open.

**Key detail**: `applyPerspectiveCorrection` is synchronous — it does not return a Promise. The perspective transforms themselves (`applySimple`/`applyComplex`) are also synchronous, returning `transformedImageData` directly.

### 2. Save to Out Flow

The "Save to Out" button (`saveToOutBtn`) is wired at `script.js:84`:

```js
saveToOutBtn.addEventListener('click', handleSaveToOut);
```

The `handleSaveToOut` function (`script.js:482-511`) does:
1. Validates `transformedImageData?.canvas` exists
2. Validates `folderHandle` and `currentFolderImageIndex >= 0`
3. Derives output filename from source name (e.g., `scan001.jpg` → `scan001.png`)
4. Calls `saveToOut(folderHandle, outName, transformedImageData.canvas)` — writes PNG to `<folder>/out/`
5. On success: calls `getNextImageIndex()` to compute the next index (wraps to 0 after last)
6. If next index differs from current: calls `selectFolderImage(nextIndex)` to load the next image

This function is `async` and uses the File System Access API.

### 3. Folder Browser Module (`folderBrowser.js`)

Provides the following exports used in the workflow:

| Function | Location | Purpose |
|---|---|---|
| `openFolder()` | `folderBrowser.js:17-29` | Prompts user to pick a folder, returns `{dirHandle, imageFiles}` |
| `loadImageFile(handle)` | `folderBrowser.js:34-36` | Returns `File` from a `FileSystemFileHandle` |
| `saveToOut(dirHandle, filename, canvas)` | `folderBrowser.js:43-57` | Saves canvas as PNG to `<folder>/out/<filename>`, creates `out/` dir if needed |
| `getNextImageIndex(current, total)` | `folderBrowser.js:64-67` | Returns `(current + 1) % total`, or `-1` if total is 0 |
| `deriveOutputFilename(name)` | `folderBrowser.js:74-78` | Strips extension, appends `.png` |
| `isSupported()` | `folderBrowser.js:7-9` | Checks for File System Access API |

### 4. Image Loading via Folder (`selectFolderImage`)

`selectFolderImage(index)` at `script.js:454-480`:
1. Sets `currentFolderImageIndex = index`
2. Gets the file via `loadImageFile(handle)`
3. Reads as DataURL, creates an `Image`, sets `image = img`
4. Calls `setupCanvas()` and `resetAllPoints()` — this clears all points and resets state
5. Disables `saveToOutBtn` (since no correction has been applied yet)
6. Re-renders the folder image list (highlights the new active item)

### 5. Download Flow (browser download, NOT "save to out")

The "Download Corrected Image" button uses `downloadCorrectedImage` (`download.js:1-56`):
- Creates an export canvas, copies corrected image onto white background
- Generates a data URL PNG and triggers a browser download via a temporary `<a>` element
- Filename format: `corrected-document-YYYY-MM-DDTHH-MM-SS.png`

This is the standard browser download, distinct from "Save to Out" which writes directly to the filesystem via the File System Access API.

### 6. State Variables Involved

From `script.js:36-46`:

| Variable | Type | Role |
|---|---|---|
| `image` | `Image \| null` | Currently loaded image |
| `points` | `Array<{x,y}>` | User-selected corner points |
| `transformedImageData` | `object \| null` | Result of perspective correction (has `.canvas` property) |
| `folderHandle` | `FileSystemDirectoryHandle \| null` | Currently open folder |
| `folderImages` | `Array<{name, handle}>` | Image files in the folder, sorted alphabetically |
| `currentFolderImageIndex` | `number` | Index into `folderImages`, `-1` if none selected |

### 7. Conditions for Auto-Save-and-Advance

For the "Apply Correction" button to also save to out and advance, the following must be true:
- `folderHandle !== null` — a folder is open
- `currentFolderImageIndex >= 0` — an image was selected from that folder
- `transformedImageData?.canvas` exists — correction succeeded

These are already checked separately in `applySimplePerspective`/`applyComplexPerspective` (for enabling `saveToOutBtn`) and in `handleSaveToOut` (for validation).

### 8. Current Two-Step User Workflow (Folder Mode)

1. User clicks "Open Folder" → folder picker → images listed → first image loaded
2. User adds 4+ points on the image
3. User clicks "Apply Correction" → perspective transform runs → "Save to Out" button becomes enabled
4. User clicks "Save to Out" → image saved to `out/` → next image auto-loaded
5. Repeat from step 2

### 9. Desired Single-Step Workflow

1. User clicks "Open Folder" → folder picker → images listed → first image loaded
2. User adds 4+ points on the image
3. User clicks "Apply Correction" → perspective transform runs → image auto-saved to `out/` → next image auto-loaded
4. Repeat from step 2

## Code References

- `script.js:69` — transformBtn click listener registration
- `script.js:369-395` — `applyPerspectiveCorrection()` function
- `script.js:398-403` — `applySimplePerspective()` wrapper
- `script.js:406-411` — `applyComplexPerspective()` wrapper
- `script.js:482-511` — `handleSaveToOut()` — saves to out/ and advances to next image
- `script.js:454-480` — `selectFolderImage(index)` — loads an image from the folder
- `folderBrowser.js:43-57` — `saveToOut()` — writes canvas to filesystem
- `folderBrowser.js:64-67` — `getNextImageIndex()` — computes next index with wraparound
- `folderBrowser.js:74-78` — `deriveOutputFilename()` — converts source name to PNG name
- `download.js:1-56` — `downloadCorrectedImage()` — browser download (not filesystem save)

## Architecture Documentation

The app has two distinct "download" paths:
1. **Browser download** (`download.js`): Traditional browser download via data URL and `<a>` click. Always available after correction.
2. **Save to Out** (`folderBrowser.js` + `script.js`): File System Access API write to `<folder>/out/`. Only available in folder-browser mode (Chrome/Edge). Already includes auto-advance to next image.

The folder browser feature is gated behind `isSupported()` (checks for `showDirectoryPicker`), so it only appears in Chrome/Edge. The entire folder browser UI section is hidden by default (`style="display:none"`) and shown only when the API is available.

## Open Questions

- Should the auto-save behavior only apply in folder-browser mode, or should the standard browser download also trigger on "Apply Correction"?
- Should there be a user-visible option/toggle to enable/disable auto-save-on-apply, in case the user wants to review the correction before saving?
- If the correction fails (exception in perspective transform), the current flow catches the error and shows a message — no save should occur. This is already handled by the try/catch in `applyPerspectiveCorrection`.
