import { test, expect } from '@playwright/test';

/**
 * Performance benchmark for image loading in folder browser.
 *
 * Uses real 2268×4032 PNG images (~10MB each) served from
 * tests/fixtures/perf-images/ via the local server.
 *
 * NOTE: Playwright Chrome decodes PNGs ~100x faster than real Chrome
 * (native decode pipeline not affected by CPU throttling). The absolute
 * decode times here (~25ms) don't match real Chrome (~2-4s), but the
 * RELATIVE comparison before/after is valid: prefetch HIT eliminates
 * the decode step entirely, and that shows clearly in these tests.
 *
 * Run BEFORE and AFTER implementation:
 *   npx playwright test tests/e2e/performanceBenchmark.spec.js
 */

test.use({ headless: false });

const IMAGE_NAMES = ['img_001.png', 'img_002.png', 'img_003.png', 'img_004.png'];
const FIXTURE_PATH = '/tests/fixtures/perf-images';

async function mockFSWithRealImages(page, { imageNames = IMAGE_NAMES } = {}) {
  await page.addInitScript(({ imageNames, FIXTURE_PATH }) => {
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

    const fileHandles = imageNames.map((name) => ({
      kind: 'file',
      name,
      getFile: async () => {
        const resp = await fetch(`${FIXTURE_PATH}/${name}`);
        const blob = await resp.blob();
        return new File([blob], name, { type: 'image/png' });
      },
    }));

    window.showDirectoryPicker = async () => ({
      kind: 'directory', name: 'perf-test-folder',
      values: async function* () { yield* fileHandles; },
      getDirectoryHandle: async () => outDir,
    });
  }, { imageNames, FIXTURE_PATH });
}

/** Extract numeric ms value from a PERF log line like "[PERF]     img decode: 45.8ms ..." */
function extractMs(logText) {
  const m = logText.match(/([\d.]+)ms/);
  return m ? parseFloat(m[1]) : null;
}

/** Find a specific PERF metric from collected logs */
function findPerfMetric(logs, keyword) {
  const entry = logs.find(l => l.text.includes(keyword));
  return entry ? extractMs(entry.text) : null;
}

/** Collect [PERF] log lines from the browser console. */
function collectPerfLogs(page) {
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PERF]')) {
      logs.push({ time: Date.now(), text });
    }
  });
  return logs;
}

/** Print a summary table of PERF metrics */
function printPerfSummary(title, perfLogs) {
  const decode = findPerfMetric(perfLogs, 'img decode') ??
                 findPerfMetric(perfLogs, 'createImageBitmap') ??
                 findPerfMetric(perfLogs, 'prefetch HIT');
  const setup = findPerfMetric(perfLogs, 'setupCanvas');
  const total = findPerfMetric(perfLogs, 'selectFolderImage total');
  const prefetchHit = perfLogs.some(l => l.text.includes('prefetch HIT'));

  console.log(`\n=== ${title} ===`);
  perfLogs.forEach(l => console.log(`  ${l.text}`));
  console.log(`  ──────────────────────────────────`);
  console.log(`  img decode:              ${decode != null ? decode.toFixed(1) + 'ms' : 'N/A'}`);
  console.log(`  setupCanvas:             ${setup != null ? setup.toFixed(1) + 'ms' : 'N/A'}`);
  console.log(`  selectFolderImage total: ${total != null ? total.toFixed(1) + 'ms' : 'N/A'}`);
  console.log(`  prefetch HIT:            ${prefetchHit ? 'YES' : 'no'}`);
  console.log(`===\n`);

  return { decode, setup, total, prefetchHit };
}

test.describe('Image Loading Performance Benchmark (real 2268×4032 PNGs)', () => {

  test('benchmark: full 4-image sequence with all scenarios', async ({ page }) => {
    await mockFSWithRealImages(page);
    const perfLogs = collectPerfLogs(page);
    const results = [];

    await page.goto('/');

    // --- 1. First image load ---
    await page.click('#openFolderBtn');
    await expect(page.locator('#statusMessage')).toContainText('img_001.png', { timeout: 60000 });
    const r1 = printPerfSummary('1. FIRST IMAGE LOAD (cold)', perfLogs.splice(0));
    results.push({ scenario: 'First load (cold)', ...r1 });

    // Wait for any prefetch to complete
    await page.waitForTimeout(5000);

    // --- 2. Sequential advance (prefetch should help after implementation) ---
    await page.locator('.folder-image-item').nth(1).click();
    await expect(page.locator('#statusMessage')).toContainText('img_002.png', { timeout: 60000 });
    const r2 = printPerfSummary('2. SEQUENTIAL ADVANCE → img_002 (prefetch target)', perfLogs.splice(0));
    results.push({ scenario: 'Sequential advance', ...r2 });

    await page.waitForTimeout(5000);

    // --- 3. Non-sequential jump (prefetch miss) ---
    await page.locator('.folder-image-item').nth(3).click();
    await expect(page.locator('#statusMessage')).toContainText('img_004.png', { timeout: 60000 });
    const r3 = printPerfSummary('3. NON-SEQUENTIAL JUMP → img_004 (prefetch miss)', perfLogs.splice(0));
    results.push({ scenario: 'Non-sequential jump', ...r3 });

    await page.waitForTimeout(5000);

    // --- 4. Save → auto-advance ---
    const canvas = page.locator('#pointsCanvas');
    const box = await canvas.boundingBox();
    for (const [x, y] of [[0.1,0.1],[0.9,0.1],[0.9,0.9],[0.1,0.9]]) {
      await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    }
    await page.click('#transformBtn');
    // Auto-advance wraps from img_004 (index 3) → img_001 (index 0)
    // But prefetch would have targeted index 0 (next after 3 in 4-image folder)
    await expect(page.locator('#statusMessage')).toContainText('img_001.png', { timeout: 60000 });
    const r4 = printPerfSummary('4. SAVE → AUTO-ADVANCE → img_001 (wrap-around)', perfLogs.splice(0));
    results.push({ scenario: 'Save + auto-advance', ...r4 });

    // --- Summary table ---
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║       PERFORMANCE BENCHMARK SUMMARY (2268×4032 PNGs, ~10MB)      ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    console.log('║  Scenario               decode    setup    total   prefetch?     ║');
    console.log('╠═══════════════════════════════════════════════════════════════════╣');
    for (const r of results) {
      const dec = r.decode != null ? `${r.decode.toFixed(0)}ms`.padStart(6) : '   N/A';
      const set = r.setup != null ? `${r.setup.toFixed(0)}ms`.padStart(6) : '   N/A';
      const tot = r.total != null ? `${r.total.toFixed(0)}ms`.padStart(6) : '   N/A';
      const pf = r.prefetchHit ? '  HIT' : '   no';
      console.log(`║  ${r.scenario.padEnd(22)} ${dec}  ${set}  ${tot}   ${pf}        ║`);
    }
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    console.log('NOTE: Playwright decode times (~25ms) << real Chrome (~2000-4000ms).');
    console.log('The relative improvement from prefetch HIT is what matters.\n');
  });
});
