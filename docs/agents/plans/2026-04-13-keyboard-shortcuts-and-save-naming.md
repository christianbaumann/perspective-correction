---
date: 2026-04-13T12:23:35Z
git_commit: be98d477bcdcc71db90f50906edc228fcc26648b
branch: main
topic: "Keyboard shortcuts (Arrow nav) and collision-safe save naming"
tags: [plan, folderBrowser, script, keyboard, shortcuts, save]
status: draft
---

# Keyboard Shortcuts (Arrow Nav) and Collision-Safe Save Naming

## Overview

Add ArrowRight/ArrowLeft keyboard navigation between folder images, remove the
auto-advance-after-save behaviour, and make `saveToOut` collision-safe (rename
the existing file before writing the new one rather than silently overwriting).

## Current State Analysis

- **One keyboard listener** in `script.js:167–172`: Enter → `applyPerspectiveCorrection()`. No arrow-key handling anywhere.
- **Auto-advance** lives in `handleSaveToOut` (`script.js:1027–1031`) and is also triggered from `applyPerspectiveCorrection` (`script.js:844–853`) whenever a folder is open.
- **`saveToOut`** (`folderBrowser.js:43–63`) calls `getFileHandle(name, { create: true })` which silently overwrites.
- **No `getPrevImageIndex`** exists — only `getNextImageIndex` (`folderBrowser.js:70–73`).
- **`saveToOutBtn`** is never re-enabled; the only functional save path is Enter → `applyPerspectiveCorrection` → `handleSaveToOut`.

## Desired End State

1. **ArrowRight** (folder open, no input focused): load next image.
2. **ArrowLeft** (folder open, no input focused): load previous image, wrapping.
3. **Auto-advance removed**: after save, the user stays on the current image.
4. **Collision-safe save**: if `out/scan001.png` exists, rename it to
   `out/scan001_0.png` (or `out/scan001_(n+1).png` if `_0`…`_n` already exist)
   before writing the new file.

### Key Discoveries

- `selectFolderImage(index)` at `script.js:942` is the single entry-point for loading any image — arrow handlers call it directly.
- `prefetchNextImage` is called for the *next* image only inside `selectFolderImage`; prefetch for the previous image is out of scope.
- `getFileHandle` on `FileSystemDirectoryHandle` without `{ create: true }` resolves to an existing handle — used to read the file bytes before renaming.
- `outDir.removeEntry(name)` is the correct FSAA API call for deletion.
- `File` extends `Blob`, so an existing file can be passed directly to `writable.write()`.
- `makeMockDirHandle` (`tests/helpers/mockFileSystem.js`) lacks `values()` and `removeEntry()` on `outDirHandle` — must be extended before collision tests can be written.
- The `mockFS` helper in `folderBrowser.spec.js` has a stateless `outDir` (always creates fresh handles) — needs to track files for the collision path.

## What We're NOT Doing

- Re-enabling `saveToOutBtn` (button remains disabled; Enter is the only save path).
- Adding prefetch for the previous image.
- Changing the Enter key behaviour (still calls `applyPerspectiveCorrection`).
- Adding collision logic for non-folder (single-image download) paths.

## Implementation Approach

Four tight **red → green** TDD cycles. Each phase: write the failing test(s)
first, then write just enough production code to make them pass. No phase ends
with tests written after the fact.

---

## Phase 1: `getPrevImageIndex` (TDD)

### Overview

Red: add unit tests for `getPrevImageIndex` (it doesn't exist — imports fail
immediately). Green: add the function. One small, self-contained cycle.

### Changes Required

#### [ ] 1. Write failing unit tests for `getPrevImageIndex`
**File**: `tests/unit/folderBrowser.test.js`

Add import of `getPrevImageIndex` from `../../folderBrowser.js` (this makes
the test file fail to resolve), then add the describe block:

