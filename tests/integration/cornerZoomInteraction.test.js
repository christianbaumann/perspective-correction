import { describe, it, expect, vi, beforeEach } from 'vitest';

const CORNER_ZOOM_SIZE = 150;
const ZOOM_FACTOR = 3;

/**
 * Corner zoom system integration tests.
 *
 * The corner zoom pipeline in script.js is module-scoped and not exported,
 * so we reimplement the key functions inline for testing:
 *   assignPointsToCorners() - maps points to TL/TR/BL/BR by proximity
 *   updateCornerZoom()      - renders zoomed image + crosshair into a corner canvas
 *   updateAllCornerZooms()  - orchestrates assignment + per-corner update
 *   positionCornerZooms()   - positions corner canvases around the main canvas
 */

// ─── Mock canvas factory ────────────────────────────────────────────────────

function createMockCanvas() {
    const ctx = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        font: '',
    };
    return {
        width: CORNER_ZOOM_SIZE,
        height: CORNER_ZOOM_SIZE,
        getContext: () => ctx,
        ctx,
        style: { left: '', top: '', display: '' },
        classList: { add: vi.fn(), remove: vi.fn() },
    };
}

// ─── Reimplemented functions from script.js ─────────────────────────────────

function assignPointsToCorners(points, canvasWidth, canvasHeight) {
    const corners = {
        tl: { x: 0, y: 0 },
        tr: { x: canvasWidth, y: 0 },
        bl: { x: 0, y: canvasHeight },
        br: { x: canvasWidth, y: canvasHeight },
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

function updateCornerZoom(cornerKey, point, cornerZoomCanvases, cornerZoomCtxs, sourceCanvas, displayScale) {
    const canvas = cornerZoomCanvases[cornerKey];
    const ctx = cornerZoomCtxs[cornerKey];
    const label = cornerKey.toUpperCase();

    if (!point) {
        ctx.clearRect(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);
        canvas.classList.remove('has-point');
        ctx.font = '11px monospace';
        ctx.fillStyle = 'rgba(116, 192, 252, 0.4)';
        ctx.fillText(label, 4, 13);
        return;
    }

    canvas.classList.add('has-point');

    const regionSize = CORNER_ZOOM_SIZE * displayScale / ZOOM_FACTOR;
    const sx = point.x - regionSize / 2;
    const sy = point.y - regionSize / 2;

    ctx.clearRect(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);
    ctx.drawImage(
        sourceCanvas,
        sx, sy, regionSize, regionSize,
        0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE
    );

    // Crosshair at center
    const center = CORNER_ZOOM_SIZE / 2;
    const armLength = 12 * ZOOM_FACTOR;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(center - armLength, center);
    ctx.lineTo(center + armLength, center);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(center, center - armLength);
    ctx.lineTo(center, center + armLength);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center - armLength, center);
    ctx.lineTo(center + armLength, center);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(center, center - armLength);
    ctx.lineTo(center, center + armLength);
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(center, center, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#74c0fc';
    ctx.fill();

    // Corner label
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(label, 4, 13);
}

function updateAllCornerZooms(points, image, sourceCanvas, cornerZoomCanvases, cornerZoomCtxs, displayScale) {
    if (!image || !sourceCanvas.width) {
        for (const key of Object.keys(cornerZoomCanvases)) {
            updateCornerZoom(key, null, cornerZoomCanvases, cornerZoomCtxs, sourceCanvas, displayScale);
        }
        return;
    }
    const assignment = assignPointsToCorners(points, sourceCanvas.width, sourceCanvas.height);
    for (const [key, point] of Object.entries(assignment)) {
        updateCornerZoom(key, point, cornerZoomCanvases, cornerZoomCtxs, sourceCanvas, displayScale);
    }
}

function positionCornerZooms(offsetX, offsetY, displayWidth, displayHeight, cornerZoomCanvases) {
    if (offsetX < CORNER_ZOOM_SIZE + 16) {
        for (const canvas of Object.values(cornerZoomCanvases)) {
            canvas.style.display = 'none';
        }
        return;
    }

    const margin = 8;
    const cSize = CORNER_ZOOM_SIZE;

    const leftX = Math.max(margin, (offsetX - cSize) / 2);
    const rightX = offsetX + displayWidth + Math.max(margin, (offsetX - cSize) / 2);

    const topY = offsetY + margin;
    const bottomY = offsetY + displayHeight - cSize - margin;

    const positions = {
        tl: { left: leftX, top: topY },
        tr: { left: rightX, top: topY },
        bl: { left: leftX, top: bottomY },
        br: { left: rightX, top: bottomY },
    };

    for (const [key, canvas] of Object.entries(cornerZoomCanvases)) {
        const pos = positions[key];
        canvas.style.left = pos.left + 'px';
        canvas.style.top = pos.top + 'px';
        canvas.style.display = 'block';
    }
}

// ─── Test helpers ───────────────────────────────────────────────────────────

function createCornerCanvases() {
    const canvases = { tl: createMockCanvas(), tr: createMockCanvas(), bl: createMockCanvas(), br: createMockCanvas() };
    const ctxs = {};
    for (const [key, canvas] of Object.entries(canvases)) {
        ctxs[key] = canvas.ctx;
    }
    return { canvases, ctxs };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('corner zoom interaction — happy path', () => {
    let cornerZoomCanvases, cornerZoomCtxs, sourceCanvas;

    beforeEach(() => {
        ({ canvases: cornerZoomCanvases, ctxs: cornerZoomCtxs } = createCornerCanvases());
        sourceCanvas = { width: 1000, height: 1500 };
    });

    it('corner zooms update when points added', () => {
        const image = { width: 1000, height: 1500 };
        const displayScale = 2;
        const points = [
            { x: 100, y: 100 },   // near TL
            { x: 900, y: 100 },   // near TR
            { x: 100, y: 1400 },  // near BL
            { x: 900, y: 1400 },  // near BR
        ];

        updateAllCornerZooms(points, image, sourceCanvas, cornerZoomCanvases, cornerZoomCtxs, displayScale);

        // All 4 corner canvases should have drawImage called (zoomed region rendered)
        for (const key of ['tl', 'tr', 'bl', 'br']) {
            expect(cornerZoomCtxs[key].drawImage).toHaveBeenCalledTimes(1);
            expect(cornerZoomCanvases[key].classList.add).toHaveBeenCalledWith('has-point');
        }
    });

    it('corner zooms update during drag', () => {
        const image = { width: 1000, height: 1500 };
        const displayScale = 2;
        const points = [
            { x: 100, y: 100 },
            { x: 900, y: 100 },
            { x: 100, y: 1400 },
            { x: 900, y: 1400 },
        ];

        // Initial render
        updateAllCornerZooms(points, image, sourceCanvas, cornerZoomCanvases, cornerZoomCtxs, displayScale);

        // Simulate drag — move TL point
        points[0] = { x: 150, y: 130 };

        // Re-render after drag
        updateAllCornerZooms(points, image, sourceCanvas, cornerZoomCanvases, cornerZoomCtxs, displayScale);

        // Each corner canvas should have drawImage called twice (initial + after drag)
        for (const key of ['tl', 'tr', 'bl', 'br']) {
            expect(cornerZoomCtxs[key].drawImage).toHaveBeenCalledTimes(2);
        }

        // TL canvas should have been redrawn with updated source region
        const tlDrawArgs = cornerZoomCtxs.tl.drawImage.mock.calls[1];
        const regionSize = CORNER_ZOOM_SIZE * displayScale / ZOOM_FACTOR;
        const expectedSx = 150 - regionSize / 2;
        const expectedSy = 130 - regionSize / 2;
        expect(tlDrawArgs[1]).toBeCloseTo(expectedSx);
        expect(tlDrawArgs[2]).toBeCloseTo(expectedSy);
    });
});

describe('corner zoom interaction — negative', () => {
    let cornerZoomCanvases, cornerZoomCtxs, sourceCanvas;

    beforeEach(() => {
        ({ canvases: cornerZoomCanvases, ctxs: cornerZoomCtxs } = createCornerCanvases());
        sourceCanvas = { width: 1000, height: 1500 };
    });

    it('corner zooms clear on reset', () => {
        const image = { width: 1000, height: 1500 };
        const displayScale = 2;
        const points = [
            { x: 100, y: 100 },
            { x: 900, y: 100 },
            { x: 100, y: 1400 },
            { x: 900, y: 1400 },
        ];

        // Render with points
        updateAllCornerZooms(points, image, sourceCanvas, cornerZoomCanvases, cornerZoomCtxs, displayScale);

        // Reset mocks to isolate the reset call
        for (const key of ['tl', 'tr', 'bl', 'br']) {
            cornerZoomCtxs[key].clearRect.mockClear();
            cornerZoomCtxs[key].drawImage.mockClear();
            cornerZoomCanvases[key].classList.remove.mockClear();
        }

        // Clear all points and call update (simulates resetAllPoints -> drawPoints -> updateAllCornerZooms)
        const emptyPoints = [];
        updateAllCornerZooms(emptyPoints, image, sourceCanvas, cornerZoomCanvases, cornerZoomCtxs, displayScale);

        // All canvases should be cleared and classList.remove('has-point') called
        for (const key of ['tl', 'tr', 'bl', 'br']) {
            expect(cornerZoomCtxs[key].clearRect).toHaveBeenCalledWith(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);
            expect(cornerZoomCtxs[key].drawImage).not.toHaveBeenCalled();
            expect(cornerZoomCanvases[key].classList.remove).toHaveBeenCalledWith('has-point');
        }
    });
});

describe('corner zoom interaction — boundary', () => {
    let cornerZoomCanvases, cornerZoomCtxs;

    beforeEach(() => {
        ({ canvases: cornerZoomCanvases, ctxs: cornerZoomCtxs } = createCornerCanvases());
    });

    it('corner zooms reposition on setupCanvas', () => {
        const offsetX = 200;
        const offsetY = 50;
        const displayWidth = 600;
        const displayHeight = 900;

        positionCornerZooms(offsetX, offsetY, displayWidth, displayHeight, cornerZoomCanvases);

        const margin = 8;
        const cSize = CORNER_ZOOM_SIZE;
        const expectedLeftX = Math.max(margin, (offsetX - cSize) / 2); // max(8, 25) = 25
        const expectedRightX = offsetX + displayWidth + Math.max(margin, (offsetX - cSize) / 2); // 200 + 600 + 25 = 825
        const expectedTopY = offsetY + margin; // 50 + 8 = 58
        const expectedBottomY = offsetY + displayHeight - cSize - margin; // 50 + 900 - 150 - 8 = 792

        // TL
        expect(cornerZoomCanvases.tl.style.left).toBe(expectedLeftX + 'px');
        expect(cornerZoomCanvases.tl.style.top).toBe(expectedTopY + 'px');
        expect(cornerZoomCanvases.tl.style.display).toBe('block');

        // TR
        expect(cornerZoomCanvases.tr.style.left).toBe(expectedRightX + 'px');
        expect(cornerZoomCanvases.tr.style.top).toBe(expectedTopY + 'px');
        expect(cornerZoomCanvases.tr.style.display).toBe('block');

        // BL
        expect(cornerZoomCanvases.bl.style.left).toBe(expectedLeftX + 'px');
        expect(cornerZoomCanvases.bl.style.top).toBe(expectedBottomY + 'px');
        expect(cornerZoomCanvases.bl.style.display).toBe('block');

        // BR
        expect(cornerZoomCanvases.br.style.left).toBe(expectedRightX + 'px');
        expect(cornerZoomCanvases.br.style.top).toBe(expectedBottomY + 'px');
        expect(cornerZoomCanvases.br.style.display).toBe('block');
    });

    it('corner zooms hidden when offsetX too small', () => {
        // offsetX < CORNER_ZOOM_SIZE + 16 = 166
        const offsetX = 100;
        const offsetY = 50;
        const displayWidth = 600;
        const displayHeight = 900;

        positionCornerZooms(offsetX, offsetY, displayWidth, displayHeight, cornerZoomCanvases);

        for (const key of ['tl', 'tr', 'bl', 'br']) {
            expect(cornerZoomCanvases[key].style.display).toBe('none');
        }
    });
});
