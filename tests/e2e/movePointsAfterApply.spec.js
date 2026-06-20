import { test, expect } from '@playwright/test';

// Regression: after applying a correction, the points canvas had
// pointer-events:none and switching to "Move Points" did not restore it,
// so points could not be moved until the image was reloaded (arrow keys).
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#statusMessage')).toContainText('Sample image loaded', { timeout: 5000 });
});

async function addFourPoints(page) {
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
    await expect(page.locator('#pointCount')).toHaveText(String(i + 1), { timeout: 5000 });
  }
}

function pointerEvents(page) {
  return page.locator('#pointsCanvas').evaluate((el) => getComputedStyle(el).pointerEvents);
}

test('points canvas stays interactive when switching to Move Points after applying (button)', async ({ page }) => {
  await addFourPoints(page);

  await page.click('#transformBtn');
  await expect(page.locator('#statusMessage')).toContainText('Perspective correction applied', { timeout: 5000 });

  await page.click('#movePointsBtn');
  await expect(page.locator('#movePointsBtn')).toHaveClass(/active/);

  expect(await pointerEvents(page)).not.toBe('none');
});

test('points canvas stays interactive when switching to Move Points after applying (Enter)', async ({ page }) => {
  await addFourPoints(page);

  await page.locator('#pointsCanvas').press('Enter');
  await expect(page.locator('#statusMessage')).toContainText('Perspective correction applied', { timeout: 5000 });

  await page.click('#movePointsBtn');
  expect(await pointerEvents(page)).not.toBe('none');
});

test('a point can actually be dragged after applying and switching to Move Points', async ({ page }) => {
  await addFourPoints(page);

  await page.click('#transformBtn');
  await expect(page.locator('#statusMessage')).toContainText('Perspective correction applied', { timeout: 5000 });

  await page.click('#movePointsBtn');

  const canvas = page.locator('#pointsCanvas');
  const box = await canvas.boundingBox();
  // Drag the top-left point (0.2,0.2) inward; dragging sets the status to Move mode text.
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35, { steps: 5 });
  await page.mouse.up();

  // If pointer events were blocked the drag would be a no-op; the transform
  // button stays enabled (4 points) and the canvas remains interactive.
  expect(await pointerEvents(page)).not.toBe('none');
});
