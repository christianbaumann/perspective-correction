import { describe, it, expect } from 'vitest';
import { normalizePoints, denormalizePoints } from '../../helpers.js';

// ─── normalizePoints ────────────────────────────────────────────────────────

describe('normalizePoints()', () => {
  // Happy path
  it('normalizes 4 points on a 1000x500 canvas to 0-1 range', () => {
    const result = normalizePoints([{ x: 500, y: 250 }], 1000, 500);
    expect(result).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('normalizes multiple points preserving order', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 600 },
      { x: 0, y: 600 },
    ];
    const result = normalizePoints(pts, 800, 600);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
  });

  // Boundary values
  it('point at origin (0,0) normalizes to (0,0)', () => {
    const result = normalizePoints([{ x: 0, y: 0 }], 1000, 500);
    expect(result).toEqual([{ x: 0, y: 0 }]);
  });

  it('point at (width,height) normalizes to (1,1)', () => {
    const result = normalizePoints([{ x: 1000, y: 500 }], 1000, 500);
    expect(result).toEqual([{ x: 1, y: 1 }]);
  });

  it('point at (width-1,height-1) normalizes to near 1', () => {
    const result = normalizePoints([{ x: 999, y: 499 }], 1000, 500);
    expect(result[0].x).toBeCloseTo(0.999, 5);
    expect(result[0].y).toBeCloseTo(0.998, 5);
  });

  it('single point array', () => {
    const result = normalizePoints([{ x: 250, y: 125 }], 500, 250);
    expect(result).toEqual([{ x: 0.5, y: 0.5 }]);
    expect(result).toHaveLength(1);
  });

  it('empty points array returns empty array', () => {
    expect(normalizePoints([], 1000, 500)).toEqual([]);
  });

  it('1x1 canvas — point at (0,0) normalizes to (0,0)', () => {
    const result = normalizePoints([{ x: 0, y: 0 }], 1, 1);
    expect(result).toEqual([{ x: 0, y: 0 }]);
  });

  it('large canvas (10000x8000) produces correct ratios', () => {
    const result = normalizePoints([{ x: 5000, y: 4000 }], 10000, 8000);
    expect(result).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('non-integer point coordinates normalize correctly', () => {
    const result = normalizePoints([{ x: 333.7, y: 166.3 }], 1000, 500);
    expect(result[0].x).toBeCloseTo(0.3337, 5);
    expect(result[0].y).toBeCloseTo(0.3326, 5);
  });
});

// ─── denormalizePoints ──────────────────────────────────────────────────────

describe('denormalizePoints()', () => {
  // Happy path
  it('denormalizes (0.5, 0.5) on 1000x500 to (500, 250)', () => {
    const result = denormalizePoints([{ x: 0.5, y: 0.5 }], 1000, 500);
    expect(result).toEqual([{ x: 500, y: 250 }]);
  });

  it('denormalizes multiple points preserving order', () => {
    const normalized = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const result = denormalizePoints(normalized, 800, 600);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 600 },
      { x: 0, y: 600 },
    ]);
  });

  // Boundary values
  it('(0,0) stays (0,0) on any canvas', () => {
    const result = denormalizePoints([{ x: 0, y: 0 }], 1234, 5678);
    expect(result).toEqual([{ x: 0, y: 0 }]);
  });

  it('(1,1) maps to (width,height)', () => {
    const result = denormalizePoints([{ x: 1, y: 1 }], 1000, 500);
    expect(result).toEqual([{ x: 1000, y: 500 }]);
  });

  it('empty array returns empty array', () => {
    expect(denormalizePoints([], 1000, 500)).toEqual([]);
  });

  it('single point array', () => {
    const result = denormalizePoints([{ x: 0.25, y: 0.75 }], 800, 600);
    expect(result).toEqual([{ x: 200, y: 450 }]);
    expect(result).toHaveLength(1);
  });

  it('1x1 canvas — (0,0) stays (0,0)', () => {
    const result = denormalizePoints([{ x: 0, y: 0 }], 1, 1);
    expect(result).toEqual([{ x: 0, y: 0 }]);
  });

  it('large target canvas (10000x8000) produces correct absolute coords', () => {
    const result = denormalizePoints([{ x: 0.5, y: 0.5 }], 10000, 8000);
    expect(result).toEqual([{ x: 5000, y: 4000 }]);
  });
});

// ─── Round-trip tests ───────────────────────────────────────────────────────

describe('round-trip (normalize then denormalize)', () => {
  it('same dimensions — points unchanged', () => {
    const original = [
      { x: 100, y: 150 },
      { x: 700, y: 50 },
      { x: 750, y: 550 },
      { x: 50, y: 500 },
    ];
    const normalized = normalizePoints(original, 800, 600);
    const restored = denormalizePoints(normalized, 800, 600);
    restored.forEach((p, i) => {
      expect(p.x).toBeCloseTo(original[i].x, 10);
      expect(p.y).toBeCloseTo(original[i].y, 10);
    });
  });

  it('different dimensions — points scale proportionally', () => {
    const original = [{ x: 400, y: 300 }];
    const normalized = normalizePoints(original, 800, 600);
    const restored = denormalizePoints(normalized, 1600, 1200);
    expect(restored[0].x).toBeCloseTo(800, 10);
    expect(restored[0].y).toBeCloseTo(600, 10);
  });

  it('landscape to portrait — x and y scale independently', () => {
    const original = [{ x: 500, y: 250 }];
    const normalized = normalizePoints(original, 1000, 500);
    const restored = denormalizePoints(normalized, 500, 1000);
    expect(restored[0].x).toBeCloseTo(250, 10);
    expect(restored[0].y).toBeCloseTo(500, 10);
  });

  it('to smaller canvas — points scale down', () => {
    const original = [{ x: 1000, y: 500 }];
    const normalized = normalizePoints(original, 2000, 1000);
    const restored = denormalizePoints(normalized, 400, 200);
    expect(restored[0].x).toBeCloseTo(200, 10);
    expect(restored[0].y).toBeCloseTo(100, 10);
  });
});
