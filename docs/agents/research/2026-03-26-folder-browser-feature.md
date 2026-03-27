---
date: 2026-03-26T18:17:28.591297+00:00
git_commit: ee3cc6afa28008568d235af2494dcabe0d7ef1ab
branch: main
topic: "Add folder browser in bottom-left corner: open local folder, select images, save to 'out' subfolder"
tags: [research, codebase, folder-browser, file-system-api, left-panel, download, image-loading]
status: complete
---

# Research: Folder Browser Feature in Bottom-Left Corner

## Research Question
In the bottom left corner (screenshot), add an area where I can open/display a folder from the local harddisk. I want to select an image from there, that's then being displayed, can be edited and saved. Images shall be saved in a subfolder "out" of the opened folder.

## Summary

The screenshot shows the left panel (`left-panel`) with controls stacked at the top and a large empty area at the bottom. This empty space is the natural insertion point for the folder browser. The feature requires the **File System Access API** (`showDirectoryPicker()`) — a modern browser API available in Chrome/Edge that allows reading a directory listing and writing files back to disk, including to subfolders. The existing image loading pipeline (`handleImageUpload` in `script.js`) and download pipeline (`download.js`) provide the hooks needed to integrate folder-based loading and saving.

---

## Detailed Findings

### 1. Left Panel Layout (Bottom-Left Empty Space)

**File**: `index.html:111–172`, `styles.css:64–73`

The left panel is a `<section class="left-panel">` with:
- `max-width: 300px`, `overflow-y: auto`, `padding: 8px`
- Contents (top to bottom):
  1. `<h2 class="panel-title">Controls</h2>`
  2. Upload Image `.control-group` (file-upload drag-drop area + hidden `<input type="file">`)
  3. Point Selection Mode `.control-group` (Add/Move/Delete buttons + point counter)
  4. Download + Reset buttons `.control-group`
  5. Status message `.status#statusMessage`
- After the status message there is **no more content** — the panel is `overflow-y: auto` with `flex: 1`, so content naturally fills from the top down, leaving empty space at the bottom.

The folder browser would be appended as a new `.control-group` after `#statusMessage`, occupying the currently empty bottom area.

### 2. Existing Image Loading Pipeline

**File**: `script.js:112–130`

```js
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            image = img;
            setupCanvas();
            resetAllPoints();
            statusMessage.textContent = `Image loaded (${img.naturalWidth}×${img.naturalHeight}px)...`;
            statusMessage.className = "status success";
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
```

This function accepts a `File` object from a `<input type="file">` change event. A folder browser can call the same `setupCanvas()` path by reading a `File` from a `FileSystemFileHandle` (File System Access API) and dispatching a synthetic change event, or by directly calling the shared image-loading logic.

The key state variables set after loading (`script.js:29–36`):
- `image` — the loaded `Image` object
- `originalImageData` — captured in `setupCanvas()` at line 185
- `displayScale` — computed in `setupCanvas()` at line 163

### 3. Existing Download/Save Pipeline

**File**: `download.js:1–56`

Current save mechanism:
1. Takes `transformedImageData.canvas` (the corrected canvas)
2. Creates a temporary export canvas, fills white, draws corrected image
3. Calls `canvas.toDataURL("image/png", 1.0)`
4. Creates a `<a download="corrected-document-{timestamp}.png">` element and `.click()` it

This triggers a **browser download** to the user's Downloads folder — it does **not** write to a specific filesystem location. To save to an `out/` subfolder of the opened folder, the File System Access API must be used instead of `link.download`.

### 4. File System Access API — What It Provides

**No existing usage in this codebase.** This is a browser-native API (Chrome/Edge 86+, not Firefox as of 2026).

Key methods needed for the folder browser feature:

| Method | Purpose |
|--------|---------|
| `window.showDirectoryPicker()` | Prompts user to pick a folder; returns `FileSystemDirectoryHandle` |
| `dirHandle.values()` | Async iterator over `FileSystemHandle` entries in the folder |
| `fileHandle.getFile()` | Returns a `File` object (same as from `<input type="file">`) |
| `dirHandle.getDirectoryHandle('out', {create: true})` | Gets or creates `out/` subfolder |
| `outDirHandle.getFileHandle('name.png', {create: true})` | Creates a new file in `out/` |
| `writable = await fileHandle.createWritable()` | Opens a write stream |
| `writable.write(blob)` + `writable.close()` | Writes PNG blob to disk |

The `File` objects returned by `fileHandle.getFile()` are identical to those from `<input type="file">`, so the existing `FileReader` + `Image` loading path in `handleImageUpload` works unchanged.

To write PNG data: `exportCanvas.toBlob()` produces a `Blob`, which can be passed to `writable.write(blob)`.

