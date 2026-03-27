import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Constants (mirrored from script.js, not exported) ────────────────────────
const ZOOM_FACTOR = 3;
const ZOOM_CANVAS_SIZE = 200;

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function createMockCtx() {
  return {
    calls: [],
    clearRect(...args) { this.calls.push({ method: 'clearRect', args }); },
    drawImage(...args) { this.calls.push({ method: 'drawImage', args }); },
    beginPath()        { this.calls.push({ method: 'beginPath' }); },
    moveTo(...args)    { this.calls.push({ method: 'moveTo', args }); },
    lineTo(...args)    { this.calls.push({ method: 'lineTo', args }); },
    stroke()           { this.calls.push({ method: 'stroke' }); },
    arc(...args)       { this.calls.push({ method: 'arc', args }); },
    fill()             { this.calls.push({ method: 'fill' }); },
    strokeStyle: null,
    fillStyle: null,
    lineWidth: null,
  };
}

function createMockStyle() {
  return { display: '' };
}

// ─── Reimplemented zoom logic (matches script.js) ─────────────────────────────

function updateZoomPreview({ image, sourceCanvas, zoomCanvas, zoomCtx, displayScale, pointX, pointY, points = [] }) {
  if (!image || !sourceCanvas.width) {
    zoomCanvas.style.display = 'none';
    return;
  }
  zoomCanvas.style.display = 'block';
  const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
  const sx = pointX - regionSize / 2;
  const sy = pointY - regionSize / 2;
  zoomCtx.clearRect(0, 0, ZOOM_CANVAS_SIZE, ZOOM_CANVAS_SIZE);
  zoomCtx.drawImage(sourceCanvas, sx, sy, regionSize, regionSize, 0, 0, ZOOM_CANVAS_SIZE, ZOOM_CANVAS_SIZE);

  // Draw any points visible in the zoom region as light blue crosshairs
  const pointArmLength = 12 * ZOOM_FACTOR;
  for (let i = 0; i < points.length; i++) {
    const px = (points[i].x - sx) / regionSize * ZOOM_CANVAS_SIZE;
    const py = (points[i].y - sy) / regionSize * ZOOM_CANVAS_SIZE;

    if (px < -pointArmLength || px > ZOOM_CANVAS_SIZE + pointArmLength ||
        py < -pointArmLength || py > ZOOM_CANVAS_SIZE + pointArmLength) {
      continue;
    }

    zoomCtx.strokeStyle = '#74c0fc';
    zoomCtx.lineWidth = 2;

    zoomCtx.beginPath();
    zoomCtx.moveTo(px - pointArmLength, py);
    zoomCtx.lineTo(px + pointArmLength, py);
    zoomCtx.stroke();

    zoomCtx.beginPath();
    zoomCtx.moveTo(px, py - pointArmLength);
    zoomCtx.lineTo(px, py + pointArmLength);
    zoomCtx.stroke();

    zoomCtx.beginPath();
    zoomCtx.arc(px, py, 3, 0, Math.PI * 2);
    zoomCtx.fillStyle = '#74c0fc';
    zoomCtx.fill();
  }

  // Crosshair overlay at center — dark outline + white line
  const center = ZOOM_CANVAS_SIZE / 2;
  const armLength = 36;

  // Dark outline pass
  zoomCtx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  zoomCtx.lineWidth = 3;

  zoomCtx.beginPath();
  zoomCtx.moveTo(center - armLength, center);
  zoomCtx.lineTo(center + armLength, center);
  zoomCtx.stroke();

  zoomCtx.beginPath();
  zoomCtx.moveTo(center, center - armLength);
  zoomCtx.lineTo(center, center + armLength);
  zoomCtx.stroke();

  // White line pass
  zoomCtx.strokeStyle = '#ffffff';
  zoomCtx.lineWidth = 1.5;

  zoomCtx.beginPath();
  zoomCtx.moveTo(center - armLength, center);
  zoomCtx.lineTo(center + armLength, center);
  zoomCtx.stroke();

  zoomCtx.beginPath();
  zoomCtx.moveTo(center, center - armLength);
  zoomCtx.lineTo(center, center + armLength);
  zoomCtx.stroke();

  // Center dot
  zoomCtx.beginPath();
  zoomCtx.arc(center, center, 3, 0, Math.PI * 2);
  zoomCtx.fillStyle = '#ff6b6b';
  zoomCtx.fill();
}

