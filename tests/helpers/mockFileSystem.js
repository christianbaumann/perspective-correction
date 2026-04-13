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
    kind: 'directory',
    name,
    values: vi.fn(async function* () { yield* children.values(); }),
    getDirectoryHandle: vi.fn().mockResolvedValue(outDirHandle),
    _outDirHandle: outDirHandle,
    _outFileHandle: defaultOutFileHandle,
    _outWritable: outWritable,
  };
}