```js
describe('getPrevImageIndex()', () => {
  it('returns 0 when current is 1 and total is 3', () =>        // [HAPPY]
    expect(getPrevImageIndex(1, 3)).toBe(0));
  it('wraps: first index returns last', () =>                   // [BVA]
    expect(getPrevImageIndex(0, 3)).toBe(2));
  it('mid-list step', () =>                                     // [ECP]
    expect(getPrevImageIndex(2, 3)).toBe(1));
  it('returns -1 when total is 0', () =>                        // [ECP]
    expect(getPrevImageIndex(0, 0)).toBe(-1));
  it('single image wraps to itself', () =>                      // [ECP]
    expect(getPrevImageIndex(0, 1)).toBe(0));
  it('handles large index', () =>                               // [ECP]
    expect(getPrevImageIndex(99, 100)).toBe(98));
});
```

Run `npm test` — confirm **red** (unknown export).

#### [ ] 2. Implement `getPrevImageIndex`
**File**: `folderBrowser.js` — add after `getNextImageIndex` (line 73):

```js
/**
 * Returns the index of the previous image.
 * Wraps around: before the first image returns the last.
 * Returns -1 if total is 0.
 */
export function getPrevImageIndex(currentIndex, total) {
  if (total === 0) return -1;
  return (currentIndex - 1 + total) % total;
}
```

### Success Criteria

#### Automated Verification
- [ ] `npm test` passes — all 6 new tests green, all prior tests still pass

**Pause here for manual confirmation before proceeding to Phase 2.**

---

## Phase 2: Collision-safe `saveToOut` (TDD)

### Overview

Red: extend the mock helper, write failing unit and integration tests for the
collision logic (`saveToOut` still overwrites). Green: rewrite `saveToOut`.
Also update the Playwright `mockFS` helper so E2E tests remain valid throughout
the rest of the plan.

### Changes Required

#### [ ] 3. Extend `makeMockDirHandle` with `outFiles` support
**File**: `tests/helpers/mockFileSystem.js`

Add optional `outFiles = []` third parameter. The `outDirHandle` mock gains
`values()` (yields existing out-file handles) and `removeEntry()`. The
`getFileHandle` mock returns the per-filename handle (for reads without
`{ create: true }`) or the default new-file handle (for writes with `{ create:
true }`). All existing callers are unaffected (`outFiles` defaults to `[]`).

```js
export function makeMockDirHandle(name = 'scans', entries = [], outFiles = []) {
  const children = new Map(entries.map(e => [e.name, e]));

  // Per-filename handles for existing out/ files (supports collision reads)
  const outFileHandles = new Map(outFiles.map(f => {
    const writable = makeMockWritable();
    const handle = {
      kind: 'file', name: f.name,
      getFile: vi.fn().mockResolvedValue(
        new File([f.content ?? 'existing-data'], f.name, { type: 'image/png' })
      ),
      createWritable: vi.fn().mockResolvedValue(writable),
      _writable: writable,
    };
    return [f.name, handle];
  }));

  const outWritable = makeMockWritable();
  const defaultOutFileHandle = {
    kind: 'file', name: 'out-file',
    createWritable: vi.fn().mockResolvedValue(outWritable),
    _writable: outWritable,
  };

  const outDirHandle = {
    kind: 'directory', name: 'out',
    values: vi.fn(async function* () { yield* outFileHandles.values(); }),
    getFileHandle: vi.fn((fname, opts) => {
      if (outFileHandles.has(fname) && !opts?.create)
        return Promise.resolve(outFileHandles.get(fname));
      return Promise.resolve(defaultOutFileHandle);
    }),
    removeEntry: vi.fn().mockResolvedValue(undefined),
    _fileHandle: defaultOutFileHandle,
  };

  return {
    kind: 'directory', name,
    values: vi.fn(async function* () { yield* children.values(); }),
    getDirectoryHandle: vi.fn().mockResolvedValue(outDirHandle),
    _outDirHandle: outDirHandle,
    _outFileHandle: defaultOutFileHandle,
    _outWritable: outWritable,
  };
}
```