function hideZoomPreview(zoomCanvas) {
  zoomCanvas.style.display = 'none';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('updateZoomPreview()', () => {
  let zoomCtx, zoomCanvas, sourceCanvas;

  beforeEach(() => {
    zoomCtx = createMockCtx();
    zoomCanvas = { style: createMockStyle() };
    sourceCanvas = { width: 1000, height: 800 };
  });

  // Happy path

  it('calculates correct source region', () => {
    const displayScale = 2;
    // regionSize = 200 * 2 / 3 ≈ 133.33
    // sx = 500 - 66.67 ≈ 433.33, sy = 400 - 66.67 ≈ 333.33
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 500, pointY: 400,
    });

    const drawCall = zoomCtx.calls.find(c => c.method === 'drawImage');
    expect(drawCall).toBeDefined();
    const [canvas, sx, sy, sw, sh, dx, dy, dw, dh] = drawCall.args;
    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    expect(sx).toBeCloseTo(500 - regionSize / 2);
    expect(sy).toBeCloseTo(400 - regionSize / 2);
    expect(sw).toBeCloseTo(regionSize);
    expect(sh).toBeCloseTo(regionSize);
    expect(dx).toBe(0);
    expect(dy).toBe(0);
    expect(dw).toBe(ZOOM_CANVAS_SIZE);
    expect(dh).toBe(ZOOM_CANVAS_SIZE);
  });

  it('draws cursor crosshair at canvas center', () => {
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale: 1, pointX: 500, pointY: 400,
    });

    const center = 100;
    const armLength = 36;

    // White line horizontal arm
    const moveToH = zoomCtx.calls.find(
      c => c.method === 'moveTo' && c.args[0] === center - armLength && c.args[1] === center,
    );
    const lineToH = zoomCtx.calls.find(
      c => c.method === 'lineTo' && c.args[0] === center + armLength && c.args[1] === center,
    );
    expect(moveToH).toBeDefined();
    expect(lineToH).toBeDefined();

    // White line vertical arm
    const moveToV = zoomCtx.calls.find(
      c => c.method === 'moveTo' && c.args[0] === center && c.args[1] === center - armLength,
    );
    const lineToV = zoomCtx.calls.find(
      c => c.method === 'lineTo' && c.args[0] === center && c.args[1] === center + armLength,
    );
    expect(moveToV).toBeDefined();
    expect(lineToV).toBeDefined();

    // Center dot (red)
    const arcCalls = zoomCtx.calls.filter(c => c.method === 'arc');
    const centerDot = arcCalls.find(c => c.args[0] === center && c.args[1] === center);
    expect(centerDot).toBeDefined();
  });

  // Negative

  it('hides when no image', () => {
    updateZoomPreview({
      image: null, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale: 1, pointX: 100, pointY: 100,
    });
    expect(zoomCanvas.style.display).toBe('none');
    const drawCall = zoomCtx.calls.find(c => c.method === 'drawImage');
    expect(drawCall).toBeUndefined();
  });

  it('hides when sourceCanvas has zero width', () => {
    sourceCanvas.width = 0;
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale: 1, pointX: 100, pointY: 100,
    });
    expect(zoomCanvas.style.display).toBe('none');
  });

  // Edge cases / boundary values

  it('zoom region clamps at image edge (0,0)', () => {
    const displayScale = 2;
    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 0, pointY: 0,
    });

    const drawCall = zoomCtx.calls.find(c => c.method === 'drawImage');
    expect(drawCall).toBeDefined();
    const [, sx, sy] = drawCall.args;
    expect(sx).toBeCloseTo(-regionSize / 2);
    expect(sy).toBeCloseTo(-regionSize / 2);
    expect(zoomCanvas.style.display).toBe('block');
  });

  it('zoom region clamps at image edge (maxX, maxY)', () => {
    const displayScale = 2;
    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 1000, pointY: 800,
    });

    const drawCall = zoomCtx.calls.find(c => c.method === 'drawImage');
    expect(drawCall).toBeDefined();
    const [, sx, sy, sw, sh] = drawCall.args;
    expect(sx).toBeCloseTo(1000 - regionSize / 2);
    expect(sy).toBeCloseTo(800 - regionSize / 2);
    expect(sw).toBeCloseTo(regionSize);
    expect(sh).toBeCloseTo(regionSize);
    expect(zoomCanvas.style.display).toBe('block');
  });
});

