# Perspective Correction

Browser-based document perspective correction tool. Upload an image, select 4+ corner points, and get a rectified front-facing view. All processing is client-side.

## Usage

```bash
node server.cjs  # http://localhost:3000
```

1. Upload an image (or open a folder to batch-process)
2. Select 4+ corner points on the document
3. Click "Correct Perspective"
4. Download, print, or save to `out/` subfolder

### Folder Browser (Chrome)

Open a local folder to browse images, apply corrections, and auto-save + advance to the next image. Points persist across images for batch workflows.

## Testing

```bash
npm test                 # unit + integration (vitest)
npx playwright test      # e2e (Chromium)
```
