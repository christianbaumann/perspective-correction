import { test, expect } from '@playwright/test';

async function mockFS(page, { dirName = 'test-folder', imageFiles = [] } = {}) {
  await page.addInitScript(({ dirName, imageFiles }) => {
    const makeWritable = () => ({
      write: async () => {},
      close: async () => {},
    });
    const outDir = {
      kind: 'directory', name: 'out',
      getFileHandle: async (name) => ({
        kind: 'file', name,
        createWritable: async () => makeWritable(),
      }),
    };
    const fileHandles = imageFiles.map(({ name }) => ({
      kind: 'file', name,
      getFile: async () => {
        // Generate a small PNG via OffscreenCanvas (compatible with createImageBitmap)
        const oc = new OffscreenCanvas(4, 4);
        const ctx = oc.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 4, 4);
        const blob = await oc.convertToBlob({ type: 'image/png' });
        return new File([blob], name, { type: 'image/png' });
      },
    }));
    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: dirName,
      values: async function* () { yield* fileHandles; },
      getDirectoryHandle: async () => outDir,
    });
  }, { dirName, imageFiles });
}

/** Click 4 corners of the pointsCanvas and apply transformation */
async function applyCorrection(page) {
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  for (const [x, y] of [[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]]) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
  }
  await page.click('#transformBtn');
}

test('smoke: folder browser section visible and first image auto-loads into canvas', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [{ name: 'first.png', b64: '' }],
  });
  await page.goto('/');
  await expect(page.locator('#folderBrowserGroup')).toBeVisible();
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('first.png', { timeout: 5000 });
});

test('correct → auto-save → auto-advance to next image', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [
      { name: 'img1.jpg', b64: '' },
      { name: 'img2.jpg', b64: '' },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('img1.jpg', { timeout: 5000 });
  await applyCorrection(page);
  // Correction in folder mode auto-saves and auto-advances to next image
  await expect(page.locator('.folder-image-item.active')).toContainText('img2.jpg', { timeout: 5000 });
});

test('wrap-around: correcting last image auto-advances to first image', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [
      { name: 'a.png', b64: '' },
      { name: 'b.png', b64: '' },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await page.locator('.folder-image-item').nth(1).click();
  await expect(page.locator('#statusMessage')).toContainText('b.png', { timeout: 5000 });
  await applyCorrection(page);
  // Auto-save + auto-advance wraps around to first image
  await expect(page.locator('.folder-image-item.active')).toContainText('a.png', { timeout: 5000 });
});

test('single-image folder: stays on same image after correction', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [{ name: 'solo.jpg', b64: '' }],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('solo.jpg', { timeout: 5000 });
  await applyCorrection(page);
  // Auto-save wraps around to same (only) image
  await expect(page.locator('.folder-image-item.active')).toContainText('solo.jpg', { timeout: 5000 });
});

test('save failure shows error in status (permission denied on getDirectoryHandle)', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: 'locked',
      values: async function* () {
        const oc = new OffscreenCanvas(4, 4);
        const ctx = oc.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 4, 4);
        const blob = await oc.convertToBlob({ type: 'image/png' });
        yield { kind: 'file', name: 'img.png', getFile: async () => new File([blob], 'img.png', { type: 'image/png' }) };
      },
      getDirectoryHandle: async () => { throw new DOMException('Not allowed', 'NotAllowedError'); },
    });
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('img.png', { timeout: 5000 });
  await applyCorrection(page);
  // Auto-save triggers on correction in folder mode and hits the permission error
  await expect(page.locator('#statusMessage')).toContainText('Save failed', { timeout: 5000 });
  await expect(page.locator('#statusMessage')).toHaveClass(/error/);
});

test('correct → auto-advance → points restored on next image', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [
      { name: 'img1.png', b64: '' },
      { name: 'img2.png', b64: '' },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('img1.png', { timeout: 5000 });
  await applyCorrection(page);
  // In folder mode, applyPerspectiveCorrection auto-saves and auto-advances
  await expect(page.locator('.folder-image-item.active')).toContainText('img2.png', { timeout: 5000 });
  // Points should be restored on the new image
  await expect(page.locator('#pointCount')).toHaveText('4', { timeout: 5000 });
});

test('reset clears saved points — next image has no points', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [
      { name: 'a.png', b64: '' },
      { name: 'b.png', b64: '' },
      { name: 'c.png', b64: '' },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('a.png', { timeout: 5000 });
  await applyCorrection(page);
  // Auto-advances to b.png with points restored
  await expect(page.locator('.folder-image-item.active')).toContainText('b.png', { timeout: 5000 });
  await expect(page.locator('#pointCount')).toHaveText('4', { timeout: 5000 });
  // Reset all points — should clear saved points too
  await page.click('#resetBtn');
  await expect(page.locator('#pointCount')).toHaveText('0');
  // Navigate to next image manually — no points should appear
  await page.locator('.folder-image-item').nth(2).click();
  await expect(page.locator('#statusMessage')).toContainText('c.png', { timeout: 5000 });
  await expect(page.locator('#pointCount')).toHaveText('0');
});

test('regression: existing Upload Image drag-drop unaffected by folder browser', async ({ page }) => {
  await mockFS(page);
  await page.goto('/');
  await expect(page.locator('#fileUpload')).toBeVisible();
  await expect(page.locator('#imageInput')).toHaveCount(1);
});