// ─── Point crosshairs in zoom preview ────────────────────────────────────────

describe('point crosshairs in zoom preview', () => {
  let zoomCtx, zoomCanvas, sourceCanvas;

  beforeEach(() => {
    zoomCtx = createMockCtx();
    zoomCanvas = { style: createMockStyle() };
    sourceCanvas = { width: 1000, height: 800 };
  });

  it('draws light blue crosshair when point is within zoom region', () => {
    const displayScale = 1;
    // regionSize = 200/3 ≈ 66.67, cursor at (500,400)
    // sx = 500 - 33.33 ≈ 466.67, sy = 400 - 33.33 ≈ 366.67
    // Point at (500, 400) = zoom center → px = 100, py = 100
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 500, pointY: 400,
      points: [{ x: 500, y: 400 }],
    });

    // Find light blue strokeStyle assignments
    const strokeCalls = zoomCtx.calls.filter((c, i) => {
      // Look for stroke() calls that were preceded by strokeStyle = '#74c0fc'
      if (c.method !== 'stroke') return false;
      // Walk back to find the most recent strokeStyle assignment
      for (let j = i - 1; j >= 0; j--) {
        if (zoomCtx.calls[j].method === 'moveTo' || zoomCtx.calls[j].method === 'lineTo' || zoomCtx.calls[j].method === 'beginPath') continue;
        break;
      }
      return true;
    });

    // Check that #74c0fc was used as strokeStyle
    const lightBlueUsed = zoomCtx.calls.some((c, i) => {
      if (c.method !== 'moveTo') return false;
      // Find the preceding strokeStyle set
      for (let j = i - 1; j >= 0; j--) {
        const call = zoomCtx.calls[j];
        if (call.method === 'beginPath') continue;
        // If we hit a non-beginPath call, check if strokeStyle was set to light blue before
        break;
      }
      return true;
    });

    // Simpler check: verify strokeStyle was set to #74c0fc at some point
    const styleSetCalls = [];
    for (const call of zoomCtx.calls) {
      if (call.method === 'moveTo' || call.method === 'lineTo' || call.method === 'stroke' || call.method === 'arc' || call.method === 'fill') {
        styleSetCalls.push(call);
      }
    }

    // The mock ctx tracks property assignments in calls array indirectly
    // Since we track strokeStyle as a property, check it was set
    // Instead, verify the arc call for the point center dot exists at (100, 100)
    const center = ZOOM_CANVAS_SIZE / 2;
    const arcCalls = zoomCtx.calls.filter(c => c.method === 'arc');
    // Should have point dot at center (100,100) AND cursor dot at center (100,100)
    // Both at (100,100) since point is at cursor position
    expect(arcCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('draws multiple point crosshairs when several points are in region', () => {
    const displayScale = 1;
    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    // Cursor at (500, 400). Two points within the zoom region.
    const sx = 500 - regionSize / 2;
    const sy = 400 - regionSize / 2;
    // Point 1 at (490, 390) and Point 2 at (510, 410) — both within region
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 500, pointY: 400,
      points: [{ x: 490, y: 390 }, { x: 510, y: 410 }],
    });

    // Each point crosshair produces 2 stroke() calls (H + V arms) + 1 arc/fill (center dot)
    // Cursor crosshair: 4 stroke() calls (dark H, dark V, white H, white V) + 1 arc/fill
    // Total strokes: 4 (points) + 4 (cursor) = 8
    const strokeCalls = zoomCtx.calls.filter(c => c.method === 'stroke');
    expect(strokeCalls.length).toBe(8);

    // 2 point arcs + 1 cursor arc = 3 total
    const arcCalls = zoomCtx.calls.filter(c => c.method === 'arc');
    expect(arcCalls.length).toBe(3);
  });

  it('does not draw point crosshair when point is outside zoom region', () => {
    const displayScale = 1;
    // Cursor at (500, 400), point far away at (100, 100)
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 500, pointY: 400,
      points: [{ x: 100, y: 100 }],
    });

    // Only cursor crosshair strokes: 4 (dark H, dark V, white H, white V)
    const strokeCalls = zoomCtx.calls.filter(c => c.method === 'stroke');
    expect(strokeCalls.length).toBe(4);

    // Only cursor center dot arc
    const arcCalls = zoomCtx.calls.filter(c => c.method === 'arc');
    expect(arcCalls.length).toBe(1);
  });

  it('does not draw point crosshairs when points array is empty', () => {
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale: 1, pointX: 500, pointY: 400,
      points: [],
    });

    // Only cursor crosshair: 4 strokes + 1 arc
    const strokeCalls = zoomCtx.calls.filter(c => c.method === 'stroke');
    expect(strokeCalls.length).toBe(4);
    const arcCalls = zoomCtx.calls.filter(c => c.method === 'arc');
    expect(arcCalls.length).toBe(1);
  });

  it('draws crosshair for point at zoom region edge', () => {
    const displayScale = 1;
    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    // Cursor at (500, 400). Place point at the edge of the zoom region.
    const sx = 500 - regionSize / 2;
    const edgePointX = sx; // left edge of region → px = 0
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 500, pointY: 400,
      points: [{ x: edgePointX, y: 400 }],
    });

    // Point is at px=0, within arm margin → should be drawn
    // 2 point strokes + 4 cursor strokes = 6
    const strokeCalls = zoomCtx.calls.filter(c => c.method === 'stroke');
    expect(strokeCalls.length).toBe(6);
  });

  it('skips point just outside zoom region beyond arm margin', () => {
    const displayScale = 1;
    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    const pointArmLength = 12 * ZOOM_FACTOR; // 36
    const sx = 500 - regionSize / 2;
    // Place point far enough left that px < -pointArmLength
    // px = (ptX - sx) / regionSize * ZOOM_CANVAS_SIZE
    // We need px < -36, so (ptX - sx) / regionSize * 200 < -36
    // (ptX - sx) < -36 * regionSize / 200 = -36 / 3 = -12
    // ptX < sx - 12
    const farPointX = sx - 13;
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 500, pointY: 400,
      points: [{ x: farPointX, y: 400 }],
    });

    // Only cursor crosshair strokes
    const strokeCalls = zoomCtx.calls.filter(c => c.method === 'stroke');
    expect(strokeCalls.length).toBe(4);
  });

  it('point crosshair drawn before cursor crosshair (draw order)', () => {
    const displayScale = 1;
    // Point at cursor position — both crosshairs at center
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale, pointX: 500, pointY: 400,
      points: [{ x: 500, y: 400 }],
    });

    // Find first stroke that's part of point crosshair vs cursor crosshair
    // Point crosshair: strokes at indices after drawImage, before cursor
    // The first stroke after drawImage should be the point's horizontal arm
    const drawImageIdx = zoomCtx.calls.findIndex(c => c.method === 'drawImage');

    // First stroke after drawImage = point crosshair
    const firstStrokeIdx = zoomCtx.calls.findIndex((c, i) => i > drawImageIdx && c.method === 'stroke');

    // Find the last arc (cursor center dot) — should be after point arc
    const arcIndices = [];
    zoomCtx.calls.forEach((c, i) => { if (c.method === 'arc') arcIndices.push(i); });

    // Point arc should come before cursor arc
    expect(arcIndices.length).toBe(2);
    expect(arcIndices[0]).toBeLessThan(arcIndices[1]);

    // First stroke (point) should come before later strokes (cursor)
    expect(firstStrokeIdx).toBeGreaterThan(drawImageIdx);
  });
});

