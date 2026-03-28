import { test, expect } from '@playwright/test';

// Corner zooms need enough side space — use a wide viewport
test.use({ viewport: { width: 1600, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#statusMessage')).toContainText('Sample image loaded', { timeout: 5000 });

  // Replace landscape sample with a portrait image so corner zooms have side space
  await page.evaluate(() => {
    return new Promise((resolve) => {
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='900'>
        <rect width='100%' height='100%' fill='#4dabf7'/>
        <text x='50%' y='50%' fill='white' font-size='40' text-anchor='middle' font-family='Arial'>Portrait</text>
      </svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const file = new File([blob], 'portrait.svg', { type: 'image/svg+xml' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('imageInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
      setTimeout(resolve, 500);
    });
  });

  await page.waitForTimeout(600);
});

test('4 zoom boxes visible after image load', async ({ page }) => {
  const cornerZooms = page.locator('.corner-zoom');
  await expect(cornerZooms).toHaveCount(4);

  await expect(page.locator('#cornerZoomTL')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#cornerZoomTR')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#cornerZoomBL')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#cornerZoomBR')).toBeVisible({ timeout: 5000 });
});

test('zoom boxes show point content after 4 clicks', async ({ page }) => {
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();

  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.2 } });
  await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.2 } });
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
  await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.8 } });

  await expect(page.locator('#pointCount')).toHaveText('4', { timeout: 5000 });

  await expect(page.locator('#cornerZoomTL')).toHaveClass(/has-point/, { timeout: 5000 });
  await expect(page.locator('#cornerZoomTR')).toHaveClass(/has-point/, { timeout: 5000 });
  await expect(page.locator('#cornerZoomBL')).toHaveClass(/has-point/, { timeout: 5000 });
  await expect(page.locator('#cornerZoomBR')).toHaveClass(/has-point/, { timeout: 5000 });
});

test('zoom boxes revert to placeholder on reset', async ({ page }) => {
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();

  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.2 } });
  await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.2 } });
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } });
  await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.8 } });

  await expect(page.locator('#pointCount')).toHaveText('4', { timeout: 5000 });

  await page.click('#resetBtn');

  await expect(page.locator('#cornerZoomTL')).not.toHaveClass(/has-point/, { timeout: 5000 });
  await expect(page.locator('#cornerZoomTR')).not.toHaveClass(/has-point/, { timeout: 5000 });
  await expect(page.locator('#cornerZoomBL')).not.toHaveClass(/has-point/, { timeout: 5000 });
  await expect(page.locator('#cornerZoomBR')).not.toHaveClass(/has-point/, { timeout: 5000 });
});
