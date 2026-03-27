import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizePoints, denormalizePoints } from '../../helpers.js';

/**
 * Integration tests for the point persistence state cycle.
 *
 * script.js initializes at import time (DOM queries, event listeners) so we
 * cannot import it directly in jsdom. Instead we replicate the state-flow
 * logic from the relevant functions and verify the observable outcomes.
 */

// ─── Shared DOM + state helpers ─────────────────────────────────────────────

function setupDom() {
  document.body.innerHTML = `
    <div class="canvas-wrapper" style="width:800px;height:600px">
      <canvas id="sourceCanvas"></canvas>
      <canvas id="pointsCanvas"></canvas>
    </div>
    <span id="pointCount">0</span>
    <button id="transformBtn" disabled></button>
    <button id="downloadBtn" disabled></button>
    <button id="resetBtn"></button>
    <button id="printBtn" disabled></button>
    <button id="saveToOutBtn" disabled></button>
    <div id="statusMessage" class="status"></div>
  `;
}

/** Minimal state container mirroring script.js module-level variables */
function createState() {
  return {
    points: [],
    savedNormalizedPoints: null,
    folderHandle: null,
    currentFolderImageIndex: -1,
  };
}

/** Mirrors updatePointCount() from script.js */
function updatePointCount(state) {
  const el = document.getElementById('pointCount');
  el.textContent = state.points.length;
  document.getElementById('transformBtn').disabled = state.points.length < 4;
}

/** Stub drawPoints — we just need to know it was called */
const drawPoints = vi.fn();

/**
 * Mirrors the save logic inside applyPerspectiveCorrection() when in
 * folder-browser mode.
 */
function simulateApplyCorrection(state, canvasWidth, canvasHeight) {
  if (state.folderHandle && state.currentFolderImageIndex >= 0) {
    state.savedNormalizedPoints = normalizePoints(
      state.points, canvasWidth, canvasHeight
    );
  }
}

/** Mirrors resetAllPoints() from script.js */
function simulateReset(state) {
  state.points = [];
  state.savedNormalizedPoints = null;
  updatePointCount(state);
  drawPoints();
}

/**
 * Mirrors the restore-points logic inside selectFolderImage()'s img.onload.
 * In the real code, pendingPoints is captured before resetAllPoints clears
 * savedNormalizedPoints.
 */
function simulateSelectFolderImage(state, newWidth, newHeight) {
  // Capture before reset (matches real code: const pendingPoints = savedNormalizedPoints)
  const pendingPoints = state.savedNormalizedPoints;

  // setupCanvas sets canvas dimensions and clears points
  const sourceCanvas = document.getElementById('sourceCanvas');
  sourceCanvas.width = newWidth;
  sourceCanvas.height = newHeight;
  state.points = [];

  // resetAllPoints clears savedNormalizedPoints
  state.savedNormalizedPoints = null;
  updatePointCount(state);

  // Restore saved points from previous image (scaled to new dimensions)
  if (pendingPoints && pendingPoints.length > 0) {
    state.savedNormalizedPoints = pendingPoints;
    state.points = denormalizePoints(pendingPoints, newWidth, newHeight);
    updatePointCount(state);
    drawPoints();
  }
}