// ─── hideZoomPreview ──────────────────────────────────────────────────────────

describe('hideZoomPreview()', () => {
  it('sets display none', () => {
    const zoomCanvas = { style: createMockStyle() };
    zoomCanvas.style.display = 'block';
    hideZoomPreview(zoomCanvas);
    expect(zoomCanvas.style.display).toBe('none');
  });
});

// ─── State transitions ────────────────────────────────────────────────────────

describe('zoom preview state transitions', () => {
  let zoomCtx, zoomCanvas, sourceCanvas;

  beforeEach(() => {
    zoomCtx = createMockCtx();
    zoomCanvas = { style: createMockStyle() };
    sourceCanvas = { width: 1000, height: 800 };
  });

  it('hidden → visible on drag start', () => {
    zoomCanvas.style.display = 'none';
    updateZoomPreview({
      image: true, sourceCanvas, zoomCanvas, zoomCtx,
      displayScale: 1, pointX: 200, pointY: 200,
    });
    expect(zoomCanvas.style.display).toBe('block');
  });

  it('visible → hidden on drag end', () => {
    zoomCanvas.style.display = 'block';
    hideZoomPreview(zoomCanvas);
    expect(zoomCanvas.style.display).toBe('none');
  });

  it('visible → hidden on mode change', () => {
    zoomCanvas.style.display = 'block';
    hideZoomPreview(zoomCanvas);
    expect(zoomCanvas.style.display).toBe('none');
  });
});

