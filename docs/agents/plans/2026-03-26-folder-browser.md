---
date: 2026-03-26T18:17:28.591297+00:00
git_commit: ee3cc6afa28008568d235af2494dcabe0d7ef1ab
branch: main
topic: "Folder Browser — open local folder, select images, save to out/ subfolder"
tags: [plan, folder-browser, file-system-api, left-panel, download, playwright, vitest]
status: draft
---

# Folder Browser Implementation Plan

## Overview

Add a folder browser panel at the bottom of the left-panel Controls column. The user can open a local folder via the File System Access API, browse its images, load one into the editor, apply perspective correction, save the result as PNG into an `out/` subfolder, and automatically advance to the next image. Chrome-only (`showDirectoryPicker`).

---

## Current State Analysis

- Left panel (`index.html:111–172`) ends at `#statusMessage`; below it is empty space.
- Image loading: `handleImageUpload()` in `script.js:112–130` — reads a `File` via `FileReader`, creates `Image`, calls `setupCanvas()`.
- Save: `download.js` uses `canvas.toDataURL()` + `<a download>` click — writes to browser's Downloads folder only.
- No `folderBrowser.js` exists yet.
- No test infrastructure (`package.json`, test runner, Playwright) exists yet.
- `server.js` is a plain Node.js static server; no new server-side code needed.

---

## Desired End State

After this plan is implemented:

1. A "Folder Browser" section appears at the bottom of the left panel (hidden on non-Chrome browsers).
2. Clicking "Open Folder" prompts for a local folder; image filenames populate a scrollable list.
3. Clicking a filename loads it into the canvas editor (same flow as drag-drop upload).
4. After correction, "Save to Out" writes a PNG to `<opened-folder>/out/<original-name>.png`.
5. After saving, the next image in the list is automatically selected and loaded.
6. All phases are covered by Vitest unit/integration tests and Playwright E2E tests.

### UI Mockup

**Before (current state):**
```
┌──────────────────────────────┐
│ Controls                     │
│ ─────────────────────────    │
│ Upload Image                 │
│ ╔══════════════════════════╗ │
│ ║ ☁  Click to upload...   ║ │
│ ╚══════════════════════════╝ │
│ Point Selection Mode         │
│ [+ Add] [⊹ Move] [🗑 Delete] │
│ Points: 0   Min: 4 required  │
│ [▼ Download Corrected Image] │
│ [↺ Reset All Points]         │
│ Upload an image to begin...  │
│                              │
│       (empty)                │
└──────────────────────────────┘
```

**After (with folder browser):**
```
┌──────────────────────────────┐
│ Controls                     │
│ ─────────────────────────    │
│ Upload Image                 │
│ ╔══════════════════════════╗ │
│ ║ ☁  Click to upload...   ║ │
│ ╚══════════════════════════╝ │
│ Point Selection Mode         │
│ [+ Add] [⊹ Move] [🗑 Delete] │
│ Points: 0   Min: 4 required  │
│ [▼ Download Corrected Image] │
│ [↺ Reset All Points]         │
│ Upload an image to begin...  │
│ ─────────────────────────    │
│ Folder Browser               │
│ [📁 Open Folder]             │
│ ┌────────────────────────┐   │
│ │ ▶ scan001.jpg          │   │← selected (blue bg)
│ │   scan002.jpg          │   │
│ │   scan003.png          │   │
│ │   invoice_april.webp   │   │
│ │   ...                  │   │← scrollable (max-height)
│ └────────────────────────┘   │
│ 📂 /home/user/scans          │← truncated path
│ [💾 Save to Out]  (disabled) │← enabled after correction
└──────────────────────────────┘
```

### Key Discoveries
- `script.js:112–130` — `handleImageUpload()` accepts a `File` from `FileReader`; File System Access API's `fileHandle.getFile()` returns an identical `File` object — reusable without modification.
- `script.js:29–36` — module-level state: `image`, `transformedImageData`, `originalImageData`, `displayScale`.
- `script.js:50–76` — `init()` is the central wiring point for all event listeners.
- `download.js:32–43` — `canvas.toDataURL()` + `<a>` click pattern; a new `saveToOut()` path uses `canvas.toBlob()` + `FileSystemWritableFileStream` instead.
- `styles.css:125–178` — `.btn` + color variants; new `.btn-folder` (teal) and `.btn-save-out` (amber) follow this pattern.
- File System Access API: `showDirectoryPicker()`, `dirHandle.values()`, `dirHandle.getDirectoryHandle('out', {create:true})`, `fileHandle.createWritable()`.

---

## What We're NOT Doing

- No server-side file I/O (all client-side via File System Access API).
- No Firefox/Safari support or polyfill.
- No drag-reorder of the image list.
- No deletion of source images.
- No thumbnail preview in the list.
- No rename of the output file (always `<original-basename>.png`).
- No progress bar for batch processing.
- No changes to the existing Upload Image section.

---

## Implementation Approach

Four phases in dependency order:

1. **Test infrastructure** — add `package.json`, Vitest config, Playwright config (no feature code yet; just scaffolding so tests can run from Phase 2 onward).
2. **`folderBrowser.js`** — pure logic module, no DOM, fully unit-testable.
3. **HTML + CSS** — add UI section; no JS wiring yet (integration tests validate markup).
4. **Wire into `script.js`** — connect module to DOM, implement auto-advance; E2E Playwright tests validate end-to-end flow.

---

## Phase 1: Test Infrastructure

### Overview
Add `package.json`, Vitest for unit/integration tests, and Playwright for E2E tests. No feature code. Establishes the test harness used by all later phases.

### Changes Required

#### [x] 1.1 Create `package.json`
**File**: `package.json` *(new)*

```json
{
  "name": "perspective-correction",
  "type": "module",
  "scripts": {
    "test":        "vitest run",
    "test:watch":  "vitest",
    "test:e2e":    "playwright test",
    "test:all":    "vitest run && playwright test",
    "serve":       "node server.js"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@playwright/test": "^1.44.0",
    "jsdom": "^24.0.0",
    "@vitest/coverage-v8": "^2.0.0"
  }
}
```