/** Mirrors handleImageUpload: setupCanvas + resetAllPoints, no restore */
function simulateManualUpload(state, newWidth, newHeight) {
  const sourceCanvas = document.getElementById('sourceCanvas');
  sourceCanvas.width = newWidth;
  sourceCanvas.height = newHeight;
  state.points = [];
  state.savedNormalizedPoints = null;
  updatePointCount(state);
  drawPoints();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Point persistence — folder-browser mode', () => {
  let state;

  beforeEach(() => {
    setupDom();
    drawPoints.mockClear();
    state = createState();
    state.folderHandle = { name: 'test-folder' }; // non-null = folder mode
    state.currentFolderImageIndex = 0;
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('savedNormalizedPoints is populated after applyPerspectiveCorrection in folder mode', () => {
    state.points = [
      { x: 100, y: 75 },
      { x: 700, y: 75 },
      { x: 700, y: 525 },
      { x: 100, y: 525 },
    ];
    simulateApplyCorrection(state, 800, 600);

    expect(state.savedNormalizedPoints).not.toBeNull();
    expect(state.savedNormalizedPoints).toHaveLength(4);
    expect(state.savedNormalizedPoints[0]).toEqual({ x: 100 / 800, y: 75 / 600 });
  });

  it('points restored on next folder image load with correct scaling', () => {
    // First image: 800x600
    state.points = [
      { x: 100, y: 75 },
      { x: 700, y: 75 },
      { x: 700, y: 525 },
      { x: 100, y: 525 },
    ];
    simulateApplyCorrection(state, 800, 600);

    // Next image: 1600x1200 (double resolution)
    state.currentFolderImageIndex = 1;
    simulateSelectFolderImage(state, 1600, 1200);

    expect(state.points).toHaveLength(4);
    expect(state.points[0].x).toBeCloseTo(200, 5);
    expect(state.points[0].y).toBeCloseTo(150, 5);
    expect(state.points[1].x).toBeCloseTo(1400, 5);
    expect(state.points[1].y).toBeCloseTo(150, 5);
  });

  it('point count updates and drawPoints called after restore', () => {
    state.points = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ];
    simulateApplyCorrection(state, 800, 600);
    drawPoints.mockClear();

    simulateSelectFolderImage(state, 800, 600);

    expect(document.getElementById('pointCount').textContent).toBe('4');
    expect(drawPoints).toHaveBeenCalled();
  });

  // ── State transitions ───────────────────────────────────────────────────

  it('resetAllPoints clears savedNormalizedPoints', () => {
    state.savedNormalizedPoints = [{ x: 0.5, y: 0.5 }];
    simulateReset(state);
    expect(state.savedNormalizedPoints).toBeNull();
  });

  it('manual upload does NOT restore saved points', () => {
    state.points = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ];
    simulateApplyCorrection(state, 800, 600);
    expect(state.savedNormalizedPoints).not.toBeNull();

    // Manual upload flow — no restore logic
    simulateManualUpload(state, 1024, 768);

    expect(state.points).toEqual([]);
    expect(state.savedNormalizedPoints).toBeNull();
  });

  it('savedNormalizedPoints stays null when correction applied outside folder mode', () => {
    state.folderHandle = null; // not in folder mode
    state.currentFolderImageIndex = -1;
    state.points = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ];
    simulateApplyCorrection(state, 800, 600);
    expect(state.savedNormalizedPoints).toBeNull();
  });

  it('paste does NOT restore saved points', () => {
    state.points = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ];
    simulateApplyCorrection(state, 800, 600);
    expect(state.savedNormalizedPoints).not.toBeNull();

    // Paste follows same flow as manual upload (setupCanvas + resetAllPoints)
    simulateManualUpload(state, 640, 480);

    expect(state.points).toEqual([]);
    expect(state.savedNormalizedPoints).toBeNull();
  });

  // ── Boundary / edge cases ─────────────────────────────────────────────

  it('restore works when previous and next images have different resolutions', () => {
    state.points = [{ x: 400, y: 300 }];
    simulateApplyCorrection(state, 800, 600);

    simulateSelectFolderImage(state, 1600, 1200);

    expect(state.points).toHaveLength(1);
    expect(state.points[0].x).toBeCloseTo(800, 5);
    expect(state.points[0].y).toBeCloseTo(600, 5);
  });

  it('restore works when next image is smaller than previous', () => {
    state.points = [{ x: 1000, y: 500 }];
    simulateApplyCorrection(state, 2000, 1000);

    simulateSelectFolderImage(state, 500, 250);

    expect(state.points).toHaveLength(1);
    expect(state.points[0].x).toBeCloseTo(250, 5);
    expect(state.points[0].y).toBeCloseTo(125, 5);
  });

  it('restore with exactly 4 points enables transformBtn', () => {
    state.points = [
      { x: 100, y: 100 },
      { x: 700, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ];
    simulateApplyCorrection(state, 800, 600);

    simulateSelectFolderImage(state, 800, 600);

    expect(document.getElementById('transformBtn').disabled).toBe(false);
  });
});
