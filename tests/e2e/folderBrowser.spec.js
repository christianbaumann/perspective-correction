import { test, expect } from '@playwright/test';

// Minimal 1x1 white PNG as base64
const WHITE_1X1_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';

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
    const fileHandles = imageFiles.map(({ name, b64 }) => ({
      kind: 'file', name,
      getFile: async () => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));
        return new File([bytes], name, { type: 'image/png' });
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
    imageFiles: [{ name: 'first.png', b64: WHITE_1X1_PNG }],
  });
  await page.goto('/');
  await expect(page.locator('#folderBrowserGroup')).toBeVisible();
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('first.png', { timeout: 5000 });
});

test('correct → save → auto-advance to next image', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [
      { name: 'img1.jpg', b64: WHITE_1X1_PNG },
      { name: 'img2.jpg', b64: WHITE_1X1_PNG },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('img1.jpg', { timeout: 5000 });
  await applyCorrection(page);
  await expect(page.locator('#saveToOutBtn')).toBeEnabled();
  await page.click('#saveToOutBtn');
  // Save auto-advances to next image; status may already show "Loaded img2" by now
  await expect(page.locator('.folder-image-item.active')).toContainText('img2.jpg');
});

test('wrap-around: saving last image loads first image', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [
      { name: 'a.png', b64: WHITE_1X1_PNG },
      { name: 'b.png', b64: WHITE_1X1_PNG },
    ],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await page.locator('.folder-image-item').nth(1).click();
  await expect(page.locator('#statusMessage')).toContainText('b.png', { timeout: 5000 });
  await applyCorrection(page);
  await page.click('#saveToOutBtn');
  await expect(page.locator('.folder-image-item.active')).toContainText('a.png');
});

test('single-image folder: stays on same image after save', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [{ name: 'solo.jpg', b64: WHITE_1X1_PNG }],
  });
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('solo.jpg', { timeout: 5000 });
  await applyCorrection(page);
  await page.click('#saveToOutBtn');
  await expect(page.locator('.folder-image-item.active')).toContainText('solo.jpg');
});

test('save failure shows error in status (permission denied on getDirectoryHandle)', async ({ page }) => {
  const b64 = WHITE_1X1_PNG;
  await page.addInitScript((b64) => {
    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: 'locked',
      values: async function* () {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length).map((_, i) => bin.charCodeAt(i));
        yield { kind: 'file', name: 'img.png', getFile: async () => new File([bytes], 'img.png', { type: 'image/png' }) };
      },
      getDirectoryHandle: async () => { throw new DOMException('Not allowed', 'NotAllowedError'); },
    });
  }, b64);
  await page.goto('/');
  await page.click('#openFolderBtn');
  await expect(page.locator('#statusMessage')).toContainText('img.png', { timeout: 5000 });
  await applyCorrection(page);
  await page.click('#saveToOutBtn');
  await expect(page.locator('#statusMessage')).toContainText('Save failed');
  await expect(page.locator('#statusMessage')).toHaveClass(/error/);
});

test('correct → auto-advance → points restored on next image', async ({ page }) => {
  await mockFS(page, {
    imageFiles: [
      { name: 'img1.png', b64: WHITE_1X1_PNG },
      { name: 'img2.png', b64: WHITE_1X1_PNG },
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
      { name: 'a.png', b64: WHITE_1X1_PNG },
      { name: 'b.png', b64: WHITE_1X1_PNG },
      { name: 'c.png', b64: WHITE_1X1_PNG },
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
