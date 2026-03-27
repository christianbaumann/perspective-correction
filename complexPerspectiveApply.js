// simplifiedPerspectiveCorrection.js
// Perspective correction supporting 4+ points with edge snapping
// RESPECTS USER'S POINT SELECTION ORDER

export function applyComplexPerspective(
    orderedPoints,
    { sourceCtx, pointsCanvas, downloadBtn, statusMessage }
) {
    if (orderedPoints.length < 4) {
        fail('Select at least 4 corner points');
        return null;
    }

    // DO NOT RESORT - use points in the exact order user selected them
    const allPts = orderedPoints.map(p => ({ x: p.x, y: p.y }));
    
    // Determine corner points based on number of points
    let cornerPts;
    let edgeConstraints = null;
    
    if (allPts.length === 4) {
        // Exactly 4 points - these are the corners in user's order
        cornerPts = allPts;
    } else {
        // More than 4 points - identify corners and snap extras to edges
        const result = identifyCornersAndConstraints(allPts);
        cornerPts = result.corners;
        edgeConstraints = result.constraints;
    }
    
// Ensure corners are consistently ordered TL,TR,BR,BL
cornerPts = orderCorners(cornerPts);

// Calculate output dimensions from corners
const rect = calculateOutputDimensions(cornerPts);
const { width, height } = rect;

    // Create output canvas
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = canvas.getContext('2d', { alpha: false });

    const srcImg = sourceCtx.getImageData(
        0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height
    );
    const dstImg = ctx.createImageData(canvas.width, canvas.height);

    // Define destination corners (perfect rectangle)
    // Top-left, top-right, bottom-right, bottom-left
    const dstCorners = [
        { x: 0, y: 0 },
        { x: width - 1, y: 0 },
        { x: width - 1, y: height - 1 },
        { x: 0, y: height - 1 }
    ];

    // Compute base homography matrix
    const H = computeHomography(cornerPts, dstCorners);
    const H_inv = invertHomography(H);

    // Progress tracking
    const totalPixels = canvas.width * canvas.height;
    let processedPixels = 0;

    // Inverse warp with optional edge constraints
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            let src;
            
            if (edgeConstraints && edgeConstraints.length > 0) {
                // Use constrained mapping for 5+ points
                src = applyConstrainedMapping(x, y, H_inv, edgeConstraints, width, height);
            } else {
                // Standard homography for 4 points
                src = applyHomography(x, y, H_inv);
            }
            
            // Sample with bilinear interpolation
            const rgba = bilinearSample(srcImg, src.x, src.y);

            const i = (y * canvas.width + x) * 4;
            dstImg.data[i]     = rgba[0];
            dstImg.data[i + 1] = rgba[1];
            dstImg.data[i + 2] = rgba[2];
            dstImg.data[i + 3] = 255;

            processedPixels++;
            if (processedPixels % 10000 === 0) {
                const progress = Math.floor((processedPixels / totalPixels) * 100);
                statusMessage.textContent = `Processing: ${progress}%`;
            }
        }
    }

    ctx.putImageData(dstImg, 0, 0);

    // Optional: Apply mild sharpening for text clarity
    applySharpen(ctx, canvas.width, canvas.height);

    // Display result
    sourceCtx.clearRect(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height);
    sourceCtx.drawImage(canvas, 0, 0);

    pointsCanvas.style.pointerEvents = 'none';
    downloadBtn.disabled = false;

    const pointInfo = edgeConstraints ? ` with ${edgeConstraints.length} edge constraints` : '';
    statusMessage.textContent = `Corrected (${canvas.width}×${canvas.height})${pointInfo}`;
    statusMessage.className = 'status success';

    return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        orderedPoints: allPts,
        cornerPoints: cornerPts,
        constraints: edgeConstraints
    };

    function fail(msg) {
        statusMessage.textContent = msg;
        statusMessage.className = 'status error';
    }
}

/* ===================== CORNER IDENTIFICATION & CONSTRAINTS ===================== */

/**
 * For 5+ points: identify the 4 corners and create edge constraints for the rest
 * Strategy: Find the 4 points that form the largest quadrilateral area
 */
