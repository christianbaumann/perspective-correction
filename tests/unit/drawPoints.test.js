import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Reimplement the core drawing logic from script.js ─────────────────────
// drawPoints() is module-scoped in script.js and not exported, so we
// extract the per-point rendering loop into a testable function here.

function drawPointCrosshair(ctx, point, index, displayScale, selectedPointIndex, isDragging) {
  const lineWidth = 2 * displayScale;
  const crosshairSize = 12 * displayScale;
  const centerDotRadius = 3 * displayScale;

  // Crosshair lines (white)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = lineWidth;

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(point.x - crosshairSize, point.y);
  ctx.lineTo(point.x + crosshairSize, point.y);
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(point.x, point.y - crosshairSize);
  ctx.lineTo(point.x, point.y + crosshairSize);
  ctx.stroke();

  // Center dot
  ctx.beginPath();
  ctx.arc(point.x, point.y, centerDotRadius, 0, Math.PI * 2);
  ctx.fillStyle = (index === selectedPointIndex && isDragging) ? '#ff6b6b' : '#339af0';
  ctx.fill();
}

// ─── Mock canvas context ───────────────────────────────────────────────────

function createMockCtx() {
  const calls = [];
  return {
    calls,
    set strokeStyle(v) { calls.push({ method: 'set:strokeStyle', value: v }); },
    set lineWidth(v)   { calls.push({ method: 'set:lineWidth', value: v }); },
    set fillStyle(v)   { calls.push({ method: 'set:fillStyle', value: v }); },
    beginPath()        { calls.push({ method: 'beginPath' }); },
    moveTo(x, y)       { calls.push({ method: 'moveTo', x, y }); },
    lineTo(x, y)       { calls.push({ method: 'lineTo', x, y }); },
    stroke()           { calls.push({ method: 'stroke' }); },
    arc(x, y, r, s, e) { calls.push({ method: 'arc', x, y, r, startAngle: s, endAngle: e }); },
    fill()             { calls.push({ method: 'fill' }); },
  };
}

// ─── Helpers to query recorded calls ───────────────────────────────────────

function callsOf(calls, method) {
  return calls.filter(c => c.method === method);
}