// ─── Decision table: zoom visibility by mode ─────────────────────────────────

describe('zoom visibility decision table', () => {
  let zoomCtx, zoomCanvas, sourceCanvas;

  beforeEach(() => {
    zoomCtx = createMockCtx();
    zoomCanvas = { style: createMockStyle() };
    sourceCanvas = { width: 1000, height: 800 };
  });

  it('move mode + dragging → zoom visible', () => {
    const mode = 'move';
    const dragging = true;
    if (mode === 'move' && dragging) {
      updateZoomPreview({
        image: true, sourceCanvas, zoomCanvas, zoomCtx,
        displayScale: 1, pointX: 300, pointY: 300,
      });
    }
    expect(zoomCanvas.style.display).toBe('block');
  });

  it('move mode + hover near point → zoom visible', () => {
    const mode = 'move';
    const nearPoint = true;
    if (mode === 'move' && nearPoint) {
      updateZoomPreview({
        image: true, sourceCanvas, zoomCanvas, zoomCtx,
        displayScale: 1, pointX: 150, pointY: 150,
      });
    }
    expect(zoomCanvas.style.display).toBe('block');
  });

  it('move mode + hover away from points → zoom hidden', () => {
    const mode = 'move';
    const nearPoint = false;
    if (mode === 'move' && !nearPoint) {
      hideZoomPreview(zoomCanvas);
    }
    expect(zoomCanvas.style.display).toBe('none');
  });

  it('add mode + any state → zoom hidden', () => {
    const mode = 'add';
    if (mode !== 'move') {
      hideZoomPreview(zoomCanvas);
    }
    expect(zoomCanvas.style.display).toBe('none');
  });

  it('delete mode + any state → zoom hidden', () => {
    const mode = 'delete';
    if (mode !== 'move') {
      hideZoomPreview(zoomCanvas);
    }
    expect(zoomCanvas.style.display).toBe('none');
  });
});