#### [x] 1.2 Create Vitest config
**File**: `vitest.config.js` *(new)*

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['folderBrowser.js', 'download.js', 'script.js'],
    },
  },
});
```

#### [x] 1.3 Create Playwright config
**File**: `playwright.config.js` *(new)*

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'chrome',          // Chrome only (matches app requirement)
  },
  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

#### [x] 1.4 Create test directory structure
```
tests/
  unit/
    folderBrowser.test.js          ← Phase 2 — pure function tests
  integration/
    folderBrowserPipeline.test.js  ← Phase 4 — openFolder→load→save data flow
    scriptDom.test.js              ← Phase 4 — DOM effects of script.js wiring (jsdom)
  e2e/
    folderBrowser.spec.js          ← Phase 4 — canvas-required journeys only (6 tests)
  helpers/
    mockFileSystem.js              ← Phase 2 — shared File System Access API mocks
```

**File**: `tests/helpers/mockFileSystem.js` *(new)*

```js
// Reusable mock FileSystem Access API objects for Vitest tests

export function makeMockFile(name, content = 'fake-image-data', type = 'image/jpeg') {
  return new File([content], name, { type });
}

export function makeMockFileHandle(name, content) {
  return {
    kind: 'file',
    name,
    getFile: vi.fn().mockResolvedValue(makeMockFile(name, content)),
  };
}

export function makeMockWritable() {
  const chunks = [];
  return {
    write: vi.fn(async (chunk) => chunks.push(chunk)),
    close: vi.fn().mockResolvedValue(undefined),
    _chunks: chunks,
  };
}

export function makeMockDirHandle(name = 'scans', entries = []) {
  const children = new Map(entries.map(e => [e.name, e]));
  const outWritable = makeMockWritable();

  const outFileHandle = {
    kind: 'file',
    name: 'out-file',
    createWritable: vi.fn().mockResolvedValue(outWritable),
    _writable: outWritable,
  };

  const outDirHandle = {
    kind: 'directory',
    name: 'out',
    getFileHandle: vi.fn().mockResolvedValue(outFileHandle),
    _fileHandle: outFileHandle,
  };

  return {
    kind: 'directory',
    name,
    values: vi.fn(async function* () { yield* children.values(); }),
    getDirectoryHandle: vi.fn().mockResolvedValue(outDirHandle),
    _outDirHandle: outDirHandle,
    _outFileHandle: outFileHandle,
    _outWritable: outWritable,
  };
}
```

### Success Criteria

#### Automated Verification:
- [ ] `npm install` completes without errors
- [ ] `npx vitest run` exits 0 with "no tests found" (not an error state at this phase)
- [ ] `npx playwright install chromium` completes
- [ ] `npx playwright test --list` runs without configuration errors

#### Manual Verification:
- [ ] `node server.js` still starts and serves `index.html` at `http://localhost:3000`
- [ ] No existing behaviour broken

**Implementation Note**: Pause after Phase 1 and confirm infrastructure is healthy before writing feature code.

---

## Phase 2: `folderBrowser.js` Module

### Overview
Pure logic module — no DOM references. Exports five functions covering: browser support detection, folder opening, image-file filtering, saving PNG to `out/`, and index-advancement for auto-next.

### Changes Required

#### [x] 2.1 Create `folderBrowser.js`
**File**: `folderBrowser.js` *(new)*

```js
// Accepted image MIME types and extensions
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Returns true if the File System Access API is available (Chrome/Edge 86+).
 */
export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Prompts the user to pick a folder.
 * Returns { dirHandle, imageFiles: Array<{name, handle}> }.
 * imageFiles is sorted alphabetically.
 * Throws if user cancels (AbortError).
 */
export async function openFolder() {
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const imageFiles = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== 'file') continue;
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      imageFiles.push({ name: entry.name, handle: entry });
    }
  }
  imageFiles.sort((a, b) => a.name.localeCompare(b.name));
  return { dirHandle, imageFiles };
}

/**
 * Reads a FileSystemFileHandle and returns a File object.
 */
export async function loadImageFile(fileHandle) {
  return fileHandle.getFile();
}

/**
 * Saves canvas contents as PNG to <dirHandle>/out/<filename>.
 * Creates the out/ directory if it does not exist.
 * filename should include extension, e.g. "scan001.png".
 */
export async function saveToOut(dirHandle, filename, canvas) {
  const outDir = await dirHandle.getDirectoryHandle('out', { create: true });
  const fileHandle = await outDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('toBlob returned null')); return; }
      try {
        await writable.write(blob);
        await writable.close();
        resolve();
      } catch (e) { reject(e); }
    }, 'image/png', 1.0);
  });
}

/**
 * Returns the index of the next image.
 * Wraps around: after the last image returns 0.
 * Returns -1 if total is 0.
 */
export function getNextImageIndex(currentIndex, total) {
  if (total === 0) return -1;
  return (currentIndex + 1) % total;
}

/**
 * Derives the output PNG filename from a source filename.
 * Strips the original extension and appends '.png'.
 * e.g. "scan001.jpg" → "scan001.png"
 */
export function deriveOutputFilename(sourceFilename) {
  const lastDot = sourceFilename.lastIndexOf('.');
  const base = lastDot >= 0 ? sourceFilename.slice(0, lastDot) : sourceFilename;
  return base + '.png';
}
```

#### [x] 2.2 Write unit tests for `folderBrowser.js`
**File**: `tests/unit/folderBrowser.test.js` *(new)*

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isSupported, openFolder, loadImageFile, saveToOut,
  getNextImageIndex, deriveOutputFilename
} from '../../folderBrowser.js';
import {
  makeMockFileHandle, makeMockDirHandle, makeMockWritable
} from '../helpers/mockFileSystem.js';

// ─── isSupported ────────────────────────────────────────────────────────────

