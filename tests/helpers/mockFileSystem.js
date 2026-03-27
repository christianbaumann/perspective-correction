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
