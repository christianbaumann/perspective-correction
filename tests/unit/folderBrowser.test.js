import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isSupported, openFolder, loadImageFile, saveToOut,
  getNextImageIndex, getPrevImageIndex, deriveOutputFilename
} from '../../folderBrowser.js';
import {
  makeMockFileHandle, makeMockDirHandle, makeMockWritable
} from '../helpers/mockFileSystem.js';

// ─── isSupported ────────────────────────────────────────────────────────────

describe('isSupported()', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns true when showDirectoryPicker exists on window', () => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
    expect(isSupported()).toBe(true);
  });

  it('returns false when showDirectoryPicker is absent', () => {
    vi.stubGlobal('window', {});
    expect(isSupported()).toBe(false);
  });

  it('returns false when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(isSupported()).toBe(false);
  });
});

// ─── openFolder ─────────────────────────────────────────────────────────────

describe('openFolder()', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
  });

  it('returns dirHandle and sorted imageFiles for a mixed folder', async () => {
    const handles = [
      makeMockFileHandle('scan003.png'),
      makeMockFileHandle('notes.txt'),
      makeMockFileHandle('scan001.jpg'),
      makeMockFileHandle('scan002.webp'),
      { kind: 'directory', name: 'out' },
    ];
    const dirHandle = makeMockDirHandle('scans', handles);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);

    const result = await openFolder();

    expect(result.dirHandle).toBe(dirHandle);
    expect(result.imageFiles.map(f => f.name)).toEqual(
      ['scan001.jpg', 'scan002.webp', 'scan003.png']
    );
  });

  it('returns empty imageFiles for a folder with no images', async () => {
    const dirHandle = makeMockDirHandle('empty', [makeMockFileHandle('readme.txt')]);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles).toHaveLength(0);
  });

  it('accepts .jpeg extension (case-insensitive)', async () => {
    const handles = [
      makeMockFileHandle('IMG_001.JPEG'),
      makeMockFileHandle('img_002.Jpg'),
    ];
    const dirHandle = makeMockDirHandle('pics', handles);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles).toHaveLength(2);
  });

  it('requests readwrite mode from showDirectoryPicker', async () => {
    const dirHandle = makeMockDirHandle('d', []);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    await openFolder();
    expect(window.showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('propagates AbortError when user cancels the picker', async () => {
    const err = new DOMException('User aborted', 'AbortError');
    window.showDirectoryPicker.mockRejectedValue(err);
    await expect(openFolder()).rejects.toThrow('User aborted');
  });

  it('handles a folder containing only directory entries', async () => {
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

  it('handles a single image file in folder', async () => {
    const dirHandle = makeMockDirHandle('solo', [makeMockFileHandle('only.png')]);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles).toHaveLength(1);
    expect(imageFiles[0].name).toBe('only.png');
  });
});

// ─── loadImageFile ───────────────────────────────────────────────────────────

describe('loadImageFile()', () => {
  it('returns a File from a FileSystemFileHandle', async () => {
    const handle = makeMockFileHandle('scan001.jpg');
    const file = await loadImageFile(handle);
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('scan001.jpg');
  });

  it('propagates errors from fileHandle.getFile()', async () => {
    const handle = { getFile: vi.fn().mockRejectedValue(new Error('read error')) };
    await expect(loadImageFile(handle)).rejects.toThrow('read error');
  });
});

// ─── saveToOut ───────────────────────────────────────────────────────────────

describe('saveToOut()', () => {
  let mockCanvas;

  beforeEach(() => {
    mockCanvas = {
      toBlob: vi.fn((cb) => cb(new Blob(['png-data'], { type: 'image/png' }))),
    };
  });

  it('creates out/ dir, creates file, writes blob, closes writable', async () => {
    const dirHandle = makeMockDirHandle('scans');
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);

    expect(dirHandle.getDirectoryHandle).toHaveBeenCalledWith('out', { create: true });
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001.png', { create: true });
    expect(dirHandle._outWritable.write).toHaveBeenCalledTimes(1);
    expect(dirHandle._outWritable.close).toHaveBeenCalledTimes(1);
  });

  it('the written blob is a PNG', async () => {
    const dirHandle = makeMockDirHandle('scans');
    await saveToOut(dirHandle, 'out.png', mockCanvas);
    const [writtenBlob] = dirHandle._outWritable.write.mock.calls[0];
    expect(writtenBlob.type).toBe('image/png');
  });

  it('throws when toBlob returns null', async () => {
    mockCanvas.toBlob = vi.fn((cb) => cb(null));
    const dirHandle = makeMockDirHandle('scans');
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('toBlob returned null');
  });

  it('throws when getDirectoryHandle fails (permission denied)', async () => {
    const dirHandle = makeMockDirHandle('scans');
    dirHandle.getDirectoryHandle.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('Not allowed');
  });

  it('throws when writable.write fails', async () => {
    const dirHandle = makeMockDirHandle('scans');
    dirHandle._outWritable.write.mockRejectedValue(new Error('disk full'));
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('disk full');
  });

  it('throws when createWritable fails', async () => {
    const dirHandle = makeMockDirHandle('scans');
    dirHandle._outFileHandle.createWritable.mockRejectedValue(new Error('locked'));
    await expect(saveToOut(dirHandle, 'out.png', mockCanvas)).rejects.toThrow('locked');
  });

  // Collision cases
  it('no collision: does not call removeEntry when out/ is empty', async () => {
    const dirHandle = makeMockDirHandle('scans', [], []);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.removeEntry).not.toHaveBeenCalled();
  });

  it('collision: renames existing to _0 when no suffix exists', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [{ name: 'scan001.png' }]);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001_0.png', { create: true });
  });

  it('collision: renames existing to _1 when _0 already exists, writes _2', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [
      { name: 'scan001.png' },
      { name: 'scan001_0.png' },
    ]);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001_1.png', { create: true });
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001_2.png', { create: true });
  });

  it('collision: _0…_3 present → renames to _4, writes _5', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [
      { name: 'scan001.png' },
      { name: 'scan001_0.png' },
      { name: 'scan001_1.png' },
      { name: 'scan001_2.png' },
      { name: 'scan001_3.png' },
    ]);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001_4.png', { create: true });
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001_5.png', { create: true });
  });

  it('collision: only suffixed files exist (no bare file) → writes next suffix', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [
      { name: 'scan001_0.png' },
      { name: 'scan001_1.png' },
    ]);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.removeEntry).not.toHaveBeenCalled();
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001_2.png', { create: true });
  });

  it('collision: removeEntry called with original filename', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [{ name: 'scan001.png' }]);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.removeEntry).toHaveBeenCalledWith('scan001.png');
  });

  it('collision: new file written under incremented filename', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [{ name: 'scan001.png' }]);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.getFileHandle).toHaveBeenCalledWith('scan001_1.png', { create: true });
  });

  it('no collision: unrelated files in out/ — no rename', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [{ name: 'other.png' }]);
    await saveToOut(dirHandle, 'scan001.png', mockCanvas);
    expect(dirHandle._outDirHandle.removeEntry).not.toHaveBeenCalled();
  });

  it('base name with regex-special chars — no throw', async () => {
    const dirHandle = makeMockDirHandle('scans', [], [{ name: 'scan(001).png' }]);
    await expect(saveToOut(dirHandle, 'scan(001).png', mockCanvas)).resolves.toBeUndefined();
  });
});

