// Helper utilities: ordering points and getting canvas coordinates
export function orderPoints(pts) {
    // Find centroid
    let cx = 0, cy = 0;
    for (const p of pts) {
        cx += p.x;
        cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;

    // Sort by angle from centroid
    const ordered = pts.map(p => ({
        ...p,
        angle: Math.atan2(p.y - cy, p.x - cx)
    })).sort((a, b) => a.angle - b.angle);

    // Find top-left point (closest to origin)
    let minDist = Infinity;
    let startIdx = 0;
    for (let i = 0; i < ordered.length; i++) {
        const dist = ordered[i].x * ordered[i].x + ordered[i].y * ordered[i].y;
        if (dist < minDist) {
            minDist = dist;
            startIdx = i;
        }
    }

    const result = [];
    for (let i = 0; i < ordered.length; i++) {
        result.push(ordered[(startIdx + i) % ordered.length]);
    }

    return result;
}

export function getCanvasCoordinates(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    return { x, y };
}

export function normalizePoints(points, width, height) {
    return points.map(p => ({
        x: p.x / width,
        y: p.y / height
    }));
}

export function denormalizePoints(normalizedPoints, width, height) {
    return normalizedPoints.map(p => ({
        x: p.x * width,
        y: p.y * height
    }));
}

