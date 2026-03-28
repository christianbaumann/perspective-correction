import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Reimplement assignPointsToCorners from script.js ───────────────────────
// This function is module-scoped in script.js and not exported.

function assignPointsToCorners(points, w, h) {
    const corners = {
        tl: { x: 0, y: 0 },
        tr: { x: w, y: 0 },
        bl: { x: 0, y: h },
        br: { x: w, y: h },
    };
    const assignment = { tl: null, tr: null, bl: null, br: null };
    const used = new Set();
    const pairs = [];
    for (const [key, corner] of Object.entries(corners)) {
        for (let i = 0; i < points.length; i++) {
            const dx = points[i].x - corner.x;
            const dy = points[i].y - corner.y;
            pairs.push({ key, index: i, dist: dx * dx + dy * dy });
        }
    }
    pairs.sort((a, b) => a.dist - b.dist);
    const usedCorners = new Set();
    for (const pair of pairs) {
        if (usedCorners.has(pair.key) || used.has(pair.index)) continue;
        assignment[pair.key] = points[pair.index];
        usedCorners.add(pair.key);
        used.add(pair.index);
    }
    return assignment;
}

// ─── Reimplement updateCornerZoom from script.js ────────────────────────────

function updateCornerZoom(cornerKey, point, ctx, canvasSize, displayScale, zoomFactor, sourceCanvas) {
    if (!point) {
        ctx.clearRect(0, 0, canvasSize, canvasSize);
        ctx.canvas.classList.remove('has-point');
        return;
    }
    ctx.canvas.classList.add('has-point');
    const srcSize = canvasSize * displayScale / zoomFactor;
    const sx = point.x - srcSize / 2;
    const sy = point.y - srcSize / 2;
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    ctx.drawImage(sourceCanvas, sx, sy, srcSize, srcSize, 0, 0, canvasSize, canvasSize);
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CORNER_ZOOM_SIZE = 150;
const ZOOM_FACTOR = 3;

// ─── Mock canvas context ────────────────────────────────────────────────────

function createMockCtx() {
    const calls = [];
    const canvas = {
        classList: {
            _classes: new Set(),
            add(cls) { calls.push({ method: 'classList.add', value: cls }); this._classes.add(cls); },
            remove(cls) { calls.push({ method: 'classList.remove', value: cls }); this._classes.delete(cls); },
            contains(cls) { return this._classes.has(cls); },
        },
    };
    return {
        calls,
        canvas,
        set strokeStyle(v) { calls.push({ method: 'set:strokeStyle', value: v }); },
        set lineWidth(v)   { calls.push({ method: 'set:lineWidth', value: v }); },
        set fillStyle(v)   { calls.push({ method: 'set:fillStyle', value: v }); },
        beginPath()        { calls.push({ method: 'beginPath' }); },
        moveTo(x, y)       { calls.push({ method: 'moveTo', x, y }); },
        lineTo(x, y)       { calls.push({ method: 'lineTo', x, y }); },
        stroke()           { calls.push({ method: 'stroke' }); },
        arc(x, y, r, s, e) { calls.push({ method: 'arc', x, y, r, startAngle: s, endAngle: e }); },
        fill()             { calls.push({ method: 'fill' }); },
        clearRect(x, y, w, h) { calls.push({ method: 'clearRect', x, y, w, h }); },
        drawImage(...args)  { calls.push({ method: 'drawImage', args }); },
    };
}

// ─── Helpers to query recorded calls ────────────────────────────────────────

function callsOf(calls, method) {
    return calls.filter(c => c.method === method);
}

function setsOf(calls, prop) {
    return calls.filter(c => c.method === `set:${prop}`).map(c => c.value);
}

// ─── Tests: assignPointsToCorners ───────────────────────────────────────────

describe('assignPointsToCorners — happy path', () => {
    it('assigns 4 points to correct corners', () => {
        const points = [
            { x: 50, y: 60 },      // near TL (0,0)
            { x: 950, y: 40 },     // near TR (1000,0)
            { x: 30, y: 1450 },    // near BL (0,1500)
            { x: 970, y: 1470 },   // near BR (1000,1500)
        ];
        const result = assignPointsToCorners(points, 1000, 1500);

        expect(result.tl).toEqual({ x: 50, y: 60 });
        expect(result.tr).toEqual({ x: 950, y: 40 });
        expect(result.bl).toEqual({ x: 30, y: 1450 });
        expect(result.br).toEqual({ x: 970, y: 1470 });
    });
});

describe('assignPointsToCorners — negative', () => {
    it('handles 0 points — all corners null', () => {
        const result = assignPointsToCorners([], 1000, 1500);

        expect(result.tl).toBeNull();
        expect(result.tr).toBeNull();
        expect(result.bl).toBeNull();
        expect(result.br).toBeNull();
    });
});

describe('assignPointsToCorners — edge cases', () => {
    it('assigns 1 point to nearest corner', () => {
        const points = [{ x: 10, y: 20 }];
        const result = assignPointsToCorners(points, 1000, 1500);

        expect(result.tl).toEqual({ x: 10, y: 20 });
        expect(result.tr).toBeNull();
        expect(result.bl).toBeNull();
        expect(result.br).toBeNull();
    });

    it('assigns 2 points to nearest corners (no double-assignment)', () => {
        const points = [
            { x: 10, y: 20 },    // near TL
            { x: 980, y: 1480 }, // near BR
        ];
        const result = assignPointsToCorners(points, 1000, 1500);

        expect(result.tl).toEqual({ x: 10, y: 20 });
        expect(result.br).toEqual({ x: 980, y: 1480 });
        expect(result.tr).toBeNull();
        expect(result.bl).toBeNull();
    });

    it('assigns 3 points to nearest corners (one corner empty)', () => {
        const points = [
            { x: 10, y: 20 },     // near TL
            { x: 950, y: 30 },    // near TR
            { x: 20, y: 1480 },   // near BL
        ];
        const result = assignPointsToCorners(points, 1000, 1500);

        expect(result.tl).toEqual({ x: 10, y: 20 });
        expect(result.tr).toEqual({ x: 950, y: 30 });
        expect(result.bl).toEqual({ x: 20, y: 1480 });
        expect(result.br).toBeNull();
    });

    it('point on exact center assigns to TL (equidistant, greedy picks first match)', () => {
        const points = [{ x: 500, y: 750 }];
        const result = assignPointsToCorners(points, 1000, 1500);

        // All four corners are equidistant from center of 1000x1500.
        // Distance² to TL(0,0): 500²+750² = 812500
        // Distance² to TR(1000,0): 500²+750² = 812500
        // Distance² to BL(0,1500): 500²+750² = 812500
        // Distance² to BR(1000,1500): 500²+750² = 812500
        // Greedy: sorted by dist, equal dists preserve insertion order → tl first
        expect(result.tl).toEqual({ x: 500, y: 750 });
        expect(result.tr).toBeNull();
        expect(result.bl).toBeNull();
        expect(result.br).toBeNull();
    });

    it('point at image edge (0,0) assigns to TL', () => {
        const points = [{ x: 0, y: 0 }];
        const result = assignPointsToCorners(points, 1000, 1500);

        expect(result.tl).toEqual({ x: 0, y: 0 });
    });

    it('point at image edge (w,h) assigns to BR', () => {
        const points = [{ x: 1000, y: 1500 }];
        const result = assignPointsToCorners(points, 1000, 1500);

        expect(result.br).toEqual({ x: 1000, y: 1500 });
    });

    it('greedy assignment avoids double-mapping (two points both near TL)', () => {
        const points = [
            { x: 5, y: 5 },    // very close to TL
            { x: 15, y: 15 },  // also close to TL, but slightly farther
        ];
        const result = assignPointsToCorners(points, 1000, 1500);

        // First point takes TL; second point goes to next nearest available corner
        expect(result.tl).toEqual({ x: 5, y: 5 });
        // Second point should not also be TL — it gets assigned to another corner
        const assigned = [result.tl, result.tr, result.bl, result.br].filter(Boolean);
        expect(assigned).toHaveLength(2);
        expect(assigned).toContainEqual({ x: 5, y: 5 });
        expect(assigned).toContainEqual({ x: 15, y: 15 });
    });
});

// ─── Tests: updateCornerZoom ────────────────────────────────────────────────

describe('updateCornerZoom — happy path', () => {
    it('renders zoomed region centered on point', () => {
        const ctx = createMockCtx();
        const sourceCanvas = { width: 1000, height: 1500 };
        const point = { x: 200, y: 300 };
        const displayScale = 2;
        const canvasSize = CORNER_ZOOM_SIZE;

        updateCornerZoom('tl', point, ctx, canvasSize, displayScale, ZOOM_FACTOR, sourceCanvas);

        const drawCalls = callsOf(ctx.calls, 'drawImage');
        expect(drawCalls).toHaveLength(1);

        const args = drawCalls[0].args;
        // srcSize = canvasSize * displayScale / zoomFactor = 150 * 2 / 3 = 100
        const srcSize = canvasSize * displayScale / ZOOM_FACTOR;
        expect(srcSize).toBe(100);

        // sx = point.x - srcSize/2 = 200 - 50 = 150
        // sy = point.y - srcSize/2 = 300 - 50 = 250
        expect(args[0]).toBe(sourceCanvas);  // source
        expect(args[1]).toBe(150);           // sx
        expect(args[2]).toBe(250);           // sy
        expect(args[3]).toBe(100);           // sWidth
        expect(args[4]).toBe(100);           // sHeight
        expect(args[5]).toBe(0);             // dx
        expect(args[6]).toBe(0);             // dy
        expect(args[7]).toBe(canvasSize);    // dWidth
        expect(args[8]).toBe(canvasSize);    // dHeight
    });
});

describe('updateCornerZoom — negative', () => {
    it('handles no image — clears canvas and removes class when point is null', () => {
        const ctx = createMockCtx();
        ctx.canvas.classList.add('has-point');

        updateCornerZoom('tl', null, ctx, CORNER_ZOOM_SIZE, 2, ZOOM_FACTOR, null);

        const clearCalls = callsOf(ctx.calls, 'clearRect');
        expect(clearCalls).toHaveLength(1);
        expect(clearCalls[0]).toEqual({
            method: 'clearRect',
            x: 0, y: 0,
            w: CORNER_ZOOM_SIZE, h: CORNER_ZOOM_SIZE,
        });

        const removeCalls = callsOf(ctx.calls, 'classList.remove');
        expect(removeCalls).toHaveLength(1);
        expect(removeCalls[0].value).toBe('has-point');

        // No drawImage should be called
        expect(callsOf(ctx.calls, 'drawImage')).toHaveLength(0);
    });
});

// ─── Tests: positionCornerZooms visibility logic ────────────────────────────

describe('positionCornerZooms — visibility', () => {
    function createMockCornerCanvas() {
        return {
            style: { display: '', left: '', top: '' },
        };
    }

    function positionCornerZooms(offsetX, cornerCanvases) {
        const threshold = CORNER_ZOOM_SIZE + 16; // 166
        if (offsetX < threshold) {
            for (const canvas of Object.values(cornerCanvases)) {
                canvas.style.display = 'none';
            }
        } else {
            for (const canvas of Object.values(cornerCanvases)) {
                canvas.style.display = 'block';
            }
        }
    }

    it('hides when offsetX too small (< 166)', () => {
        const cornerCanvases = {
            tl: createMockCornerCanvas(),
            tr: createMockCornerCanvas(),
            bl: createMockCornerCanvas(),
            br: createMockCornerCanvas(),
        };

        positionCornerZooms(100, cornerCanvases);

        for (const canvas of Object.values(cornerCanvases)) {
            expect(canvas.style.display).toBe('none');
        }
    });

    it('shows when offsetX sufficient (>= 166)', () => {
        const cornerCanvases = {
            tl: createMockCornerCanvas(),
            tr: createMockCornerCanvas(),
            bl: createMockCornerCanvas(),
            br: createMockCornerCanvas(),
        };

        positionCornerZooms(166, cornerCanvases);

        for (const canvas of Object.values(cornerCanvases)) {
            expect(canvas.style.display).toBe('block');
        }
    });

    it('hides at exact boundary minus one (165)', () => {
        const cornerCanvases = {
            tl: createMockCornerCanvas(),
            tr: createMockCornerCanvas(),
            bl: createMockCornerCanvas(),
            br: createMockCornerCanvas(),
        };

        positionCornerZooms(165, cornerCanvases);

        for (const canvas of Object.values(cornerCanvases)) {
            expect(canvas.style.display).toBe('none');
        }
    });
});