#### [ ] 4. Update `mockFS` in E2E spec to track out-files statefully
**File**: `tests/e2e/folderBrowser.spec.js` — replace the static `outDir`
inside `mockFS` with a stateful version so that the collision path works and
`values()` / `removeEntry()` are available:

```js
const outFiles = new Map();
const makeWritable = () => ({ write: async () => {}, close: async () => {} });
const outDir = {
  kind: 'directory', name: 'out',
  values: async function* () { yield* outFiles.values(); },
  getFileHandle: async (name, opts) => {
    if (!opts?.create && outFiles.has(name)) return outFiles.get(name);
    const h = {
      kind: 'file', name,
      createWritable: async () => makeWritable(),
      getFile: async () => new File(['data'], name, { type: 'image/png' }),
    };
    if (opts?.create) outFiles.set(name, h);
    return h;
  },
  removeEntry: async (name) => { outFiles.delete(name); },
};
```

> This is test infrastructure only — no production code changes yet. All
> existing E2E tests should still pass after this change.

#### [ ] 5. Write failing unit tests for collision logic
**File**: `tests/unit/folderBrowser.test.js` — add to the `saveToOut` describe:

```js
// Collision cases (all fail until saveToOut is rewritten)
it('no collision: does not call removeEntry when out/ is empty',   // [HAPPY]
it('collision: renames existing to _0 when no suffix exists',      // [HAPPY]
it('collision: renames existing to _1 when _0 already exists',     // [BVA]
it('collision: _0…_3 present → renames to _4',                     // [BVA]
it('collision: removeEntry called with original filename',          // [HAPPY]
it('collision: new file written under original filename',           // [HAPPY]
it('no collision: unrelated files in out/ — no rename',            // [ECP]
it('base name with regex-special chars — no throw',                // [ERR]
```

Run `npm test` — confirm **red** (existing `saveToOut` overwrites without rename).

#### [ ] 6. Write failing integration test for collision pipeline
**File**: `tests/integration/folderBrowserPipeline.test.js`

```js
it('collision pipeline: existing file renamed, new file written as original name',
  async () => {
    const dirHandle = makeMockDirHandle(
      'scans', [makeMockFileHandle('doc.jpg')],
      [{ name: 'doc.png', content: 'old-data' }]   // pre-existing in out/
    );
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { dirHandle: dh } = await openFolder();
    const canvas = { toBlob: vi.fn((cb) => cb(new Blob(['new-data']))) };
    await saveToOut(dh, 'doc.png', canvas);

    const od = dh._outDirHandle;
    expect(od.removeEntry).toHaveBeenCalledWith('doc.png');
    // renamed copy written
    expect(od.getFileHandle).toHaveBeenCalledWith('doc_0.png', { create: true });
    // new file written under original name
    expect(od.getFileHandle).toHaveBeenCalledWith('doc.png', { create: true });
  }
);
```

Run `npm test` — confirm **red**.

#### [ ] 7. Rewrite `saveToOut` with collision logic
**File**: `folderBrowser.js:43–63` — replace entire function body:

