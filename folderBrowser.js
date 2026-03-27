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
