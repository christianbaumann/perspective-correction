# Perspective Correction

Browser-based document perspective correction tool. Upload an image, select 4+ corner points on a document, and get a rectified front-facing view. All processing is client-side — no server uploads.

Live: https://ni-kit-mht.github.io/perspective-correction/

## Run locally

```bash
node server.cjs   # or: npm run serve — http://localhost:3000
```

Plain HTML/CSS/JS with ES modules — no build step.

## Usage

1. Upload an image (or open a folder to batch-process)
2. Select 4+ corner points on the document — drag to adjust, click in delete mode to remove
3. Apply the correction (button or **Enter**)
4. Download, print, or save to the folder's `out/` subfolder

A live **3× zoom preview** follows the cursor for precise point placement, and an optional **grid overlay** (auto white/black for contrast) helps with alignment.

### Folder Browser (Chrome only)

Open a local folder to batch-process scans:

- Browse images in the left panel; the active image auto-scrolls into view
- Points are **normalized and re-applied** to each image, so a corner layout carries across a batch
- Applying a correction saves the corrected crop to `out/` with a numbered suffix (`_0`, `_1`, `_2`, …) and keeps you on the current image
- Your folder, position, and points are **restored on page reload**

Uses the File System Access API (Chrome/Edge).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| **Enter** | Apply correction (and save, in folder mode) |
| **→** / **←** | Next / previous folder image (wraps) |
| **Space** | Reset all points |

## Testing

```bash
npm test            # unit + integration (vitest)
npx playwright test # e2e (Chromium)
```

See [CLAUDE.md](CLAUDE.md) for architecture and the full developer command set.