```js
export async function saveToOut(dirHandle, filename, canvas) {
  const t0 = performance.now();
  const outDir = await dirHandle.getDirectoryHandle('out', { create: true });

  // Collect existing filenames in out/
  const existing = new Set();
  for await (const entry of outDir.values()) {
    if (entry.kind === 'file') existing.add(entry.name);
  }

  // Collision: rename existing file before writing the new one
  if (existing.has(filename)) {
    const base = filename.slice(0, filename.lastIndexOf('.'));
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffixRe = new RegExp(`^${escapedBase}_([0-9]+)\\.png$`);
    let maxN = -1;
    for (const name of existing) {
      const m = suffixRe.exec(name);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    const renamedFilename = `${base}_${maxN + 1}.png`;
    const existingHandle = await outDir.getFileHandle(filename);
    const existingFile = await existingHandle.getFile();
    const renamedHandle = await outDir.getFileHandle(renamedFilename, { create: true });
    const renamedWritable = await renamedHandle.createWritable();
    await renamedWritable.write(existingFile);
    await renamedWritable.close();
    await outDir.removeEntry(filename);
  }

  const fileHandle = await outDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  console.log(`[PERF]       saveToOut: FS handles ready: ${(performance.now() - t0).toFixed(1)}ms`);
  await new Promise((resolve, reject) => {
    const tBlob = performance.now();
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('toBlob returned null')); return; }
      console.log(`[PERF]       saveToOut: toBlob (PNG encode): ${(performance.now() - tBlob).toFixed(1)}ms (${(blob.size/1024/1024).toFixed(1)} MB)`);
      try {
        const tWrite = performance.now();
        await writable.write(blob);
        await writable.close();
        console.log(`[PERF]       saveToOut: file write+close: ${(performance.now() - tWrite).toFixed(1)}ms`);
        resolve();
      } catch (e) { reject(e); }
    }, 'image/png', 1.0);
  });
}
```

### Success Criteria

#### Automated Verification
- [ ] `npm test` passes — all new collision tests green, all prior tests still pass
- [ ] `npx playwright test tests/e2e/folderBrowser.spec.js` still passes (mockFS updated in step 4)

#### Manual Verification
- [ ] First save: `out/scan001.png` created normally
- [ ] Second save (same image): `out/` contains `scan001_0.png` (old) and `scan001.png` (new)

**Pause here for manual confirmation before proceeding to Phase 3.**

---

## Phase 3: Remove Auto-advance (TDD)

### Overview

Red: update the three E2E tests that currently assert auto-advance to assert
the opposite (user stays on current image). They immediately turn red because
auto-advance still happens. Green: delete the auto-advance block from
`handleSaveToOut`.

### Changes Required

#### [ ] 8. Update E2E tests to assert no-advance behaviour
**File**: `tests/e2e/folderBrowser.spec.js`

Replace auto-advance assertions in these three tests:

| Test | Old assertion | New assertion |
|---|---|---|
| `'correct → auto-save → auto-advance to next image'` | active item = `img2.jpg` | active item stays `img1.jpg`; rename to `'correct → save → stays on current image'` |
| `'wrap-around: correcting last image auto-advances to first image'` | active item = `a.png` | active item stays `b.png`; rename to `'correct → save → stays on same image (no wrap)'` |
| `'correct → auto-advance → points restored on next image'` | active item = `img2.png`, 4 points | active item stays `img1.png`; rename to `'correct → save → points not cleared'` (remove point-count assertion on next image, that moves to Phase 4) |

Run `npx playwright test tests/e2e/folderBrowser.spec.js` — confirm **red**
(auto-advance still fires, so the new "stays on current" assertions fail).

#### [ ] 9. Remove auto-advance from `handleSaveToOut`
**File**: `script.js:1027–1031` — delete:

```js
        // Auto-advance to next image
        const t1 = performance.now();
        const nextIndex = getNextImageIndex(currentFolderImageIndex, folderImages.length);
        console.log(`[PERF]   4. Loading next image (index ${nextIndex})...`);
        await selectFolderImage(nextIndex);
        console.log(`[PERF]   4b. Next image ready: ${(performance.now() - t1).toFixed(1)}ms`);
```

`handleSaveToOut` now ends after `saveToOutBtn.disabled = true`.

### Success Criteria

#### Automated Verification
- [ ] `npx playwright test tests/e2e/folderBrowser.spec.js` passes — updated tests green
- [ ] `npm test` still passes (no unit/integration regressions)

#### Manual Verification
- [ ] Enter (apply correction in folder mode): image saved, user stays on current image

**Pause here for manual confirmation before proceeding to Phase 4.**

---

## Phase 4: Arrow Key Navigation (TDD)

### Overview