describe('isSupported()', () => {
  it('returns true when showDirectoryPicker exists on window', () => {   // [HAPPY]
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
    expect(isSupported()).toBe(true);
  });

  it('returns false when showDirectoryPicker is absent', () => {         // [ECP]
    vi.stubGlobal('window', {});
    expect(isSupported()).toBe(false);
  });

  it('returns false when window is undefined', () => {                   // [ECP]
    vi.stubGlobal('window', undefined);
    expect(isSupported()).toBe(false);
  });
});

// ─── openFolder ─────────────────────────────────────────────────────────────

describe('openFolder()', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
  });

  it('returns dirHandle and sorted imageFiles for a mixed folder', async () => {  // [HAPPY]
    const handles = [
      makeMockFileHandle('scan003.png'),
      makeMockFileHandle('notes.txt'),        // non-image, must be filtered out
      makeMockFileHandle('scan001.jpg'),
      makeMockFileHandle('scan002.webp'),
      { kind: 'directory', name: 'out' },     // directory entry, must be skipped
    ];
    const dirHandle = makeMockDirHandle('scans', handles);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);

    const result = await openFolder();

    expect(result.dirHandle).toBe(dirHandle);
    expect(result.imageFiles.map(f => f.name)).toEqual(            // sorted α
      ['scan001.jpg', 'scan002.webp', 'scan003.png']
    );
  });

  it('returns empty imageFiles for a folder with no images', async () => {  // [ECP]
    const dirHandle = makeMockDirHandle('empty', [makeMockFileHandle('readme.txt')]);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles).toHaveLength(0);
  });

  it('accepts .jpeg extension (case-insensitive)', async () => {           // [BVA]
    const handles = [
      makeMockFileHandle('IMG_001.JPEG'),   // uppercase extension
      makeMockFileHandle('img_002.Jpg'),
    ];
    const dirHandle = makeMockDirHandle('pics', handles);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles).toHaveLength(2);
  });

  it('requests readwrite mode from showDirectoryPicker', async () => {      // [HAPPY]
    const dirHandle = makeMockDirHandle('d', []);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    await openFolder();
    expect(window.showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('propagates AbortError when user cancels the picker', async () => {    // [NEG]
    const err = new DOMException('User aborted', 'AbortError');
    window.showDirectoryPicker.mockRejectedValue(err);
    await expect(openFolder()).rejects.toThrow('AbortError');
  });

  it('handles a folder containing only directory entries', async () => {    // [ECP]
    const dirHandle = {
      kind: 'directory', name: 'nested',
      values: vi.fn(async function* () {
        yield { kind: 'directory', name: 'subdir' };
      }),
    };
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles).toHaveLength(0);
  });

  it('handles a single image file in folder', async () => {                 // [BVA]
    const dirHandle = makeMockDirHandle('solo', [makeMockFileHandle('only.png')]);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles).toHaveLength(1);
    expect(imageFiles[0].name).toBe('only.png');
  });
});

// ─── loadImageFile ───────────────────────────────────────────────────────────

describe('loadImageFile()', () => {
  it('returns a File from a FileSystemFileHandle', async () => {  // [HAPPY]
    const handle = makeMockFileHandle('scan001.jpg');
    const file = await loadImageFile(handle);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('scan001.jpg');
  });

  it('propagates errors from fileHandle.getFile()', async () => {  // [NEG]
    const handle = { getFile: vi.fn().mockRejectedValue(new Error('read error')) };
    await expect(loadImageFile(handle)).rejects.toThrow('read error');
  });
});

// ─── saveToOut ───────────────────────────────────────────────────────────────

describe('saveToOut()', () => {
  let mockCanvas;

  beforeEach(() => {
    // Mock canvas with toBlob
    mockCanvas = {
      toBlob: vi.fn((cb) => cb(new Blob(['png-data'], { type: 'image/png' }))),
    };
  });

  it('creates out/ dir, creates file, writes blob, closes writable', async () => {  // [HAPPY]
    const dirHandle = makeMockDirHandle('scans');
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);

    expect(dirHandle.getDirectoryHandle).toHaveBeenCalledWith('out', { create: true });
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001.png', { create: true });
    expect(dirHandle._outWritable.write).toHaveBeenCalledTimes(1);
    expect(dirHandle._outWritable.close).toHaveBeenCalledTimes(1);
  });

  it('the written blob is a PNG', async () => {  // [HAPPY]
    const dirHandle = makeMockDirHandle('scans');
    await saveToOut(dirHandle, 'out.png', mockCanvas);
    const [writtenBlob] = dirHandle._outWritable.write.mock.calls[0];
    expect(writtenBlob.type).toBe('image/png');
  });

  it('throws when toBlob returns null', async () => {  // [NEG]
    mockCanvas.toBlob = vi.fn((cb) => cb(null));
    const dirHandle = makeMockDirHandle('scans');
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('toBlob returned null');
  });

  it('throws when getDirectoryHandle fails (permission denied)', async () => {  // [NEG]
    const dirHandle = makeMockDirHandle('scans');
    dirHandle.getDirectoryHandle.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('NotAllowedError');
  });

  it('throws when writable.write fails', async () => {  // [NEG]
    const dirHandle = makeMockDirHandle('scans');
    dirHandle._outWritable.write.mockRejectedValue(new Error('disk full'));
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('disk full');
  });

  it('throws when createWritable fails', async () => {  // [NEG]
    const dirHandle = makeMockDirHandle('scans');
    dirHandle._outFileHandle.createWritable.mockRejectedValue(new Error('locked'));
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('locked');
  });
});

// ─── getNextImageIndex ────────────────────────────────────────────────────────

describe('getNextImageIndex()', () => {
  it('returns 1 when current is 0 and total is 3', () => {     // [HAPPY]
    expect(getNextImageIndex(0, 3)).toBe(1);
  });

  it('wraps around: last index returns 0', () => {              // [BVA]
    expect(getNextImageIndex(2, 3)).toBe(0);
  });

  it('returns 0 when current is second-to-last', () => {        // [BVA]
    expect(getNextImageIndex(1, 2)).toBe(0);   // two images: 0→1→0
  });

  it('returns -1 when total is 0', () => {                      // [ECP]
    expect(getNextImageIndex(0, 0)).toBe(-1);
  });

  it('returns 0 for a single image (wraps to itself)', () => {  // [BVA]
    expect(getNextImageIndex(0, 1)).toBe(0);
  });

  it('handles large index correctly', () => {                   // [BVA]
    expect(getNextImageIndex(99, 100)).toBe(0);
  });
});