// ─── getNextImageIndex ────────────────────────────────────────────────────────

describe('getNextImageIndex()', () => {
  it('returns 1 when current is 0 and total is 3', () => {
    expect(getNextImageIndex(0, 3)).toBe(1);
  });

  it('wraps around: last index returns 0', () => {
    expect(getNextImageIndex(2, 3)).toBe(0);
  });

  it('returns 0 when current is second-to-last', () => {
    expect(getNextImageIndex(1, 2)).toBe(0);
  });

  it('returns -1 when total is 0', () => {
    expect(getNextImageIndex(0, 0)).toBe(-1);
  });

  it('returns 0 for a single image (wraps to itself)', () => {
    expect(getNextImageIndex(0, 1)).toBe(0);
  });

  it('handles large index correctly', () => {
    expect(getNextImageIndex(99, 100)).toBe(0);
  });
});

// ─── getPrevImageIndex ────────────────────────────────────────────────────────

describe('getPrevImageIndex()', () => {
  it('returns 0 when current is 1 and total is 3', () =>
    expect(getPrevImageIndex(1, 3)).toBe(0));
  it('wraps: first index returns last', () =>
    expect(getPrevImageIndex(0, 3)).toBe(2));
  it('mid-list step', () =>
    expect(getPrevImageIndex(2, 3)).toBe(1));
  it('returns -1 when total is 0', () =>
    expect(getPrevImageIndex(0, 0)).toBe(-1));
  it('single image wraps to itself', () =>
    expect(getPrevImageIndex(0, 1)).toBe(0));
  it('handles large index', () =>
    expect(getPrevImageIndex(99, 100)).toBe(98));
});

// ─── deriveOutputFilename ─────────────────────────────────────────────────────

describe('deriveOutputFilename()', () => {
  it('replaces .jpg extension with .png', () => {
    expect(deriveOutputFilename('scan001.jpg')).toBe('scan001.png');
  });

  it('replaces .jpeg extension with .png', () => {
    expect(deriveOutputFilename('photo.jpeg')).toBe('photo.png');
  });

  it('replaces .webp extension with .png', () => {
    expect(deriveOutputFilename('doc.webp')).toBe('doc.png');
  });

  it('handles a file that already has .png extension', () => {
    expect(deriveOutputFilename('scan.png')).toBe('scan.png');
  });

  it('handles filenames with dots in the name', () => {
    expect(deriveOutputFilename('scan.2024.01.jpg')).toBe('scan.2024.01.png');
  });

  it('handles filename with no extension', () => {
    expect(deriveOutputFilename('noext')).toBe('noext.png');
  });

  it('handles empty string', () => {
    expect(deriveOutputFilename('')).toBe('.png');
  });
});
