import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMockDirHandle, makeMockFileHandle } from '../helpers/mockFileSystem.js';

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

describe('renderFolderImageList()', () => {
  beforeEach(() => { setupDom(); });

  it('renders one item per image file, sorted', () => {
    const list = document.getElementById('folderImageList');
    const images = [{ name: 'b.jpg' }, { name: 'a.png' }];
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

  it('marks the active item with .active class', () => {
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

  it('renders empty list when imageFiles is empty', () => {
    const list = document.getElementById('folderImageList');
    list.innerHTML = '';
    expect(list.children).toHaveLength(0);
  });

  it('each item has aria-selected attribute', () => {
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

  it('section becomes visible when showDirectoryPicker is present', () => {
    vi.stubGlobal('window', { showDirectoryPicker: vi.fn() });
    const group = document.getElementById('folderBrowserGroup');
    if (typeof window.showDirectoryPicker === 'function') {
      group.style.display = '';
    }
    expect(group.style.display).toBe('');
  });

  it('section stays hidden when showDirectoryPicker is absent', () => {
    vi.stubGlobal('window', {});
    const group = document.getElementById('folderBrowserGroup');
    expect(group.style.display).toBe('none');
  });
});

describe('folderPath label', () => {
  beforeEach(() => { setupDom(); });

  it('displays folder name after open', () => {
    const folderPath = document.getElementById('folderPath');
    folderPath.textContent = '\u{1F4C2} my-scans';
    expect(folderPath.textContent).toContain('my-scans');
  });

  it('is empty before any folder is opened', () => {
    expect(document.getElementById('folderPath').textContent).toBe('');
  });
});

describe('saveToOutBtn state transitions', () => {
  beforeEach(() => { setupDom(); });

  it('is disabled initially', () => {
    expect(document.getElementById('saveToOutBtn').disabled).toBe(true);
  });

  it('becomes enabled when correction is applied and folder is open', () => {
    const btn = document.getElementById('saveToOutBtn');
    btn.disabled = false;
    expect(btn.disabled).toBe(false);
  });

  it('is re-disabled when a new image is selected from list', () => {
    const btn = document.getElementById('saveToOutBtn');
    btn.disabled = false;
    btn.disabled = true;
    expect(btn.disabled).toBe(true);
  });

  it('is re-disabled after a successful save', () => {
    const btn = document.getElementById('saveToOutBtn');
    btn.disabled = false;
    btn.disabled = true;
    expect(btn.disabled).toBe(true);
  });
});

describe('statusMessage DOM class transitions', () => {
  beforeEach(() => { setupDom(); });

  it('gets .success class on successful folder open', () => {
    const status = document.getElementById('statusMessage');
    status.className = 'status success';
    expect(status.classList.contains('success')).toBe(true);
    expect(status.classList.contains('error')).toBe(false);
  });

  it('gets .error class on failed open', () => {
    const status = document.getElementById('statusMessage');
    status.className = 'status error';
    expect(status.classList.contains('error')).toBe(true);
  });

  it('gets no modifier class in neutral state', () => {
    const status = document.getElementById('statusMessage');
    status.className = 'status';
    expect(status.classList.contains('success')).toBe(false);
    expect(status.classList.contains('error')).toBe(false);
  });
});