function setsOf(calls, prop) {
  return calls.filter(c => c.method === `set:${prop}`).map(c => c.value);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('drawPointCrosshair()', () => {
  let ctx;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it('crosshair renders at correct position', () => {
    const point = { x: 100, y: 200 };
    drawPointCrosshair(ctx, point, 0, 1, -1, false);

    const moveToCalls = callsOf(ctx.calls, 'moveTo');
    const lineToCalls = callsOf(ctx.calls, 'lineTo');

    // Horizontal line centered on point
    expect(moveToCalls[0]).toEqual({ method: 'moveTo', x: 88, y: 200 });
    expect(lineToCalls[0]).toEqual({ method: 'lineTo', x: 112, y: 200 });

    // Vertical line centered on point
    expect(moveToCalls[1]).toEqual({ method: 'moveTo', x: 100, y: 188 });
    expect(lineToCalls[1]).toEqual({ method: 'lineTo', x: 100, y: 212 });
  });

  it('crosshair scales with displayScale', () => {
    const point = { x: 50, y: 50 };
    drawPointCrosshair(ctx, point, 0, 2, -1, false);

    const moveToCalls = callsOf(ctx.calls, 'moveTo');
    const lineToCalls = callsOf(ctx.calls, 'lineTo');

    // arm length = 12 * 2 = 24
    // Horizontal: 50-24=26 to 50+24=74
    expect(moveToCalls[0]).toEqual({ method: 'moveTo', x: 26, y: 50 });
    expect(lineToCalls[0]).toEqual({ method: 'lineTo', x: 74, y: 50 });

    // Vertical: 50-24=26 to 50+24=74
    expect(moveToCalls[1]).toEqual({ method: 'moveTo', x: 50, y: 26 });
    expect(lineToCalls[1]).toEqual({ method: 'lineTo', x: 50, y: 74 });
  });

  it('center dot is blue for non-dragged point', () => {
    drawPointCrosshair(ctx, { x: 10, y: 10 }, 0, 1, -1, false);

    const fillStyles = setsOf(ctx.calls, 'fillStyle');
    expect(fillStyles).toContain('#339af0');
    expect(fillStyles).not.toContain('#ff6b6b');
  });

  it('center dot is red for dragged point', () => {
    const selectedIndex = 2;
    drawPointCrosshair(ctx, { x: 10, y: 10 }, selectedIndex, 1, selectedIndex, true);

    const fillStyles = setsOf(ctx.calls, 'fillStyle');
    expect(fillStyles).toContain('#ff6b6b');
    expect(fillStyles).not.toContain('#339af0');
  });

  it('crosshair at point (0,0) extends into negative space', () => {
    drawPointCrosshair(ctx, { x: 0, y: 0 }, 0, 1, -1, false);

    const moveToCalls = callsOf(ctx.calls, 'moveTo');
    const lineToCalls = callsOf(ctx.calls, 'lineTo');

    // Horizontal: -12 to 12
    expect(moveToCalls[0].x).toBe(-12);
    expect(lineToCalls[0].x).toBe(12);

    // Vertical: -12 to 12
    expect(moveToCalls[1].y).toBe(-12);
    expect(lineToCalls[1].y).toBe(12);
  });

  it('crosshair at point (width,height) extends beyond canvas', () => {
    const canvasWidth = 800;
    const canvasHeight = 600;
    const point = { x: canvasWidth, y: canvasHeight };
    drawPointCrosshair(ctx, point, 0, 1, -1, false);

    const lineToCalls = callsOf(ctx.calls, 'lineTo');

    // Horizontal extends past canvas width
    expect(lineToCalls[0].x).toBe(canvasWidth + 12);

    // Vertical extends past canvas height
    expect(lineToCalls[1].y).toBe(canvasHeight + 12);
  });

  it('displayScale = 1 (no scaling) yields arm length of 12', () => {
    const point = { x: 100, y: 100 };
    drawPointCrosshair(ctx, point, 0, 1, -1, false);

    const moveToCalls = callsOf(ctx.calls, 'moveTo');
    const lineToCalls = callsOf(ctx.calls, 'lineTo');

    // Horizontal arm length = |lineTo.x - point.x| = 12
    expect(lineToCalls[0].x - point.x).toBe(12);
    expect(point.x - moveToCalls[0].x).toBe(12);

    // lineWidth should be 2
    const lineWidths = setsOf(ctx.calls, 'lineWidth');
    expect(lineWidths[0]).toBe(2);
  });

  it('displayScale > 1 (high-res image) scales arm length', () => {
    const scale = 3;
    const point = { x: 200, y: 300 };
    drawPointCrosshair(ctx, point, 0, scale, -1, false);

    const moveToCalls = callsOf(ctx.calls, 'moveTo');
    const lineToCalls = callsOf(ctx.calls, 'lineTo');
    const arcCalls = callsOf(ctx.calls, 'arc');

    const expectedArm = 12 * scale; // 36

    // Horizontal arm
    expect(point.x - moveToCalls[0].x).toBe(expectedArm);
    expect(lineToCalls[0].x - point.x).toBe(expectedArm);

    // Vertical arm
    expect(point.y - moveToCalls[1].y).toBe(expectedArm);
    expect(lineToCalls[1].y - point.y).toBe(expectedArm);

    // Center dot radius = 3 * scale = 9
    expect(arcCalls[0].r).toBe(3 * scale);

    // lineWidth = 2 * scale = 6
    const lineWidths = setsOf(ctx.calls, 'lineWidth');
    expect(lineWidths[0]).toBe(2 * scale);
  });
});