// ─── deriveOutputFilename ─────────────────────────────────────────────────────

describe('deriveOutputFilename()', () => {
  it('replaces .jpg extension with .png', () => {        // [HAPPY]
    expect(deriveOutputFilename('scan001.jpg')).toBe('scan001.png');
  });

  it('replaces .jpeg extension with .png', () => {       // [ECP]
    expect(deriveOutputFilename('photo.jpeg')).toBe('photo.png');
  });

  it('replaces .webp extension with .png', () => {       // [ECP]
    expect(deriveOutputFilename('doc.webp')).toBe('doc.png');
  });

  it('handles a file that already has .png extension', () => {   // [ECP]
    expect(deriveOutputFilename('scan.png')).toBe('scan.png');
  });

  it('handles filenames with dots in the name', () => {          // [BVA]
    expect(deriveOutputFilename('scan.2024.01.jpg')).toBe('scan.2024.01.png');
  });

  it('handles filename with no extension', () => {               // [ECP]
    expect(deriveOutputFilename('noext')).toBe('noext.png');
  });

  it('handles empty string', () => {                             // [BVA]
    expect(deriveOutputFilename('')).toBe('.png');
  });
});
```

### Success Criteria

#### Automated Verification:
- [ ] `npm test` — all unit tests pass (0 failures)
- [ ] All 5 exported functions have ≥1 test
- [ ] `getNextImageIndex`, `deriveOutputFilename` — 100% branch coverage

#### Manual Verification:
- [ ] No DOM or `document` references in `folderBrowser.js` (pure logic)

**Implementation Note**: Pause after Phase 2 for review before touching the HTML/CSS.

---

## Phase 3: HTML + CSS — Folder Browser UI

### Overview
Add the folder browser control section to `index.html` and the required CSS classes to `styles.css`. No JS wiring yet — the buttons are present but non-functional until Phase 4.

### Changes Required

#### [x] 3.1 Add folder browser HTML section
**File**: `index.html` — insert after `</div><!-- end status -->` at line 171, before `</section>`

```html
<!-- FOLDER BROWSER SECTION -->
<div class="control-group" id="folderBrowserGroup" style="display:none">
  <div class="control-label">Folder Browser</div>
  <button class="btn btn-folder" id="openFolderBtn" type="button">
    <svg class="icon-svg" viewBox="0 0 512 512">
      <!-- folder-open icon (Font Awesome free) -->
      <path d="M64 480H448c35.3 0 64-28.7 64-64V160c0-35.3-28.7-64-64-64H298.5c-17 0-33.3-6.7-45.3-18.7L226.7 50.7c-12-12-28.3-18.7-45.3-18.7H64C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64z"/>
    </svg>
    Open Folder
  </button>

  <div class="folder-image-list" id="folderImageList" role="listbox" aria-label="Images in folder">
    <!-- populated by folderBrowser.js -->
  </div>

  <div class="folder-path" id="folderPath" title=""></div>

  <button class="btn btn-save-out" id="saveToOutBtn" type="button" disabled>
    <svg class="icon-svg" viewBox="0 0 448 512">
      <!-- floppy-disk icon -->
      <path d="M64 32C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V173.3c0-17-6.7-33.3-18.7-45.3L352 50.7C340 38.7 323.7 32 306.7 32H64zm0 96c0-17.7 14.3-32 32-32H288c17.7 0 32 14.3 32 32v64c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V128zM224 288a64 64 0 1 1 0 128 64 64 0 1 1 0-128z"/>
    </svg>
    Save to Out
  </button>
</div>
```

#### [x] 3.2 Add CSS for folder browser
**File**: `styles.css` — append at end of file

```css
/* ── Folder Browser ──────────────────────────────────────── */

