import { describe, it, expect, vi, beforeEach } from 'vitest';

const ZOOM_FACTOR = 3;
const ZOOM_CANVAS_SIZE = 200;

/**
 * Since updateZoomPreview / hideZoomPreview are module-scoped in script.js
 * and not exported, we replicate the core logic inline and test that the
 * zoom calculations and visibility changes are correct.
 */

function createMockCanvasContext() {
    return {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        strokeStyle: '',
        lineWidth: 0,
        fillStyle: '',
    };
}

function setupZoomElements() {
    const zoomCtx = createMockCanvasContext();
    const zoomCanvas = {
        width: ZOOM_CANVAS_SIZE,
        height: ZOOM_CANVAS_SIZE,
        getContext: () => zoomCtx,
        style: { display: 'none' },
    };
    const sourceCanvas = {
        width: 800,
        height: 600,
    };
    return { zoomCanvas, zoomCtx, sourceCanvas };
}

function updateZoomPreview(pointX, pointY, { image, sourceCanvas, zoomCanvas, zoomCtx, displayScale, points = [] }) {
    if (!image || !sourceCanvas.width) {
        zoomCanvas.style.display = 'none';
        return;
    }

    zoomCanvas.style.display = 'block';

    const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
    const sx = pointX - regionSize / 2;
    const sy = pointY - regionSize / 2;

    zoomCtx.clearRect(0, 0, ZOOM_CANVAS_SIZE, ZOOM_CANVAS_SIZE);
    zoomCtx.drawImage(
        sourceCanvas,
        sx, sy, regionSize, regionSize,
        0, 0, ZOOM_CANVAS_SIZE, ZOOM_CANVAS_SIZE
    );

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
}

function hideZoomPreview(zoomCanvas) {
    zoomCanvas.style.display = 'none';
}

describe('zoom preview interaction', () => {
    let zoomCanvas, zoomCtx, sourceCanvas;

    beforeEach(() => {
        ({ zoomCanvas, zoomCtx, sourceCanvas } = setupZoomElements());
    });

    it('drag point shows and updates zoom', () => {
        const image = { width: 800, height: 600 };
        const displayScale = 1;

        updateZoomPreview(150, 200, { image, sourceCanvas, zoomCanvas, zoomCtx, displayScale });

        expect(zoomCanvas.style.display).toBe('block');
        expect(zoomCtx.drawImage).toHaveBeenCalledTimes(1);

        const args = zoomCtx.drawImage.mock.calls[0];
        expect(args[0]).toBe(sourceCanvas);
        expect(args[5]).toBe(0);
        expect(args[6]).toBe(0);
        expect(args[7]).toBe(ZOOM_CANVAS_SIZE);
        expect(args[8]).toBe(ZOOM_CANVAS_SIZE);
    });

    it('zoom preview composites source image region', () => {
        const image = { width: 800, height: 600 };
        const displayScale = 1;
        // regionSize = 200 * 1 / 3 ≈ 66.67
        // point at (100, 100): sx = 100 - 33.33 ≈ 66.67, sy same
        const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
        const sx = 100 - regionSize / 2;
        const sy = 100 - regionSize / 2;
        updateZoomPreview(100, 100, { image, sourceCanvas, zoomCanvas, zoomCtx, displayScale });

        const args = zoomCtx.drawImage.mock.calls[0];
        expect(args[1]).toBeCloseTo(sx);
        expect(args[2]).toBeCloseTo(sy);
        expect(args[3]).toBeCloseTo(regionSize);
        expect(args[4]).toBeCloseTo(regionSize);
        expect(args[5]).toBe(0);
        expect(args[6]).toBe(0);
        expect(args[7]).toBe(200);
        expect(args[8]).toBe(200);
    });

    it('zoom hidden after reset', () => {
        zoomCanvas.style.display = 'block';
        expect(zoomCanvas.style.display).toBe('block');

        hideZoomPreview(zoomCanvas);

        expect(zoomCanvas.style.display).toBe('none');
    });

    it('drag point near edge updates zoom with clipped region', () => {
        const image = { width: 800, height: 600 };
        const displayScale = 1;
        const regionSize = ZOOM_CANVAS_SIZE * displayScale / ZOOM_FACTOR;
        const sx = 5 - regionSize / 2;
        const sy = 5 - regionSize / 2;

        expect(() => {
            updateZoomPreview(5, 5, { image, sourceCanvas, zoomCanvas, zoomCtx, displayScale });
        }).not.toThrow();

        const args = zoomCtx.drawImage.mock.calls[0];
        expect(args[1]).toBeCloseTo(sx);
        expect(args[2]).toBeCloseTo(sy);
        expect(args[3]).toBeCloseTo(regionSize);
        expect(args[4]).toBeCloseTo(regionSize);
    });

    it('zoom preview shows point crosshair when hovering near a point', () => {
        const image = { width: 800, height: 600 };
        const displayScale = 1;
        const points = [{ x: 150, y: 200 }];

        updateZoomPreview(150, 200, { image, sourceCanvas, zoomCanvas, zoomCtx, displayScale, points });

        expect(zoomCanvas.style.display).toBe('block');
        // Point is at cursor position → drawn as light blue crosshair
        // stroke called for: 2 point arms + (cursor would be more but this reimpl doesn't include cursor)
        expect(zoomCtx.stroke).toHaveBeenCalled();
        // Point center dot arc
        expect(zoomCtx.arc).toHaveBeenCalled();
        // fillStyle should have been set to #74c0fc for the point dot
        expect(zoomCtx.fillStyle).toBe('#74c0fc');
    });

    it('zoom preview has no point crosshair when hovering far from all points', () => {
        const image = { width: 800, height: 600 };
        const displayScale = 1;
        const points = [{ x: 100, y: 100 }];

        // Hover far away at (500, 500)
        updateZoomPreview(500, 500, { image, sourceCanvas, zoomCanvas, zoomCtx, displayScale, points });

        expect(zoomCanvas.style.display).toBe('block');
        // No point crosshair strokes — only drawImage called, no stroke/arc
        expect(zoomCtx.stroke).not.toHaveBeenCalled();
        expect(zoomCtx.arc).not.toHaveBeenCalled();
    });
});
