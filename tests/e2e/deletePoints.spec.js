import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#statusMessage')).toContainText('Sample image loaded', { timeout: 5000 });
});

async function addPoints(page, count) {
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  const positions = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];
  for (let i = 0; i < count; i++) {
    await canvas.click({ position: { x: box.width * positions[i].x, y: box.height * positions[i].y } });
    await expect(page.locator('#pointCount')).toHaveText(String(i + 1), { timeout: 5000 });
  }
}

test('delete a point reduces count', async ({ page }) => {
  await addPoints(page, 4);

  // Switch to delete mode
  await page.click('#deletePointsBtn');

  // Click on the first point (0.2, 0.2)
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.2 } });

  await expect(page.locator('#pointCount')).toHaveText('3', { timeout: 5000 });
});

test('delete all points one by one', async ({ page }) => {
  await addPoints(page, 4);

  await page.click('#deletePointsBtn');

  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();

  const positions = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ];

  for (let i = 0; i < 4; i++) {
    await canvas.click({ position: { x: box.width * positions[i].x, y: box.height * positions[i].y } });
    await expect(page.locator('#pointCount')).toHaveText(String(3 - i), { timeout: 5000 });
  }
});

test('clicking empty area in delete mode does nothing', async ({ page }) => {
  await addPoints(page, 4);

  await page.click('#deletePointsBtn');

  // Click in the center — far from all points
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });

  await expect(page.locator('#pointCount')).toHaveText('4', { timeout: 5000 });
});

test('delete mode button shows active state', async ({ page }) => {
  await page.click('#deletePointsBtn');
  await expect(page.locator('#deletePointsBtn')).toHaveClass(/active/, { timeout: 5000 });
});

test('transform button disables when count drops below 4', async ({ page }) => {
  await addPoints(page, 4);

  // Transform button should be enabled with 4 points
  await expect(page.locator('#transformBtn')).not.toBeDisabled({ timeout: 5000 });

  // Delete one point
  await page.click('#deletePointsBtn');
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.2 } });

  await expect(page.locator('#pointCount')).toHaveText('3', { timeout: 5000 });
  await expect(page.locator('#transformBtn')).toBeDisabled({ timeout: 5000 });
});

test('can add points after deleting', async ({ page }) => {
  await addPoints(page, 4);

  // Delete one point
  await page.click('#deletePointsBtn');
  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.2, y: box.height * 0.2 } });
  await expect(page.locator('#pointCount')).toHaveText('3', { timeout: 5000 });

  // Switch back to add mode and add a point
  await page.click('#addPointsBtn');
  await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(page.locator('#pointCount')).toHaveText('4', { timeout: 5000 });
});