function identifyCornersAndConstraints(points) {
    const n = points.length;
    
    if (n === 4) {
        return { corners: points, constraints: [] };
    }
    
    if (n === 5) {
        // With 5 points, find best 4 corners and snap the 5th to nearest edge
        return findBest4CornersFrom5(points);
    }
    
    if (n === 6) {
        // With 6 points, find best 4 corners and snap the 2 extras to edges
        return findBest4CornersFrom6(points);
    }

    if (n == 8) {
        // With 8 points, find best 4 corners and snap the 4 extras to edges
        return findBest4CornersFrom8(points);
    }

    // For 7+ points, use a general approach
    return findBestCornersGeneral(points);
}

/**
 * For 5 points: try all combinations of 4 points as corners
 */
function findBest4CornersFrom5(points) {
    let bestCorners = [];
    let bestArea = 0;
    let extraPointIndex = -1;
    
    // Try each point as the "extra" non-corner point
    for (let skipIdx = 0; skipIdx < 5; skipIdx++) {
        const corners = points.filter((_, i) => i !== skipIdx);
        const area = calculateQuadArea(corners);
        
        if (area > bestArea) {
            bestArea = area;
            bestCorners = corners;
            extraPointIndex = skipIdx;
        }
    }
    
    // Create constraint for the extra point
    const extraPoint = points[extraPointIndex];
    const constraint = snapPointsToEdges([extraPoint], bestCorners, 
                                       calculateOutputDimensions(bestCorners).width,
                                       calculateOutputDimensions(bestCorners).height);
    
    return { corners: bestCorners, constraints: constraint };
}

/**
 * For 6 points: try all combinations of 4 points as corners
 */
function findBest4CornersFrom6(points) {
    let bestCorners = [];
    let bestArea = 0;
    let extraIndices = [];
    
    // Try all combinations of 4 points from 6
    for (let i = 0; i < 6; i++) {
        for (let j = i + 1; j < 6; j++) {
            const corners = points.filter((_, idx) => idx !== i && idx !== j);
            const area = calculateQuadArea(corners);
            
            if (area > bestArea) {
                bestArea = area;
                bestCorners = corners;
                extraIndices = [i, j];
            }
        }
    }
    
    // Create constraints for the extra points
    const extraPoints = extraIndices.map(i => points[i]);
    const { width, height } = calculateOutputDimensions(bestCorners);
    const constraints = snapPointsToEdges(extraPoints, bestCorners, width, height);
    
    return { corners: bestCorners, constraints };
};


function findBest4CornersFrom8(points) {
    let bestCorners = [];
    let bestArea = 0;
    let extraIndices = [];
    
    // Try all combinations of 4 points from 8
    for (let i = 0; i < 8; i++) {
        for (let j = i + 1; j < 8; j++) {
            for (let k = j + 1; k < 8; k++) {
                for (let l = k + 1; l < 8; l++) {
                    const corners = [points[i], points[j], points[k], points[l]];
                    const area = calculateQuadArea(corners);
                    
                    if (area > bestArea) {
                        bestArea = area;
                        bestCorners = corners;
                        extraIndices = [i, j, k, l];
                    }
                }
            }
        }
    }
    
    // Create constraints for the extra points
    const extraPoints = extraIndices.map(i => points[i]);
    const { width, height } = calculateOutputDimensions(bestCorners);
    const constraints = snapPointsToEdges(extraPoints, bestCorners, width, height);
    
    return { corners: bestCorners, constraints };
}
/**
 * General approach for 7+ points: find best 4 corners by trying all combinations
 */
function findBestCornersGeneral(points) {
    const n = points.length;
    let bestCorners = [];
    let bestArea = 0;
    let bestCornerIndices = [];
    
    // Try all combinations of 4 points from n
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            for (let k = j + 1; k < n; k++) {
                for (let l = k + 1; l < n; l++) {
                    const corners = [points[i], points[j], points[k], points[l]];
                    const area = calculateQuadArea(corners);
                    
                    if (area > bestArea) {
                        bestArea = area;
                        bestCorners = corners;
                        bestCornerIndices = [i, j, k, l];
                    }
                }
            }
        }
    }
    
    // Create constraints for the extra points (all points not used as corners)
    const cornerSet = new Set(bestCornerIndices);
    const extraPoints = points.filter((_, idx) => !cornerSet.has(idx));
    const { width, height } = calculateOutputDimensions(bestCorners);
    const constraints = snapPointsToEdges(extraPoints, bestCorners, width, height);
    
    return { corners: bestCorners, constraints };
}