### 5. Module Structure for Integration

**File**: `script.js:1–8` (imports), `index.html:320` (`<script type="module" src="script.js">`)

All JS is ES modules loaded directly by the browser. A new module (e.g., `folderBrowser.js`) would:
- Export a `initFolderBrowser(deps)` function receiving shared state references
- Handle `showDirectoryPicker()`, directory listing, file selection, and `out/` save logic
- Import into `script.js` alongside existing imports

The `init()` function in `script.js:50–76` is where all event listener wiring happens — this is where `initFolderBrowser` would be called.

### 6. Button/UI Pattern in the Existing Codebase

**File**: `styles.css:125–178`, `index.html:156–167`

Existing button pattern:
```html
<button class="btn btn-download" id="downloadBtn" disabled>
    <svg ...>...</svg> Download Corrected Image
</button>
```

CSS classes available: `.btn`, `.btn-download` (green), `.btn-reset` (red), `.btn-print` (blue/indigo), `.btn-grid` (purple). A new `.btn-folder` variant with an appropriate color (e.g., teal/orange) would follow this pattern.

The `.control-label` class (`styles.css:100–106`) is used for section labels above controls. The `.file-upload` class (`styles.css:108–118`) gives the dashed-border upload zone appearance.

### 7. Current File List (for context)

```
complexPerspectiveApply.js   helpers.js           perspectiveTransform.js
download.js                  imageInterpolation.js printCorrectedDocument.js
index.html                   mvc.js               script.js
server.js                    seo-loader.js        simplePerspectiveApply.js
styles.css
```

No `folderBrowser.js` currently exists.

---

## Code References

- `index.html:111–172` — Left panel HTML structure (where folder browser section goes)
- `index.html:320` — Module script entry point `<script type="module" src="script.js">`
- `styles.css:64–73` — `.left-panel` CSS (flex, overflow-y: auto)
- `styles.css:96–106` — `.control-group` and `.control-label` patterns
- `styles.css:108–118` — `.file-upload` dashed-border zone pattern
- `styles.css:125–178` — `.btn` and color-variant classes
- `script.js:1–8` — ES module imports (where new folderBrowser import goes)
- `script.js:29–36` — State variables (`image`, `displayScale`, `transformedImageData`, etc.)
- `script.js:50–76` — `init()` function — central wiring point for new feature
- `script.js:112–130` — `handleImageUpload()` — existing image loading via FileReader
- `script.js:132–198` — `setupCanvas()` — canvas setup after image is loaded
- `download.js:1–56` — Current download mechanism (data URL + `<a>` click)
- `server.js:1–53` — Static file server (serves JS modules; no save endpoint needed)

---

## Architecture Documentation

### Current Image Flow
```
User picks file → <input type="file"> → FileReader.readAsDataURL()
  → new Image().src = dataURL → setupCanvas() → sourceCtx.drawImage()
```

### Current Save Flow
```
transformedImageData.canvas → toDataURL("image/png") → <a download> click
  → Browser downloads to system Downloads folder
```

### Proposed Folder Browser Flow
```
"Open Folder" btn → showDirectoryPicker() → FileSystemDirectoryHandle
  → iterate entries → filter image files (jpg/png/webp)
  → display list of filenames in panel
  → user clicks filename → fileHandle.getFile() → FileReader → setupCanvas() [same path]
  → user corrects image → "Save to Out" btn
  → dirHandle.getDirectoryHandle('out', {create: true})
  → outDir.getFileHandle(name, {create: true}) → createWritable()
  → exportCanvas.toBlob() → writable.write(blob) → writable.close()
```

### Key Constraint
The `showDirectoryPicker()` API requires a **user gesture** (button click) to invoke. The `dirHandle` must be stored in module state to be reused for the save step. Browser security requires the same origin — no cross-origin access. Works in **Chrome/Edge 86+**; Firefox does not support `showDirectoryPicker()` as of early 2026.

---

## Open Questions

1. **Current image filename tracking**: `handleImageUpload` does not store the original filename anywhere in module state. For the save path, the output filename should derive from the source image name (e.g., `original.jpg` → `out/original.png`). This requires passing the filename through when loading from the folder.
2. **Folder browser persistence**: Should the folder handle persist across page reloads? The File System Access API supports `indexedDB`-based persistence of handles, but this is not currently used in the project.
3. **Image list filtering**: The folder may contain non-image files. Filtering by extension (`.jpg`, `.jpeg`, `.png`, `.webp`) in the directory listing is needed.
4. **Save button state**: The save-to-folder button should only be enabled when both `transformedImageData` is available AND a folder has been opened (i.e., `dirHandle` is non-null).