Red: write E2E tests for ArrowRight/Left (keyboard handler doesn't handle these
yet — tests time out or stay on wrong image). Green: import `getPrevImageIndex`
and extend the `keydown` listener.

### Changes Required

#### [ ] 10. Write failing E2E tests for arrow navigation
**File**: `tests/e2e/folderBrowser.spec.js`

```js
test('ArrowRight navigates to next image', async ({ page }) => {  // [HAPPY]
  // open folder with [a.png, b.png, c.png], load first
  // press ArrowRight → expect active = b.png
});

test('ArrowRight wraps from last image to first', async ({ page }) => {  // [BVA]
  // navigate to last (c.png), press ArrowRight → expect active = a.png
});

test('ArrowLeft navigates to previous image', async ({ page }) => {  // [HAPPY]
  // open folder, click b.png, press ArrowLeft → expect active = a.png
});

test('ArrowLeft wraps from first image to last', async ({ page }) => {  // [BVA]
  // on a.png (first), press ArrowLeft → expect active = c.png (last)
});

test('Arrow keys do nothing when no folder is open', async ({ page }) => {  // [NEG]
  // go to page without opening folder
  // press ArrowRight → no error, no navigation
});

test('ArrowRight → points from previous image restored on new image', async ({ page }) => {  // [HAPPY]
  // apply correction on img1, press ArrowRight → img2 shows 4 points
});
```

Run `npx playwright test tests/e2e/folderBrowser.spec.js` — confirm **red**.

#### [ ] 11. Import `getPrevImageIndex` in `script.js`
**File**: `script.js` — add `getPrevImageIndex` to the existing named import
from `./folderBrowser.js`.

#### [ ] 12. Extend `keydown` listener with ArrowRight / ArrowLeft
**File**: `script.js:167–172` — replace:

```js
document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, button')) return;
    if (e.key === 'Enter') {
        e.preventDefault();
        applyPerspectiveCorrection();
    } else if (e.key === 'ArrowRight' && folderHandle && folderImages.length > 0) {
        e.preventDefault();
        selectFolderImage(getNextImageIndex(currentFolderImageIndex, folderImages.length));
    } else if (e.key === 'ArrowLeft' && folderHandle && folderImages.length > 0) {
        e.preventDefault();
        selectFolderImage(getPrevImageIndex(currentFolderImageIndex, folderImages.length));
    }
});
```

### Success Criteria

#### Automated Verification
- [ ] `npx playwright test tests/e2e/folderBrowser.spec.js` passes — all new arrow tests green
- [ ] `npm run test:all` fully green (unit + integration + e2e)

#### Manual Verification
- [ ] ArrowRight cycles forward through all images; wraps last → first
- [ ] ArrowLeft cycles backward; wraps first → last
- [ ] Arrow keys ignored when an `<input>` or `<button>` has focus
- [ ] Arrow keys ignored when no folder is open

---

## Test Design Techniques Applied

- **[ECP]** Equivalence class partitioning: `total=0`, `total=1`, `total>1` for index functions; no-collision vs collision for `saveToOut`.
- **[BVA]** Boundary value analysis: `currentIndex=0` and `currentIndex=total-1` for wrap cases; collision suffix `maxN=−1` (rename to `_0`) and `maxN=0` (rename to `_1`).
- **[ST]** State transition: arrow key guard — `folderHandle !== null && folderImages.length > 0`.
- **[ERR]** Error guessing: base name with regex-special characters; `getFile()` failure on existing handle.

## References

- Research document: `docs/agents/research/2026-04-13-keyboard-shortcuts-and-save-naming.md`
- `folderBrowser.js` — full implementation (84 lines)
- `script.js:167–172` — keyboard handler
- `script.js:1016–1037` — `handleSaveToOut`
- `tests/helpers/mockFileSystem.js` — mock infrastructure
- `tests/unit/folderBrowser.test.js`, `tests/integration/folderBrowserPipeline.test.js`, `tests/e2e/folderBrowser.spec.js`
