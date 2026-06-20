---
date: 2026-04-13T12:13:09Z
git_commit: be98d477bcdcc71db90f50906edc228fcc26648b
branch: main
topic: "Keyboard shortcuts (Enter save, Arrow nav) and save-file naming collision logic"
tags: [research, codebase, folderBrowser, script, keyboard, shortcuts]
status: complete
---

# Research: Keyboard Shortcuts and Save-File Naming

## Research Question

Implement the following keyboard shortcuts and save-naming behavior:
- **Enter** → Save the image (currently: triggers "Apply correction")
- **Arrow Right** → Open next image in folder
- **Arrow Left** → Open previous image in folder
- If output file with same name already exists, rename the *existing* file by appending `_0`; if `_0` already exists (and potentially `_1`, `_2`, …, `_n`), append `_(n+1)` to the new file being saved.

## Summary

The app has one keyboard listener and no arrow-key handling. The folder-browser save flow calls `saveToOut()` which overwrites without checking for existing files. There is no "previous image" helper function. All changes needed span `script.js` (keyboard handler, new helpers), `folderBrowser.js` (save-collision logic, `getPrevImageIndex`), and potentially `index.html` (button label if Enter is re-mapped).

---

## Detailed Findings

### 1. Existing Keyboard Handler (`script.js:167–172`)

```js
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.target.matches('input, textarea, select, button')) {
        e.preventDefault();
        applyPerspectiveCorrection();
    }
});
```

- A single `keydown` listener on `document`.
- Enter currently calls `applyPerspectiveCorrection()` (not a save).
- No `ArrowRight` / `ArrowLeft` handling exists anywhere.
- Guard condition `!e.target.matches('input, textarea, select, button')` prevents accidental firing when a button/input has focus.

### 2. Current "Save" Flow (`script.js:1016–1037`, `folderBrowser.js:43–63`)

`handleSaveToOut()` in `script.js`:
1. Derives output filename: `deriveOutputFilename(folderImages[currentFolderImageIndex].name)` (strips extension, appends `.png`) — `folderBrowser.js:80–84`.
2. Calls `saveToOut(folderHandle, filename, sourceCanvas)` — `folderBrowser.js:43`.
3. `saveToOut` calls `outDir.getFileHandle(filename, { create: true })`, which **silently overwrites** any existing file with the same name.
4. After saving, auto-advances to next image via `selectFolderImage(nextIndex)`.

There is **no existence check** before writing. The File System Access API's `getFileHandle({ create: true })` simply creates or replaces.

The save is also auto-triggered from `applyPerspectiveCorrection()` at `script.js:848` when a folder is open:
```js
if (folderHandle && currentFolderImageIndex >= 0) {
    savedNormalizedPoints = normalizePoints(points, sourceCanvas.width, sourceCanvas.height);
    handleSaveToOut().then(() => { ... });
}
```

### 3. Navigation: Next Image (`folderBrowser.js:70–73`, `script.js:1028–1031`)

`getNextImageIndex(currentIndex, total)` in `folderBrowser.js`:
```js
export function getNextImageIndex(currentIndex, total) {
    if (total === 0) return -1;
    return (currentIndex + 1) % total;
}
```
- Wraps around (last → first).
- Used in `handleSaveToOut` (auto-advance) and `selectFolderImage` (prefetch).

**No `getPrevImageIndex` function exists** anywhere in the codebase.

### 4. `selectFolderImage(index)` (`script.js:942–1014`)

This is the central function for loading any image by index. It:
1. Sets `currentFolderImageIndex = index`
2. Disables the `saveToOutBtn`
3. Calls `renderFolderImageList()` to update the sidebar highlight
4. Loads and decodes the image (uses prefetch bitmap if available)
5. Calls `setupCanvas()` then `resetAllPoints()`
6. Restores `savedNormalizedPoints` (denormalized for new image dimensions)
7. Hides loading overlay, updates status message
8. Kicks off `prefetchNextImage(nextIdx)` for the *next* image

Note: prefetch is currently only triggered for the **next** image, not the previous one.

### 5. `saveToOut` collision behavior (`folderBrowser.js:43–63`)

```js
export async function saveToOut(dirHandle, filename, canvas) {
    const outDir = await dirHandle.getDirectoryHandle('out', { create: true });
    const fileHandle = await outDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    ...
}
```

- `getDirectoryHandle('out', { create: true })` creates `out/` if absent.
- `getFileHandle(filename, { create: true })` creates **or replaces** — no collision detection.

To implement collision logic, the `out/` directory handle would need to be iterated (using `outDir.values()`) to check for existing files before deciding on the final name. The `FileSystemDirectoryHandle` iteration API (same as used in `openFolder`) supports this.

### 6. `deriveOutputFilename` (`folderBrowser.js:80–84`)

```js
export function deriveOutputFilename(sourceFilename) {
    const lastDot = sourceFilename.lastIndexOf('.');
    const base = lastDot >= 0 ? sourceFilename.slice(0, lastDot) : sourceFilename;
    return base + '.png';
}
```

Converts e.g. `scan001.jpg` → `scan001.png`. The base name (without extension) is the key unit for collision detection.

### 7. State Variables Needed for Keyboard Nav (`script.js:74–84`)

```js
let folderHandle = null;      // set by handleOpenFolder
let folderImages = [];        // array of { name, handle }
let currentFolderImageIndex = -1;
```

Arrow-key handlers will need to check `folderHandle !== null && folderImages.length > 0` before acting.

### 8. `saveToOutBtn` Enabled/Disabled State

- Disabled immediately on `selectFolderImage` call (`script.js:944`).
- Re-enabled? — Not explicitly re-enabled in `handleSaveToOut`. The button is only enabled when correction is applied (search needed).