/**
 * Calculate area of a quadrilateral (shoelace formula)
 */
function calculateQuadArea(quad) {
    if (quad.length !== 4) return 0;
    
    let area = 0;
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        area += quad[i].x * quad[j].y;
        area -= quad[j].x * quad[i].y;
    }
    return Math.abs(area) / 2;
}

/**
 * Snap points to the nearest rectangular edge
 */
function snapPointsToEdges(extraPoints, cornerPoints, width, height) {
    const constraints = [];
    
    for (const point of extraPoints) {
        // Find which edge this point is closest to
        const edgeInfo = findNearestEdge(point, cornerPoints);
        
        // Calculate position along that edge (0 to 1)
        const edgeParam = calculateEdgeParameter(point, edgeInfo);
        
        // Map to destination rectangle edge
        const destPoint = mapToRectangleEdge(edgeParam, edgeInfo.edgeIndex, width, height);
        
        constraints.push({
            src: point,
            dst: destPoint,
            edge: edgeInfo.edgeIndex,
            param: edgeParam,
            distance: edgeInfo.distance
        });
    }
    
    return constraints;
}

/**
 * Find which edge of the quadrilateral a point is closest to
 */
function findNearestEdge(point, corners) {
    let minDist = Infinity;
    let nearestEdgeIndex = 0;
    let nearestP1, nearestP2;
    
    for (let i = 0; i < 4; i++) {
        const p1 = corners[i];
        const p2 = corners[(i + 1) % 4];
        const dist = pointToSegmentDistance(point, p1, p2);
        
        if (dist < minDist) {
            minDist = dist;
            nearestEdgeIndex = i;
            nearestP1 = p1;
            nearestP2 = p2;
        }
    }
    
    return { 
        edgeIndex: nearestEdgeIndex,
        p1: nearestP1,
        p2: nearestP2,
        distance: minDist 
    };
}

/**
 * Calculate distance from point to line segment
 */
