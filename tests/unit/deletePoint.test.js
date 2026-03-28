import { describe, it, expect, beforeEach } from 'vitest';

// Reimplemented from handleCanvasMouseDown in script.js
// Extracts the hit-test + mode-action logic for isolated testing
function handlePointInteraction(points, clickX, clickY, mode, displayScale) {
  const hitRadius = 15 * displayScale;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const distance = Math.sqrt((clickX - point.x) ** 2 + (clickY - point.y) ** 2);
    if (distance < hitRadius) {
      if (mode === 'delete') {
        points.splice(i, 1);
        return { action: 'deleted', index: i };
      } else if (mode === 'move') {
        return { action: 'move', index: i };
      }
    }
  }
  if (mode === 'add') {
    points.push({ x: clickX, y: clickY });
    return { action: 'added', index: points.length - 1 };
  }
  return { action: 'none' };
}

// ─────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────

describe('delete point — happy path', () => {
  let points;

  beforeEach(() => {
    points = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ];
  });

  it('deletes point when clicked within hit radius', () => {
    const result = handlePointInteraction(points, 100, 100, 'delete', 1);
    expect(result).toEqual({ action: 'deleted', index: 0 });
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 200, y: 200 });
  });

  it('deletes correct point from multiple', () => {
    const result = handlePointInteraction(points, 201, 201, 'delete', 1);
    expect(result).toEqual({ action: 'deleted', index: 1 });
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 100, y: 100 });
    expect(points[1]).toEqual({ x: 300, y: 300 });
  });
});

// ─────────────────────────────────────────────────
// Negative testing
// ─────────────────────────────────────────────────

describe('delete point — negative', () => {
  it('no deletion when clicking empty area', () => {
    const points = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
    const result = handlePointInteraction(points, 500, 500, 'delete', 1);
    expect(result).toEqual({ action: 'none' });
    expect(points).toHaveLength(2);
  });

  it('no deletion in add mode even when clicking on point', () => {
    const points = [{ x: 100, y: 100 }];
    const result = handlePointInteraction(points, 100, 100, 'add', 1);
    expect(result.action).toBe('added');
    expect(points).toHaveLength(2);
  });

  it('no deletion in move mode', () => {
    const points = [{ x: 100, y: 100 }];
    const result = handlePointInteraction(points, 100, 100, 'move', 1);
    expect(result).toEqual({ action: 'move', index: 0 });
    expect(points).toHaveLength(1);
  });

  it('no deletion when points array is empty', () => {
    const points = [];
    const result = handlePointInteraction(points, 100, 100, 'delete', 1);
    expect(result).toEqual({ action: 'none' });
    expect(points).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────
// Boundary value analysis
// ─────────────────────────────────────────────────

describe('delete point — boundary values', () => {
  it('click exactly at hit radius boundary (inside)', () => {
    const points = [{ x: 100, y: 100 }];
    // hitRadius = 15 * 1 = 15. Distance 14.9 < 15 → hit
    const result = handlePointInteraction(points, 100 + 14.9, 100, 'delete', 1);
    expect(result.action).toBe('deleted');
    expect(points).toHaveLength(0);
  });

  it('click exactly at hit radius boundary (outside)', () => {
    const points = [{ x: 100, y: 100 }];
    // hitRadius = 15. Distance 15.1 >= 15 → miss
    const result = handlePointInteraction(points, 100 + 15.1, 100, 'delete', 1);
    expect(result.action).toBe('none');
    expect(points).toHaveLength(1);
  });

  it('hit radius scales with displayScale=1', () => {
    const points = [{ x: 100, y: 100 }];
    // hitRadius = 15 * 1 = 15. Click at distance 14
    const result = handlePointInteraction(points, 114, 100, 'delete', 1);
    expect(result.action).toBe('deleted');
  });

  it('hit radius scales with displayScale=3', () => {
    const points = [{ x: 100, y: 100 }];
    // hitRadius = 15 * 3 = 45. Click at distance 44
    const result = handlePointInteraction(points, 144, 100, 'delete', 3);
    expect(result.action).toBe('deleted');
  });

  it('hit radius rejects beyond scaled radius', () => {
    const points = [{ x: 100, y: 100 }];
    // hitRadius = 15 * 1 = 15. Click at distance 16
    const result = handlePointInteraction(points, 116, 100, 'delete', 1);
    expect(result.action).toBe('none');
  });
});

// ─────────────────────────────────────────────────
// Equivalence class partitioning
// ─────────────────────────────────────────────────

describe('delete point — equivalence classes', () => {
  it('delete only first matching point when overlapping', () => {
    const points = [{ x: 100, y: 100 }, { x: 100, y: 100 }];
    const result = handlePointInteraction(points, 100, 100, 'delete', 1);
    expect(result).toEqual({ action: 'deleted', index: 0 });
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ x: 100, y: 100 });
  });

  it('delete last point in array', () => {
    const points = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
    const result = handlePointInteraction(points, 300, 300, 'delete', 1);
    expect(result).toEqual({ action: 'deleted', index: 2 });
    expect(points).toHaveLength(2);
  });

  it('delete first point in array', () => {
    const points = [{ x: 100, y: 100 }, { x: 200, y: 200 }, { x: 300, y: 300 }];
    const result = handlePointInteraction(points, 100, 100, 'delete', 1);
    expect(result).toEqual({ action: 'deleted', index: 0 });
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 200, y: 200 });
  });
});