```
grep: saveToOutBtn.disabled = false  → not found in current codebase
```

The button is likely enabled in `applyPerspectiveCorrection` or similar — but the keyboard Enter → save shortcut would need to guard against saving when no transformation has been applied.

---

## Code References

| Location | Description |
|---|---|
| `script.js:167–172` | Single `keydown` listener (Enter → `applyPerspectiveCorrection`) |
| `script.js:844–853` | Auto-save+advance triggered from `applyPerspectiveCorrection` when folder is open |
| `script.js:1016–1037` | `handleSaveToOut()` — derives filename, calls `saveToOut`, then auto-advances |
| `script.js:942–1014` | `selectFolderImage(index)` — loads image by index, restores points, prefetches next |
| `script.js:928–940` | `renderFolderImageList()` — rebuilds sidebar, highlights `currentFolderImageIndex` |
| `script.js:908–926` | `handleOpenFolder()` — opens folder, populates `folderImages`, loads first image |
| `script.js:74–84` | Folder browser state: `folderHandle`, `folderImages`, `currentFolderImageIndex` |
| `folderBrowser.js:43–63` | `saveToOut()` — writes PNG to `out/`, **no collision detection** |
| `folderBrowser.js:70–73` | `getNextImageIndex()` — wraps around (last → first) |
| `folderBrowser.js:80–84` | `deriveOutputFilename()` — strips ext, appends `.png` |

---

## Architecture Documentation

### What needs to be added / changed

**`folderBrowser.js`:**
1. **`getPrevImageIndex(currentIndex, total)`** — mirror of `getNextImageIndex`, wraps backward: `(currentIndex - 1 + total) % total`.
2. **`saveToOutWithCollisionHandling(dirHandle, filename, canvas)`** (or modify `saveToOut`) — before writing, enumerate `out/` directory contents, find existing files matching the base name pattern, rename the existing file to `base_0.png` (or `base_(n+1).png` if numbered variants exist), then write the new file as `filename`.

**`script.js`:**
3. **Import `getPrevImageIndex`** from `folderBrowser.js`.
4. **Extend `keydown` listener** to handle:
   - `Enter` → if folder is open and `saveToOutBtn` not disabled, call `handleSaveToOut()`; otherwise fall through to `applyPerspectiveCorrection()` (or separate the two actions entirely).
   - `ArrowRight` → if folder is open, call `selectFolderImage(getNextImageIndex(currentFolderImageIndex, folderImages.length))`.
   - `ArrowLeft` → if folder is open, call `selectFolderImage(getPrevImageIndex(currentFolderImageIndex, folderImages.length))`.

### Collision naming algorithm (required logic)

Given base name `scan001` and new file `scan001.png`:
1. List all files in `out/` matching `scan001*.png`.
2. If `scan001.png` does **not** exist → write as `scan001.png` (no collision).
3. If `scan001.png` **exists**:
   - Find all files matching `scan001_<N>.png` where `<N>` is a non-negative integer.
   - If none found → rename existing `scan001.png` to `scan001_0.png`, write new file as `scan001.png`.
   - If found → max `N` = n → rename existing `scan001.png` to `scan001_(n+1).png`, write new file as `scan001.png`.

The File System Access API supports renaming via `move()` on a `FileSystemFileHandle` in some browsers, but this is not universally available. The safe approach is to read the existing file, write it under the new name, delete the old one, then write the new file.

---

## Clarifications (follow-up)

- **Enter** = apply correction + save, unchanged. No remapping needed.
- **Auto-advance after save must be removed.** Navigation is now manual via Arrow keys only.
- Arrow keys should use the same focus guard as Enter (`!e.target.matches('input, textarea, select, button')`).

## `saveToOutBtn` is never re-enabled

`saveToOutBtn.disabled = false` does **not exist** in `script.js`. The button is set to `disabled` in the HTML (`index.html:194`) and disabled again in `selectFolderImage` (`script.js:944`) and `handleSaveToOut` (`script.js:1025`), but never re-enabled. The primary (and only functional) save path is Enter → `applyPerspectiveCorrection()` → `handleSaveToOut()`.

## Revised change list

**`folderBrowser.js`:**
1. Add `getPrevImageIndex(currentIndex, total)` — `(currentIndex - 1 + total) % total`.
2. Modify `saveToOut()` to add collision-safe rename logic (see algorithm below). Export the function signature stays the same.

**`script.js`:**
3. Import `getPrevImageIndex` from `folderBrowser.js`.
4. In `handleSaveToOut()`: **remove** the auto-advance block (`script.js:1027–1031`).
5. Extend `keydown` listener:
   - `ArrowRight` (folder open) → `selectFolderImage(getNextImageIndex(currentFolderImageIndex, folderImages.length))`
   - `ArrowLeft` (folder open) → `selectFolderImage(getPrevImageIndex(currentFolderImageIndex, folderImages.length))`

### Collision naming algorithm

Given base name `scan001` and output `scan001.png`:
1. Open `out/` handle; iterate all entries to collect file names.
2. If `scan001.png` is **not** present → write normally, done.
3. If `scan001.png` **exists**:
   - Find all names matching `scan001_<N>.png` (integer N ≥ 0).
   - If none: read existing file → write as `scan001_0.png` → delete `scan001.png` → write new file as `scan001.png`.
   - If max existing suffix = n: read existing → write as `scan001_(n+1).png` → delete `scan001.png` → write new as `scan001.png`.

The File System Access API does not have a cross-browser `move()` on file handles. Safe approach: `getFileHandle(newName, { create: true })` + write bytes + `remove()` on old handle.