function pointToSegmentDistance(point, p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    
    if (lenSq === 0) return Math.hypot(point.x - p1.x, point.y - p1.y);
    
    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    
    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;
    
    return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * Calculate parameter (0 to 1) along edge where point projects
 */
function calculateEdgeParameter(point, edgeInfo) {
    const { p1, p2 } = edgeInfo;
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    
    if (lenSq === 0) return 0.5;
    
    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;
    return Math.max(0, Math.min(1, t));
}

/**
 * Map edge parameter to destination rectangle edge
 * Edge indices: 0=top, 1=right, 2=bottom, 3=left
 */
function mapToRectangleEdge(param, edgeIndex, width, height) {
    switch (edgeIndex) {
        case 0: // Top edge: corner 0 to corner 1
            return { x: param * (width - 1), y: 0 };
        case 1: // Right edge: corner 1 to corner 2
            return { x: width - 1, y: param * (height - 1) };
        case 2: // Bottom edge: corner 2 to corner 3
            return { x: (1 - param) * (width - 1), y: height - 1 };
        case 3: // Left edge: corner 3 to corner 0
            return { x: 0, y: (1 - param) * (height - 1) };
        default:
            return { x: 0, y: 0 };
    }
}

/**
 * Apply constrained mapping using homography with local corrections
 */
function applyConstrainedMapping(x, y, H_inv, constraints, width, height) {
    // Start with base homography
    const baseMapping = applyHomography(x, y, H_inv);
    
    if (!constraints || constraints.length === 0) {
        return baseMapping;
    }
    
    // Apply constraint corrections using inverse distance weighting
    let totalWeight = 0;
    let correctionX = 0;
    let correctionY = 0;
    
    const maxInfluence = Math.min(width, height) * 0.25;
    
    for (const constraint of constraints) {
        // Distance from current output point to constraint's destination
        const dx = x - constraint.dst.x;
        const dy = y - constraint.dst.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Only apply influence within radius
        if (dist < maxInfluence) {
            // Inverse distance weighting
            const weight = 1 / (1 + (dist * dist) / 1000);
            
            // Where homography would map the constraint source
            const constraintMapped = applyHomography(constraint.src.x, constraint.src.y,
                                                    invertHomography(H_inv));
            
            // Correction vector (how far off the homography is)
            const corrX = constraint.dst.x - constraintMapped.x;
            const corrY = constraint.dst.y - constraintMapped.y;
            
            correctionX += weight * corrX;
            correctionY += weight * corrY;
            totalWeight += weight;
        }
    }
    
    if (totalWeight > 0.01) {
        // Apply weighted average correction
        const avgCorrX = correctionX / totalWeight;
        const avgCorrY = correctionY / totalWeight;
        
        // Blend factor based on total weight
        const blendFactor = Math.min(totalWeight * 0.5, 1);
        
        return {
            x: baseMapping.x - avgCorrX * blendFactor,
            y: baseMapping.y - avgCorrY * blendFactor
        };
    }
    
    return baseMapping;
}

/* ===================== CORE FUNCTIONS ===================== */

/**
 * Calculate output dimensions preserving aspect ratio
 */
function calculateOutputDimensions(corners) {
    // Calculate all 4 edge lengths
    const edges = [];
    for (let i = 0; i < 4; i++) {
        const p1 = corners[i];
        const p2 = corners[(i + 1) % 4];
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        edges.push(len);
    }

    // Width: average of top (edge 0) and bottom (edge 2) edges
    const width = Math.max((edges[0] + edges[2]) / 2, 10);
    
    // Height: average of right (edge 1) and left (edge 3) edges
    const height = Math.max((edges[1] + edges[3]) / 2, 10);

    return { width, height, corners };
}

/**
 * Compute homography matrix using Direct Linear Transform (DLT)
 */
function computeHomography(srcCorners, dstCorners) {
    const A = [];
    
    for (let i = 0; i < 4; i++) {
        const xs = srcCorners[i].x;
        const ys = srcCorners[i].y;
        const xd = dstCorners[i].x;
        const yd = dstCorners[i].y;

        A.push([
            -xs, -ys, -1,   0,   0,  0, xd * xs, xd * ys, xd
        ]);
        A.push([
              0,   0,  0, -xs, -ys, -1, yd * xs, yd * ys, yd
        ]);
    }

    const h = solveDLT(A);

    return [
        [h[0], h[1], h[2]],
        [h[3], h[4], h[5]],
        [h[6], h[7], h[8]]
    ];
}

/**
 * Solve DLT system using power iteration
 */
function solveDLT(A) {
    // A is rows x 9 (should be 8x9). Find non-trivial h s.t. A * h = 0
    const m = A.length;
    const n = A[0].length;
    // Make a copy to avoid mutating input
    const M = Array.from({ length: m }, (_, i) => A[i].slice());
    const eps = 1e-12;
    let row = 0;
    const pivotCols = [];

    for (let col = 0; col < n && row < m; col++) {
        // Partial pivot
        let best = row;
        for (let r = row + 1; r < m; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[best][col])) best = r;
        }
        if (Math.abs(M[best][col]) < eps) continue;
        // swap
        if (best !== row) {
            const tmp = M[best]; M[best] = M[row]; M[row] = tmp;
        }
        // normalize pivot row
        const piv = M[row][col];
        for (let c = col; c < n; c++) M[row][c] /= piv;
        // eliminate other rows
        for (let r = 0; r < m; r++) {
            if (r === row) continue;
            const factor = M[r][col];
            if (Math.abs(factor) < eps) continue;
            for (let c = col; c < n; c++) M[r][c] -= factor * M[row][c];
        }
        pivotCols.push(col);
        row++;
    }

    // find a free column (one not in pivotCols)
    let freeCol = -1;
    for (let c = 0; c < n; c++) {
        if (!pivotCols.includes(c)) { freeCol = c; break; }
    }
    if (freeCol === -1) {
        // fallback: return last column = 1, others 0
        const fallback = Array(n).fill(0);
        fallback[n - 1] = 1;
        return fallback;
    }

    const h = Array(n).fill(0);
    h[freeCol] = 1;

    // back-substitute: for each pivot row, compute its variable
    for (let r = pivotCols.length - 1; r >= 0; r--) {
        const c = pivotCols[r];
        // Find row index that has pivot at column c (rows were filled top->down)
        // pivot row is r (since we advanced row for each pivot)
        const prow = r;
        let sum = 0;
        for (let cc = c + 1; cc < n; cc++) sum += M[prow][cc] * h[cc];
        h[c] = -sum; // because row is normalized: 1*var + sum = 0 => var = -sum
    }

    // normalize (optional)
    const maxAbs = Math.max(...h.map(v => Math.abs(v)), 1e-12);
    for (let i = 0; i < n; i++) h[i] /= maxAbs;
    return h;
}

