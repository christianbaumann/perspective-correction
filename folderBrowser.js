// Accepted image MIME types and extensions
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Returns true if the File System Access API is available (Chrome/Edge 86+).
 */
export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Scans a directory handle for image files.
 * Returns sorted array of { name, handle }.
 */
export async function scanFolder(dirHandle) {
  const imageFiles = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== 'file') continue;
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      imageFiles.push({ name: entry.name, handle: entry });
    }
  }
  imageFiles.sort((a, b) => a.name.localeCompare(b.name));
  return imageFiles;
}

/**
 * Prompts the user to pick a folder.
 * Returns { dirHandle, imageFiles: Array<{name, handle}> }.
 * imageFiles is sorted alphabetically.
 * Throws if user cancels (AbortError).
 */
export async function openFolder() {
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const imageFiles = await scanFolder(dirHandle);
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
  const t0 = performance.now();
  const outDir = await dirHandle.getDirectoryHandle('out', { create: true });

  // Collect existing filenames in out/
  const existing = new Set();
  for await (const entry of outDir.values()) {
    if (entry.kind === 'file') existing.add(entry.name);
  }

  // Always save with numbered suffix: _0, _1, _2, …
  const base = filename.slice(0, filename.lastIndexOf('.'));
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffixRe = new RegExp(`^${escapedBase}_([0-9]+)\\.png$`);
  let maxN = -1;
  for (const name of existing) {
    const m = suffixRe.exec(name);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  filename = `${base}_${maxN + 1}.png`;

  const fileHandle = await outDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  console.log(`[PERF]       saveToOut: FS handles ready: ${(performance.now() - t0).toFixed(1)}ms`);
  return new Promise((resolve, reject) => {
    const tBlob = performance.now();
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('toBlob returned null')); return; }
      console.log(`[PERF]       saveToOut: toBlob (PNG encode): ${(performance.now() - tBlob).toFixed(1)}ms (${(blob.size/1024/1024).toFixed(1)} MB)`);
      try {
        const tWrite = performance.now();
        await writable.write(blob);
        await writable.close();
        console.log(`[PERF]       saveToOut: file write+close: ${(performance.now() - tWrite).toFixed(1)}ms`);
        resolve(filename);
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
 * Returns the index of the previous image.
 * Wraps around: before the first image returns the last.
 * Returns -1 if total is 0.
 */
export function getPrevImageIndex(currentIndex, total) {
  if (total === 0) return -1;
  return (currentIndex - 1 + total) % total;
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