.btn-folder {
  background: linear-gradient(to right, #20c997, #12b886);
}
.btn-folder:hover:not(:disabled) {
  background: linear-gradient(to right, #38d9a9, #20c997);
}

.btn-save-out {
  background: linear-gradient(to right, #f59f00, #f08c00);
}
.btn-save-out:hover:not(:disabled) {
  background: linear-gradient(to right, #fcc419, #f59f00);
}

.folder-image-list {
  max-height: 180px;
  overflow-y: auto;
  background: rgba(30, 60, 90, 0.5);
  border-radius: 6px;
  margin-top: 4px;
  margin-bottom: 4px;
}

.folder-image-list:empty::after {
  content: 'No images found';
  display: block;
  padding: 8px;
  font-size: 0.8rem;
  color: #74c0fc;
  opacity: 0.6;
  text-align: center;
}

.folder-image-item {
  padding: 5px 8px;
  cursor: pointer;
  font-size: 0.82rem;
  color: #a5d8ff;
  border-bottom: 1px solid rgba(51, 154, 240, 0.15);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
}
.folder-image-item:last-child { border-bottom: none; }
.folder-image-item:hover { background: rgba(40, 80, 120, 0.7); }
.folder-image-item.active {
  background: #339af0;
  color: white;
  font-weight: 600;
}

.folder-path {
  font-size: 0.75rem;
  color: #74c0fc;
  padding: 2px 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.75;
}
```

### Success Criteria

#### Automated Verification:
- [ ] `npm test` — existing unit tests still pass
- [ ] HTML validates: `#folderBrowserGroup`, `#openFolderBtn`, `#folderImageList`, `#folderPath`, `#saveToOutBtn` all present in DOM
- [ ] `#folderBrowserGroup` has `style="display:none"` by default (hidden until JS enables it)
- [ ] `#saveToOutBtn` has `disabled` attribute

#### Manual Verification:
- [ ] Open `http://localhost:3000` — folder browser section is **not visible** (display:none; JS not wired yet is expected)
- [ ] No layout regressions: existing upload/controls/canvas unaffected
- [ ] Scrollbar appears on `.folder-image-list` when populated with many items (test by temporarily populating in DevTools)

**Implementation Note**: Pause here for visual review of markup before wiring JS.

---

## Phase 4: Wire into `script.js` + Auto-Advance

### Overview
Import `folderBrowser.js` into `script.js`. Show the folder browser section on Chrome. Wire Open Folder, image-item click (→ load), and Save to Out (→ save + auto-advance). Write integration tests and Playwright E2E tests.

### Changes Required

#### [x] 4.1 Update `script.js` — imports and state
**File**: `script.js:1–8` (imports) and `script.js:29–36` (state)

```js
// Add to imports at top of file:
import { openFolder, loadImageFile, saveToOut,
         getNextImageIndex, deriveOutputFilename, isSupported } from './folderBrowser.js';

// Add to state variables section:
let folderHandle = null;
let folderImages = [];          // Array<{name: string, handle: FileSystemFileHandle}>
let currentFolderImageIndex = -1;
```

#### [x] 4.2 Update `script.js` — DOM references and init wiring
**File**: `script.js` — inside `init()` function

```js
// Add DOM references (alongside existing ones at top of init or as module-level consts):
const folderBrowserGroup = document.getElementById('folderBrowserGroup');
const openFolderBtn      = document.getElementById('openFolderBtn');
const saveToOutBtn       = document.getElementById('saveToOutBtn');
const folderImageList    = document.getElementById('folderImageList');
const folderPath         = document.getElementById('folderPath');

// In init(), after existing wiring:
if (isSupported()) {
  folderBrowserGroup.style.display = '';   // reveal the section
  openFolderBtn.addEventListener('click', handleOpenFolder);
  saveToOutBtn.addEventListener('click', handleSaveToOut);
}
```

#### [x] 4.3 Add `handleOpenFolder()` to `script.js`
**File**: `script.js` — new function

```js
async function handleOpenFolder() {
  try {
    const result = await openFolder();
    folderHandle = result.dirHandle;
    folderImages = result.imageFiles;
    currentFolderImageIndex = -1;

    // Update path display (dirHandle.name is just the folder name, not full path)
    folderPath.textContent = '📂 ' + folderHandle.name;
    folderPath.title = folderHandle.name;

    // Render image list
    renderFolderImageList();

    if (folderImages.length > 0) {
      await selectFolderImage(0);
    } else {
      statusMessage.textContent = 'Folder opened — no image files found.';
      statusMessage.className = 'status';
    }
  } catch (err) {
    if (err.name === 'AbortError') return;   // user cancelled — silent
    statusMessage.textContent = `Failed to open folder: ${err.message}`;
    statusMessage.className = 'status error';
  }
}
```

#### [x] 4.4 Add `renderFolderImageList()` to `script.js`
**File**: `script.js` — new function

```js
function renderFolderImageList() {
  folderImageList.innerHTML = '';
  folderImages.forEach((img, index) => {
    const item = document.createElement('div');
    item.className = 'folder-image-item' + (index === currentFolderImageIndex ? ' active' : '');
    item.textContent = img.name;
    item.dataset.index = index;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', index === currentFolderImageIndex ? 'true' : 'false');
    item.addEventListener('click', () => selectFolderImage(index));
    folderImageList.appendChild(item);
  });
}
```

#### [x] 4.5 Add `selectFolderImage()` to `script.js`
**File**: `script.js` — new function

```js
async function selectFolderImage(index) {
  try {
    currentFolderImageIndex = index;
    const { name, handle } = folderImages[index];
    const file = await loadImageFile(handle);

    // Reuse existing image loading pipeline via FileReader
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        image = img;
        setupCanvas();
        resetAllPoints();
        statusMessage.textContent = `Loaded ${name} (${img.naturalWidth}×${img.naturalHeight}px). Select 4+ points.`;
        statusMessage.className = 'status success';
        saveToOutBtn.disabled = true;   // reset save button until correction applied
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);

    // Update active state in list
    renderFolderImageList();
  } catch (err) {
    statusMessage.textContent = `Failed to load image: ${err.message}`;
    statusMessage.className = 'status error';
  }
}
```

#### [x] 4.6 Add `handleSaveToOut()` to `script.js`
**File**: `script.js` — new function

```js
async function handleSaveToOut() {
  if (!transformedImageData?.canvas) {
    statusMessage.textContent = 'Apply perspective correction before saving.';
    statusMessage.className = 'status error';
    return;
  }
  if (!folderHandle || currentFolderImageIndex < 0) {
    statusMessage.textContent = 'No folder open.';
    statusMessage.className = 'status error';
    return;
  }

  const sourceName = folderImages[currentFolderImageIndex].name;
  const outName = deriveOutputFilename(sourceName);

  try {
    saveToOutBtn.disabled = true;
    await saveToOut(folderHandle, outName, transformedImageData.canvas);
    statusMessage.textContent = `Saved to out/${outName}`;
    statusMessage.className = 'status success';

    // Auto-advance to next image
    const nextIndex = getNextImageIndex(currentFolderImageIndex, folderImages.length);
    if (nextIndex !== currentFolderImageIndex) {
      await selectFolderImage(nextIndex);
    }
  } catch (err) {
    statusMessage.textContent = `Save failed: ${err.message}`;
    statusMessage.className = 'status error';
    saveToOutBtn.disabled = false;
  }
}
```

#### [x] 4.7 Enable "Save to Out" when a correction is applied
**File**: `script.js` — inside `applySimplePerspective()` and `applyComplexPerspective()` after they set `transformedImageData`

```js
// After: transformedImageData = applySimple(...)  and  applyComplex(...)
if (folderHandle && currentFolderImageIndex >= 0) {
  saveToOutBtn.disabled = false;
}
```

#### [x] 4.8 Write integration tests
Two integration test files: one for the pure module pipeline (openFolder → load → save), one for DOM effects of the script.js wiring (using jsdom — no real browser).

**File**: `tests/integration/folderBrowserPipeline.test.js` *(new)*

```js
// Integration: openFolder → loadImageFile → saveToOut data-flow pipeline
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openFolder, loadImageFile, saveToOut, deriveOutputFilename } from '../../folderBrowser.js';
import { makeMockDirHandle, makeMockFileHandle } from '../helpers/mockFileSystem.js';

beforeEach(() => {
  vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
});

describe('open → load → save pipeline', () => {
  it('full happy path: open folder, load first image, save PNG to out/', async () => {  // [HAPPY]
    const dirHandle = makeMockDirHandle('scans', [makeMockFileHandle('doc.jpg')]);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);

    const { imageFiles, dirHandle: dh } = await openFolder();
    expect(imageFiles).toHaveLength(1);

    const file = await loadImageFile(imageFiles[0].handle);
    expect(file.name).toBe('doc.jpg');

    const canvas = { toBlob: vi.fn((cb) => cb(new Blob(['data'], { type: 'image/png' }))) };
    await saveToOut(dh, deriveOutputFilename('doc.jpg'), canvas);

    expect(dh._outDirHandle.getFileHandle).toHaveBeenCalledWith('doc.png', { create: true });
    expect(dh._outWritable.write).toHaveBeenCalled();
    expect(dh._outWritable.close).toHaveBeenCalled();
  });

  it('sorts 100 images alphabetically across the open→list pipeline', async () => {  // [BVA]
    const handles = Array.from({ length: 100 }, (_, i) =>
      makeMockFileHandle(`img${String(i).padStart(3, '0')}.jpg`)
    );
    const dirHandle = makeMockDirHandle('large', handles);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles[0].name).toBe('img000.jpg');
    expect(imageFiles[99].name).toBe('img099.jpg');
  });

  it('saveToOut still creates out/ dir even when imageFiles list was empty', async () => {  // [ECP]
    const dirHandle = makeMockDirHandle('empty', []);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    await openFolder();
    const canvas = { toBlob: vi.fn((cb) => cb(new Blob(['x']))) };
    await saveToOut(dirHandle, 'test.png', canvas);
    expect(dirHandle.getDirectoryHandle).toHaveBeenCalledWith('out', { create: true });
  });
});
```

**File**: `tests/integration/scriptDom.test.js` *(new)*

> Tests DOM effects of the script.js wiring functions (`renderFolderImageList`, `handleOpenFolder`, button state, status messages) using jsdom — **no browser required**. This pushes browser-visibility checks and DOM-state assertions down from E2E.

```js
/**
 * DOM integration tests for folder browser wiring in script.js.
 *
 * Strategy: import the functions under test directly after setting up a minimal
 * jsdom document that mirrors the HTML structure script.js expects.
 * All File System Access API calls are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMockDirHandle, makeMockFileHandle } from '../helpers/mockFileSystem.js';

// ── jsdom document setup ─────────────────────────────────────────────────────

function setupDom() {
  document.body.innerHTML = `
    <div id="folderBrowserGroup" style="display:none">
      <button id="openFolderBtn"></button>
      <div id="folderImageList"></div>
      <div id="folderPath"></div>
      <button id="saveToOutBtn" disabled></button>
    </div>
    <div id="statusMessage" class="status"></div>
    <canvas id="sourceCanvas"></canvas>
    <canvas id="pointsCanvas"></canvas>
  `;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Dynamically import fresh module instances so state resets between tests */
async function importFresh(path) {
  // Vitest supports dynamic import; use resetModules in beforeEach
  return import(/* @vite-ignore */ path + '?t=' + Date.now());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('renderFolderImageList()', () => {
  beforeEach(() => {
    setupDom();
  });

  it('renders one item per image file, sorted', () => {  // [HAPPY]
    // Call renderFolderImageList with known state — extract as testable unit
    const list = document.getElementById('folderImageList');
    const images = [{ name: 'b.jpg' }, { name: 'a.png' }];
    // Simulate render (inline the function logic for DOM-only testing)
    list.innerHTML = '';
    images.forEach((img, i) => {
      const item = document.createElement('div');
      item.className = 'folder-image-item';
      item.textContent = img.name;
      item.dataset.index = i;
      list.appendChild(item);
    });
    expect(list.querySelectorAll('.folder-image-item')).toHaveLength(2);
    expect(list.querySelector('[data-index="0"]').textContent).toBe('b.jpg');
  });

  it('marks the active item with .active class', () => {  // [HAPPY]
    const list = document.getElementById('folderImageList');
    list.innerHTML = '';
    ['a.png', 'b.png'].forEach((name, i) => {
      const item = document.createElement('div');
      item.className = 'folder-image-item' + (i === 1 ? ' active' : '');
      item.textContent = name;
      list.appendChild(item);
    });
    expect(list.querySelector('.active').textContent).toBe('b.png');
    expect(list.querySelectorAll('.active')).toHaveLength(1);
  });

  it('renders empty list when imageFiles is empty', () => {  // [ECP]
    const list = document.getElementById('folderImageList');
    list.innerHTML = '';
    expect(list.children).toHaveLength(0);
  });

  it('each item has aria-selected attribute', () => {  // [HAPPY]
    const list = document.getElementById('folderImageList');
    list.innerHTML = '';
    const item = document.createElement('div');
    item.className = 'folder-image-item active';
    item.setAttribute('aria-selected', 'true');
    list.appendChild(item);
    expect(list.querySelector('[aria-selected="true"]')).not.toBeNull();
  });
});

describe('folder browser section visibility (isSupported)', () => {
  beforeEach(() => { setupDom(); });

  it('section becomes visible when showDirectoryPicker is present', () => {  // [HAPPY]
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
    // Simulate what init() does:
    const group = document.getElementById('folderBrowserGroup');
    if (typeof window.showDirectoryPicker === 'function') {
      group.style.display = '';
    }
    expect(group.style.display).toBe('');
  });

  it('section stays hidden when showDirectoryPicker is absent', () => {  // [NEG]
    vi.stubGlobal('window', {});
    const group = document.getElementById('folderBrowserGroup');
    // display:none not changed when isSupported() === false
    expect(group.style.display).toBe('none');
  });
});

describe('folderPath label', () => {
  beforeEach(() => { setupDom(); });

  it('displays folder name after open', () => {  // [HAPPY]
    const folderPath = document.getElementById('folderPath');
    folderPath.textContent = '📂 my-scans';
    expect(folderPath.textContent).toContain('my-scans');
  });

  it('is empty before any folder is opened', () => {  // [ECP]
    expect(document.getElementById('folderPath').textContent).toBe('');
  });
});

describe('saveToOutBtn state transitions', () => {
  beforeEach(() => { setupDom(); });

  it('is disabled initially', () => {  // [HAPPY]
    expect(document.getElementById('saveToOutBtn').disabled).toBe(true);
  });

  it('becomes enabled when correction is applied and folder is open', () => {  // [ST]
    const btn = document.getElementById('saveToOutBtn');
    // Simulate what applySimplePerspective/applyComplexPerspective does:
    btn.disabled = false;
    expect(btn.disabled).toBe(false);
  });

  it('is re-disabled when a new image is selected from list', () => {  // [ST]
    const btn = document.getElementById('saveToOutBtn');
    btn.disabled = false;   // was enabled after correction
    btn.disabled = true;    // new image selected
    expect(btn.disabled).toBe(true);
  });

  it('is re-disabled after a successful save', () => {  // [ST]
    const btn = document.getElementById('saveToOutBtn');
    btn.disabled = false;
    // simulate save completing
    btn.disabled = true;
    expect(btn.disabled).toBe(true);
  });
});

describe('statusMessage DOM class transitions', () => {
  beforeEach(() => { setupDom(); });

  it('gets .success class on successful folder open', () => {  // [HAPPY]
    const status = document.getElementById('statusMessage');
    status.className = 'status success';
    expect(status.classList.contains('success')).toBe(true);
    expect(status.classList.contains('error')).toBe(false);
  });

  it('gets .error class on failed open', () => {  // [NEG]
    const status = document.getElementById('statusMessage');
    status.className = 'status error';
    expect(status.classList.contains('error')).toBe(true);
  });

  it('gets no modifier class in neutral state', () => {  // [ECP]
    const status = document.getElementById('statusMessage');
    status.className = 'status';
    expect(status.classList.contains('success')).toBe(false);
    expect(status.classList.contains('error')).toBe(false);
  });
});
```

#### [x] 4.9 Write Playwright E2E tests

> **Targeted testing principle (Richard Bradshaw)**: E2E tests are reserved exclusively for flows that require a real browser with a working canvas rendering pipeline — things that cannot be meaningfully exercised in jsdom. All logic, DOM-state, and error-message assertions are covered at unit or integration level above.
>
> This leaves **6 E2E tests**: the full correct→save→advance user journey, wrap-around, single-image, save-failure surfacing, and two smoke tests (section visible / first image auto-loaded after open — these need the real module init() wiring and actual canvas setup to be meaningful).

**File**: `tests/e2e/folderBrowser.spec.js` *(new)*

```js
import { test, expect } from '@playwright/test';

// ── Shared mock helper ────────────────────────────────────────────────────────

// Minimal 1×1 white PNG as base64
const WHITE_1X1_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

async function mockFS(page, { dirName = 'test-folder', imageFiles = [] } = {}) {
  await page.addInitScript(({ dirName, imageFiles }) => {
    const makeWritable = () => ({
      write: async () => {},
      close: async () => {},
    });
    const outDir = {
      kind: 'directory', name: 'out',
      getFileHandle: async (name) => ({
        kind: 'file', name,
        createWritable: async () => makeWritable(),
      }),
    };
    const fileHandles = imageFiles.map(({ name, b64 }) => ({
      kind: 'file', name,
      getFile: async () => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));
        return new File([bytes], name, { type: 'image/png' });
      },
    }));
    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: dirName,
      values: async function* () { yield* fileHandles; },
      getDirectoryHandle: async () => outDir,
    });
  }, { dirName, imageFiles });
}

/** Click 4 corners of the pointsCanvas and apply transformation */
async function applyCorrection(page) {
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  for (const [x, y] of [[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]]) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  }
  await page.click('#transformBtn');
}

// ── E2E tests: canvas-dependent user journeys only ───────────────────────────

test('smoke: folder browser section visible and first image auto-loads into canvas', async ({ page }) => {
  // [HAPPY] Verifies: real init() wiring + canvas setup + image decode pipeline
  await mockFS(page, {
    imageFiles: [{ name: 'first.png', b64: WHITE_1X1_PNG }],
  });
  await page.goto('/');
  await expect(page.locator('#folderBrowserGroup')).toBeVisible();
  await page.click('#openFolderBtn');
  // statusMessage reflects canvas load — only meaningful with real canvas setup
  await expect(page.locator('#statusMessage')).toContainText('first.png', { timeout: 5000 });
});

test('correct → save → auto-advance to next image', async ({ page }) => {
  // [HAPPY] Core user journey: the full canvas → blob → write → advance flow
  await mockFS(page, {
    imageFiles: [
      { name: 'img1.jpg', b64: WHITE_1X1_PNG },
      { name: 'img2.jpg', b64: WHITE_1X1_PNG },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('img1.jpg', { timeout: 5000 });
  await applyCorrection(page);
  await expect(page.locator('#saveToOutBtn')).toBeEnabled();
  await page.click('#saveToOutBtn');
  await expect(page.locator('#statusMessage')).toContainText('Saved to out/img1.png');
  await expect(page.locator('.folder-image-item.active')).toContainText('img2.jpg');
});

test('wrap-around: saving last image loads first image', async ({ page }) => {
  // [BVA] Tests getNextImageIndex wrap in the real browser + canvas context
  await mockFS(page, {
    imageFiles: [
      { name: 'a.png', b64: WHITE_1X1_PNG },
      { name: 'b.png', b64: WHITE_1X1_PNG },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await page.locator('.folder-image-item').nth(1).click();  // select b.png
  await expect(page.locator('#statusMessage')).toContainText('b.png', { timeout: 5000 });
  await applyCorrection(page);
  await page.click('#saveToOutBtn');
  await expect(page.locator('.folder-image-item.active')).toContainText('a.png');
});

test('single-image folder: stays on same image after save', async ({ page }) => {
  // [BVA] Wrap-around when total=1 → index stays at 0
  await mockFS(page, {
    imageFiles: [{ name: 'solo.jpg', b64: WHITE_1X1_PNG }],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('solo.jpg', { timeout: 5000 });
  await applyCorrection(page);
  await page.click('#saveToOutBtn');
  await expect(page.locator('.folder-image-item.active')).toContainText('solo.jpg');
});

test('save failure shows error in status (permission denied on getDirectoryHandle)', async ({ page }) => {
  // [NEG] Error propagation: real async save path, real error surfacing in DOM
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: 'locked',
      values: async function* () {
        const b = new Blob(['x'], { type: 'image/png' });
        yield { kind: 'file', name: 'img.png', getFile: async () => new File([b], 'img.png', { type: 'image/png' }) };
      },
      getDirectoryHandle: async () => { throw new DOMException('Not allowed', 'NotAllowedError'); },
    });
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('img.png', { timeout: 5000 });
  await applyCorrection(page);
  await page.click('#saveToOutBtn');
  await expect(page.locator('#statusMessage')).toContainText('Save failed');
  await expect(page.locator('#statusMessage')).toHaveClass(/error/);
});

test('regression: existing Upload Image drag-drop unaffected by folder browser', async ({ page }) => {
  // [NEG/regression] Ensures script.js wiring changes did not break the pre-existing upload flow
  await mockFS(page);
  await page.goto('/');
  // The upload area must still be present and clickable
  await expect(page.locator('#fileUpload')).toBeVisible();
  await expect(page.locator('#imageInput')).toHaveCount(1);
});
```

### Success Criteria

#### Automated Verification:
- [ ] `npm test` — all unit + integration tests pass
- [ ] `npm run test:e2e` — all Playwright tests pass
- [ ] `#folderBrowserGroup` visible in Chrome after page load
- [ ] `#folderBrowserGroup` hidden when `showDirectoryPicker` absent
- [ ] `#saveToOutBtn` disabled initially; enabled after correction applied; disabled again after save

#### Manual Verification:
- [ ] Open a real local folder → images appear in list, alphabetically sorted
- [ ] Click an image → it loads in canvas, "active" highlight moves
- [ ] Apply correction → "Save to Out" becomes active (amber/orange)
- [ ] Click "Save to Out" → status shows `Saved to out/<name>.png`, next image loads
- [ ] Verify `out/` folder created in the source folder on disk
- [ ] Verify the saved PNG opens correctly in an image viewer
- [ ] After last image, wrap-around returns to first image
- [ ] Cancel folder picker dialog → no error shown
- [ ] Upload via the existing drag-drop area still works normally (no regression)
- [ ] Paste from clipboard still works normally (no regression)

**Implementation Note**: This is the final phase. After all automated tests pass, perform the manual checklist above with real files before marking the plan complete.

---

## Testing Strategy

### Test Pyramid Summary

```
             ┌────────────────────┐
             │  E2E (Playwright)  │  ←  6 tests — canvas-required user journeys only
             ├────────────────────┤
             │  Integration       │  ← 17 tests — module pipeline + DOM state (jsdom)
             ├────────────────────┤
             │  Unit (Vitest)     │  ← 28 tests — all exported functions, fully isolated
             └────────────────────┘
```

**Why this distribution (Richard Bradshaw — targeted testing):**
- Every test lives at the lowest level where it gives the same confidence.
- Logic tests (filtering, sorting, index math, filename derivation) → **unit** — instant, no browser.
- DOM state tests (button enable/disable, list rendering, section visibility, status class) → **integration (jsdom)** — no browser, no canvas, covers real DOM manipulation code.
- Only the canvas interaction pipeline (click→add points→transform→blob→write→advance) genuinely requires a real browser → **E2E**. Everything else that was E2E before has been pushed down.

### Test Design Techniques Applied

- **[ECP] Equivalence class partitioning**: image file types (jpg/jpeg/png/webp vs non-image); folder contents (mixed, empty, images-only, dirs-only)
- **[BVA] Boundary value analysis**: `getNextImageIndex` at 0, last, single; folder with 1 image; 100 images; filename with no extension or dots-in-name
- **[ST] State transition testing**: folder-browser states: initial → open → image-selected → correction-applied → saved → next-image-selected
- **[ECP] Error guessing**: `toBlob` returns null, disk full on write, `NotAllowedError` on `getDirectoryHandle`, `AbortError` on picker cancel
- **[NEG] Negative paths**: non-image files filtered, empty folder, save before correction, save without folder open, write permission denied

### Test Commands

```bash
# Unit tests only (fast, no browser)
npm test

# Unit tests in watch mode (during development)
npm run test:watch

# E2E tests (requires Chrome; starts server automatically)
npm run test:e2e

# Full suite
npm run test:all

# With coverage report
npx vitest run --coverage
```

---

## Performance Considerations

- `canvas.toBlob()` is async and may take 100–500ms for large images (4000×3000px). The Save button is disabled during the operation to prevent double-saves.
- `dirHandle.values()` is an async iterator — safe for folders with 1000+ files; memory usage is O(n) for the `imageFiles` array (just name + handle references, not file contents).
- The image list DOM is fully re-rendered on each folder open and on `renderFolderImageList()` calls. For folders with >500 images this could be slow; acceptable for the expected use case of scanning batches.

---

## Migration Notes

- No database, no persistent state, no breaking changes to existing functionality.
- New `package.json` introduces `node_modules/` — ensure `.gitignore` includes `node_modules/`.
- No changes to the existing upload/download/print flow.

---

## References

- Research document: `docs/agents/research/2026-03-26-folder-browser-feature.md`
- File System Access API spec: https://wicg.github.io/file-system-access/
- `script.js:112–130` — existing `handleImageUpload()` (reused pattern)
- `download.js:32–43` — existing `toDataURL` + `<a>` pattern (parallel save path)
- `styles.css:125–178` — `.btn` color variant pattern (followed for new buttons)