/**
 * Invert 3x3 homography matrix
 */
function invertHomography(H) {
    const [[a, b, c], [d, e, f], [g, h, i]] = H;
    
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    
    if (Math.abs(det) < 1e-10) {
        return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    }
    
    const invDet = 1 / det;
    
    return [
        [
            (e * i - f * h) * invDet,
            (c * h - b * i) * invDet,
            (b * f - c * e) * invDet
        ],
        [
            (f * g - d * i) * invDet,
            (a * i - c * g) * invDet,
            (c * d - a * f) * invDet
        ],
        [
            (d * h - e * g) * invDet,
            (b * g - a * h) * invDet,
            (a * e - b * d) * invDet
        ]
    ];
}

/**
 * Apply homography transformation to a point
 */
function applyHomography(x, y, H) {
    const w = H[2][0] * x + H[2][1] * y + H[2][2];
    
    if (Math.abs(w) < 1e-10) {
        return { x: x, y: y };
    }
    
    return {
        x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
        y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w
    };
}

/**
 * Bilinear interpolation for smooth sampling
 */
function bilinearSample(img, x, y) {
    const w = img.width;
    const h = img.height;

    if (x < 0 || x >= w || y < 0 || y >= h) {
        return [255, 255, 255, 255];
    }

    x = Math.max(0, Math.min(w - 1.001, x));
    y = Math.max(0, Math.min(h - 1.001, y));

    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.min(x1 + 1, w - 1);
    const y2 = Math.min(y1 + 1, h - 1);

    const dx = x - x1;
    const dy = y - y1;

    const d = img.data;
    const i11 = (y1 * w + x1) * 4;
    const i12 = (y1 * w + x2) * 4;
    const i21 = (y2 * w + x1) * 4;
    const i22 = (y2 * w + x2) * 4;

    const lerp = (a, b, t) => a + (b - a) * t;

    return [
        Math.round(lerp(lerp(d[i11], d[i12], dx), lerp(d[i21], d[i22], dx), dy)),
        Math.round(lerp(lerp(d[i11+1], d[i12+1], dx), lerp(d[i21+1], d[i22+1], dx), dy)),
        Math.round(lerp(lerp(d[i11+2], d[i12+2], dx), lerp(d[i21+2], d[i22+2], dx), dy)),
        255
    ];
}

/**
 * Apply mild unsharp mask for text clarity
 */
function applySharpen(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const original = new Uint8ClampedArray(data);

    const strength = 0.25;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = (y * width + x) * 4;

            for (let c = 0; c < 3; c++) {
                const center = original[i + c];
                
                const sum = 
                    original[((y-1) * width + x-1) * 4 + c] +
                    original[((y-1) * width + x) * 4 + c] +
                    original[((y-1) * width + x+1) * 4 + c] +
                    original[(y * width + x-1) * 4 + c] +
                    original[(y * width + x+1) * 4 + c] +
                    original[((y+1) * width + x-1) * 4 + c] +
                    original[((y+1) * width + x) * 4 + c] +
                    original[((y+1) * width + x+1) * 4 + c];
                
                const avg = sum / 8;
                const detail = center - avg;
                const sharpened = center + strength * detail;
                
                data[i + c] = Math.max(0, Math.min(255, Math.round(sharpened)));
            }
        }
    }

    ctx.putImageData(imageData, 0, 0);
}

// Ensure corners are ordered TL -> TR -> BR -> BL
function orderCorners(corners) {
    if (corners.length !== 4) return corners;
    const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
    const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
    const pts = corners.map(p => ({ x: p.x, y: p.y, a: Math.atan2(p.y - cy, p.x - cx) }));
    pts.sort((u, v) => u.a - v.a);
    // find top-left (min x+y) and rotate so it is first
    let idx = 0, minSum = Infinity;
    for (let i = 0; i < 4; i++) {
        const s = pts[i].x + pts[i].y;
        if (s < minSum) { minSum = s; idx = i; }
    }
    const ordered = [];
    for (let i = 0; i < 4; i++) ordered.push({ x: pts[(idx + i) % 4].x, y: pts[(idx + i) % 4].y });
    return ordered;
}