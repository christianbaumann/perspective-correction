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
    const tempCtx = tempCanvas.getContext('2d');

    const imageData = sourceCtx.getImageData(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height);
    const destImageData = tempCtx.createImageData(destWidth, destHeight);

    for (let y = 0; y < destHeight; y++) {
        for (let x = 0; x < destWidth; x++) {
            const srcCoords = transform.transform(x, y);
            const srcX = Math.round(srcCoords[0]);
            const srcY = Math.round(srcCoords[1]);

            const destIndex = (y * destWidth + x) * 4;

            if (srcX >= 0 && srcX < sourceCtx.canvas.width && srcY >= 0 && srcY < sourceCtx.canvas.height) {
                const srcIndex = (srcY * sourceCtx.canvas.width + srcX) * 4;
                destImageData.data[destIndex] = imageData.data[srcIndex];
                destImageData.data[destIndex + 1] = imageData.data[srcIndex + 1];
                destImageData.data[destIndex + 2] = imageData.data[srcIndex + 2];
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
