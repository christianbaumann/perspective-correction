import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openFolder, loadImageFile, saveToOut, deriveOutputFilename } from '../../folderBrowser.js';
import { makeMockDirHandle, makeMockFileHandle } from '../helpers/mockFileSystem.js';

beforeEach(() => {
  vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
});

describe('open → load → save pipeline', () => {
  it('full happy path: open folder, load first image, save PNG to out/', async () => {
    const dirHandle = makeMockDirHandle('scans', [makeMockFileHandle('doc.jpg')]);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);

    const { imageFiles, dirHandle: dh } = await openFolder();
    expect(imageFiles).toHaveLength(1);

    const file = await loadImageFile(imageFiles[0].handle);
    expect(file.name).toBe('doc.jpg');

    const canvas = { toBlob: vi.fn((cb) => cb(new Blob(['data'], { type: 'image/png' }))) };
    await saveToOut(dh, deriveOutputFilename('doc.jpg'), canvas);

    expect(dh._outDirHandle.getFileHandle).toHaveBeenCalledWith('doc_0.png', { create: true });
    expect(dh._outWritable.write).toHaveBeenCalled();
    expect(dh._outWritable.close).toHaveBeenCalled();
  });

  it('sorts 100 images alphabetically across the open→list pipeline', async () => {
    const handles = Array.from({ length: 100 }, (_, i) =>
      makeMockFileHandle(`img${String(i).padStart(3, '0')}.jpg`)
    );
    const dirHandle = makeMockDirHandle('large', handles);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { imageFiles } = await openFolder();
    expect(imageFiles[0].name).toBe('img000.jpg');
    expect(imageFiles[99].name).toBe('img099.jpg');
  });

  it('saveToOut still creates out/ dir even when imageFiles list was empty', async () => {
    const dirHandle = makeMockDirHandle('empty', []);
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    await openFolder();
    const canvas = { toBlob: vi.fn((cb) => cb(new Blob(['x']))) };
    await saveToOut(dirHandle, 'test.png', canvas);
    expect(dirHandle.getDirectoryHandle).toHaveBeenCalledWith('out', { create: true });
  });

  it('collision pipeline: _0 exists → saves as _1', async () => {
    const dirHandle = makeMockDirHandle(
      'scans', [makeMockFileHandle('doc.jpg')],
      [{ name: 'doc_0.png', content: 'old-data' }]
    );
    window.showDirectoryPicker.mockResolvedValue(dirHandle);
    const { dirHandle: dh } = await openFolder();
    const canvas = { toBlob: vi.fn((cb) => cb(new Blob(['new-data']))) };
    await saveToOut(dh, 'doc.png', canvas);

    const od = dh._outDirHandle;
    expect(od.removeEntry).not.toHaveBeenCalled();
    expect(od.getFileHandle).toHaveBeenCalledWith('doc_1.png', { create: true });
  });
});
