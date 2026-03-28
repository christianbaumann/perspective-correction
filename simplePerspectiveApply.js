import { PerspectiveTransform } from './perspectiveTransform.js';

export function applySimplePerspective(orderedPoints, { sourceCtx, pointsCanvas, downloadBtn, statusMessage }) {
    // Calculate bounding box
    let minX = sourceCtx.canvas.width, maxX = 0, minY = sourceCtx.canvas.height, maxY = 0;
    for (const point of orderedPoints) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }

    const destWidth = Math.max(10, Math.round(maxX - minX));
    const destHeight = Math.max(10, Math.round(maxY - minY));

    // Source points in order: TL, TR, BR, BL
    const srcPointsFlat = [
        orderedPoints[0].x, orderedPoints[0].y,
        orderedPoints[1].x, orderedPoints[1].y,
        orderedPoints[2].x, orderedPoints[2].y,
        orderedPoints[3].x, orderedPoints[3].y
    ];

    // Destination rectangle corners
    const destPointsFlat = [
        0, 0,
        destWidth, 0,
        destWidth, destHeight,
        0, destHeight
    ];

    const transform = new PerspectiveTransform(destPointsFlat, srcPointsFlat);

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = destWidth;
    tempCanvas.height = destHeight;
    const tempCtx = tempCanvas.getContext('2d', { alpha: false });

    const imageData = sourceCtx.getImageData(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height);
    const destImageData = tempCtx.createImageData(destWidth, destHeight);

    for (let y = 0; y < destHeight; y++) {
        for (let x = 0; x < destWidth; x++) {
            const srcCoords = transform.transform(x, y);
            const srcX = srcCoords[0];
            const srcY = srcCoords[1];
            const destIndex = (y * destWidth + x) * 4;
            const imgW = sourceCtx.canvas.width;
            const imgH = sourceCtx.canvas.height;

            if (srcX >= -0.5 && srcX < imgW && srcY >= -0.5 && srcY < imgH) {
                const sx = Math.max(0, Math.min(imgW - 1.001, srcX));
                const sy = Math.max(0, Math.min(imgH - 1.001, srcY));
                const x1 = Math.floor(sx), y1 = Math.floor(sy);
                const x2 = Math.min(x1 + 1, imgW - 1);
                const y2 = Math.min(y1 + 1, imgH - 1);
                const dx = sx - x1, dy = sy - y1;
                const w11 = (1-dx)*(1-dy), w12 = dx*(1-dy), w21 = (1-dx)*dy, w22 = dx*dy;
                const d = imageData.data;
                const i11 = (y1 * imgW + x1) * 4;
                const i12 = (y1 * imgW + x2) * 4;
                const i21 = (y2 * imgW + x1) * 4;
                const i22 = (y2 * imgW + x2) * 4;
                destImageData.data[destIndex]     = (d[i11]*w11 + d[i12]*w12 + d[i21]*w21 + d[i22]*w22 + 0.5) | 0;
                destImageData.data[destIndex + 1] = (d[i11+1]*w11 + d[i12+1]*w12 + d[i21+1]*w21 + d[i22+1]*w22 + 0.5) | 0;
                destImageData.data[destIndex + 2] = (d[i11+2]*w11 + d[i12+2]*w12 + d[i21+2]*w21 + d[i22+2]*w22 + 0.5) | 0;
                destImageData.data[destIndex + 3] = 255;
            } else {
                destImageData.data[destIndex] = 255;
                destImageData.data[destIndex + 1] = 255;
                destImageData.data[destIndex + 2] = 255;
                destImageData.data[destIndex + 3] = 255;
            }
        }
    }

    tempCtx.putImageData(destImageData, 0, 0);

    const transformedImageData = {
        canvas: tempCanvas,
        width: destWidth,
        height: destHeight,
        offsetX: minX,
        offsetY: minY,
        orderedPoints: orderedPoints
    };

    sourceCtx.clearRect(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height);
    sourceCtx.drawImage(tempCanvas, minX, minY, destWidth, destHeight);

    pointsCanvas.style.pointerEvents = 'none';
    downloadBtn.disabled = false;

    statusMessage.textContent = `Perspective correction applied! Corrected area: ${destWidth}×${destHeight} pixels.`;
    statusMessage.className = 'status success';

    return transformedImageData;
}
