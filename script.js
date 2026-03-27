import { orderPoints, getCanvasCoordinates as getCoords, normalizePoints, denormalizePoints } from './helpers.js';
import { PerspectiveTransform } from './perspectiveTransform.js';
import { mapPointUsingMVC } from './mvc.js';
import { downloadCorrectedImage } from './download.js';
import { applySimplePerspective as applySimple} from './simplePerspectiveApply.js';
import { applyComplexPerspective as applyComplex} from './complexPerspectiveApply.js';
import { printCorrectedDocument } from './printCorrectedDocument.js';
import { isSupported, openFolder, loadImageFile, saveToOut, getNextImageIndex, deriveOutputFilename } from './folderBrowser.js';

// DOM Elements
const imageInput = document.getElementById('imageInput');
const fileUpload = document.getElementById('fileUpload');
const sourceCanvas = document.getElementById('sourceCanvas');
const pointsCanvas = document.getElementById('pointsCanvas');
const pointCount = document.getElementById('pointCount');
const addPointsBtn = document.getElementById('addPointsBtn');
const movePointsBtn = document.getElementById('movePointsBtn');
const deletePointsBtn = document.getElementById('deletePointsBtn');
const transformBtn = document.getElementById('transformBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const statusMessage = document.getElementById('statusMessage');
const printBtn = document.getElementById('printBtn');
const loadingOverlay = document.getElementById('loadingOverlay');

// Folder browser DOM elements
const folderBrowserGroup = document.getElementById('folderBrowserGroup');
const openFolderBtn = document.getElementById('openFolderBtn');
const folderImageList = document.getElementById('folderImageList');
const folderPath = document.getElementById('folderPath');
const saveToOutBtn = document.getElementById('saveToOutBtn');

// Canvas contexts
const sourceCtx = sourceCanvas.getContext('2d');
const pointsCtx = pointsCanvas.getContext('2d');

// Zoom preview
const zoomCanvas = document.getElementById('zoomCanvas');
const zoomCtx = zoomCanvas.getContext('2d');
const ZOOM_FACTOR = 3;
const ZOOM_CANVAS_SIZE = 200;
zoomCanvas.width = ZOOM_CANVAS_SIZE;
zoomCanvas.height = ZOOM_CANVAS_SIZE;

// Corner zoom previews
const CORNER_ZOOM_SIZE = 150;
const cornerZoomCanvases = {
    tl: document.getElementById('cornerZoomTL'),
    tr: document.getElementById('cornerZoomTR'),
    bl: document.getElementById('cornerZoomBL'),
    br: document.getElementById('cornerZoomBR'),
};
const cornerZoomCtxs = {};
for (const [key, canvas] of Object.entries(cornerZoomCanvases)) {
    canvas.width = CORNER_ZOOM_SIZE;
    canvas.height = CORNER_ZOOM_SIZE;
    cornerZoomCtxs[key] = canvas.getContext('2d');
}

// State variables
let image = null;
let points = [];
let selectedPointIndex = -1;
let mode = 'add';
let isDragging = false;
let transformedImageData = null;
let originalImageData = null;
let displayScale = 1; // Scale factor between display and actual image
let cornerDragState = null; // { cornerKey, pointRef, pointIndex }
let currentCornerAssignment = { tl: null, tr: null, bl: null, br: null };

// Folder browser state
let folderHandle = null;
let folderImages = [];
let currentFolderImageIndex = -1;

// Point persistence state
let savedNormalizedPoints = null; // Normalized points (0-1) for reuse across folder images

function releaseImageMemory() {
    originalImageData = null;
    transformedImageData = null;
    // Zero canvas backing stores to release GPU memory before resize
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    pointsCanvas.width = 0;
    pointsCanvas.height = 0;
}

function showLoading() { if (loadingOverlay) loadingOverlay.style.display = ''; }
function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = 'none'; }

const canvasWrapper = document.querySelector('.canvas-wrapper');

canvasWrapper.addEventListener('mousemove', (e) => {
    const rect = canvasWrapper.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    canvasWrapper.style.setProperty('--cursor-x', x + 'px');
    canvasWrapper.style.setProperty('--cursor-y', y + 'px');
});

// Initialize
function init() {
    if (printBtn) printBtn.addEventListener('click', () => printCorrectedDocument({ transformedImageData, statusMessage }));
    fileUpload.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', handleImageUpload);
    
    addPointsBtn.addEventListener('click', () => setMode('add'));
    movePointsBtn.addEventListener('click', () => setMode('move'));
    deletePointsBtn.addEventListener('click', () => setMode('delete'));
    
    transformBtn.addEventListener('click', applyPerspectiveCorrection);
    downloadBtn.addEventListener('click', () => downloadCorrectedImage({ transformedImageData, image, pointsCanvas, mapPointUsingMVC, PerspectiveTransform, statusMessage }));
    resetBtn.addEventListener('click', resetAllPoints);
    
    pointsCanvas.addEventListener('mousedown', handleCanvasMouseDown);
    pointsCanvas.addEventListener('mousemove', handleCanvasMouseMove);
    pointsCanvas.addEventListener('mouseup', handleCanvasMouseUp);
    pointsCanvas.addEventListener('mouseleave', () => {
        handleCanvasMouseUp();
        hideZoomPreview();
    });

    // Corner zoom drag events
    for (const [key, canvas] of Object.entries(cornerZoomCanvases)) {
        canvas.addEventListener('mousedown', (e) => handleCornerZoomMouseDown(e, key));
        canvas.addEventListener('mousemove', (e) => handleCornerZoomMouseMove(e));
        canvas.addEventListener('mouseup', handleCornerZoomMouseUp);
        canvas.addEventListener('mouseleave', handleCornerZoomMouseUp);
    }

    // Enter key triggers "Apply correction"
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.target.matches('input, textarea, select, button')) {
            e.preventDefault();
            applyPerspectiveCorrection();
        }
    });

    setMode('add');

    // Initialize grid
    if (typeof window.initGrid === 'function') {
        window.initGrid();
    }

    // Initialize folder browser if File System Access API is available
    if (isSupported() && folderBrowserGroup) {
        folderBrowserGroup.style.display = '';
        openFolderBtn.addEventListener('click', handleOpenFolder);
        saveToOutBtn.addEventListener('click', handleSaveToOut);
    }

    loadSampleImage();
}

// Load a sample image for demonstration
function loadSampleImage() {
    const svg = `
        <svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>
            <defs>
                <linearGradient id='g' x1='0' x2='1'>
                    <stop offset='0' stop-color='#74c0fc'/>
                    <stop offset='1' stop-color='#4dabf7'/>
                </linearGradient>
            </defs>
            <rect width='100%' height='100%' fill='url(#g)' />
            <g fill='white' font-family='Arial' font-weight='700' font-size='40' text-anchor='middle'>
                <text x='50%' y='45%'>Perspective</text>
                <text x='50%' y='55%'>Correction</text>
            </g>
            <rect x='80' y='80' width='640' height='440' fill='none' stroke='rgba(255,255,255,0.25)' stroke-width='8' rx='12'/>
        </svg>
    `;

    showLoading();
    const sampleImage = new Image();
    sampleImage.onload = function() {
        releaseImageMemory();
        image = sampleImage;
        setupCanvas();
        hideLoading();
        statusMessage.textContent = "Sample image loaded. Select 4+ points to define perspective correction area.";
        statusMessage.className = "status success";
    };
    sampleImage.onerror = function() {
        hideLoading();
        statusMessage.textContent = "Failed to load sample image. Please upload your own image.";
        statusMessage.className = "status error";
    };

    sampleImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Handle image upload
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoading();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function() {
        releaseImageMemory();
        image = img;
        setupCanvas();
        resetAllPoints();
        URL.revokeObjectURL(url);
        hideLoading();
        statusMessage.textContent = `Image loaded (${img.naturalWidth}×${img.naturalHeight}px). Original resolution preserved. Select 4+ points.`;
        statusMessage.className = "status success";
    };
    img.onerror = function() {
        URL.revokeObjectURL(url);
        hideLoading();
        statusMessage.textContent = "Failed to load image.";
        statusMessage.className = "status error";
    };
    img.src = url;
}

// Set up canvas dimensions - PRESERVE ORIGINAL RESOLUTION
function setupCanvas() {
    if (!image) return;
    
    const container = document.querySelector('.canvas-wrapper');
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // Get original image dimensions
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    
    // Calculate display scale to fit container while preserving aspect ratio
    const imageAspectRatio = imageWidth / imageHeight;
    let displayWidth, displayHeight;
    
    if (containerWidth / containerHeight > imageAspectRatio) {
        displayHeight = containerHeight;
        displayWidth = displayHeight * imageAspectRatio;
    } else {
        displayWidth = containerWidth;
        displayHeight = displayWidth / imageAspectRatio;
    }
    
    // Set canvas to ORIGINAL image resolution (not display size)
    sourceCanvas.width = imageWidth;
    sourceCanvas.height = imageHeight;

    // pointsCanvas at display resolution (only draws crosshairs/lines)
    pointsCanvas.width = Math.round(displayWidth);
    pointsCanvas.height = Math.round(displayHeight);

    // Calculate scale factor between display and actual canvas
    displayScale = imageWidth / displayWidth;

    // Store displayScale globally for grid function
    window.currentDisplayScale = displayScale;

    // Set CSS display size (visual size in browser)
    sourceCanvas.style.width = displayWidth + 'px';
    sourceCanvas.style.height = displayHeight + 'px';
    
    // Center canvases in container
    const offsetX = (containerWidth - displayWidth) / 2;
    const offsetY = (containerHeight - displayHeight) / 2;
    
    sourceCanvas.style.left = offsetX + 'px';
    sourceCanvas.style.top = offsetY + 'px';
    pointsCanvas.style.left = offsetX + 'px';
    pointsCanvas.style.top = offsetY + 'px';
    
    // Draw image at FULL RESOLUTION
    sourceCtx.drawImage(image, 0, 0, imageWidth, imageHeight);
    originalImageData = sourceCtx.getImageData(0, 0, imageWidth, imageHeight);
    
    points = [];
    selectedPointIndex = -1;
    updatePointCount();
    drawPoints();
    
    // Draw grid if enabled
    if (typeof window.drawGrid === 'function') {
        window.drawGrid(sourceCanvas, displayScale);
    }
    
    // Position corner zoom boxes
    positionCornerZooms(offsetX, offsetY, displayWidth, displayHeight);
    updateAllCornerZooms();

    console.log(`Canvas Resolution: ${imageWidth}×${imageHeight}, Display: ${displayWidth.toFixed(0)}×${displayHeight.toFixed(0)}, Scale: ${displayScale.toFixed(2)}x`);
}

// Set the current interaction mode
function setMode(newMode) {
    mode = newMode;

    addPointsBtn.classList.remove('active');
    movePointsBtn.classList.remove('active');
    deletePointsBtn.classList.remove('active');
    
    if (mode === 'add') {
        addPointsBtn.classList.add('active');
        statusMessage.textContent = "Add Points mode: Click on the image to add perspective correction points.";
    } else if (mode === 'move') {
        movePointsBtn.classList.add('active');
        statusMessage.textContent = "Move Points mode: Click and drag points to adjust their position.";
    } else if (mode === 'delete') {
        deletePointsBtn.classList.add('active');
        statusMessage.textContent = "Delete Points mode: Click on points to remove them.";
    }
    
    statusMessage.className = "status";

    // Corner zoom boxes are always interactive for dragging points
    for (const canvas of Object.values(cornerZoomCanvases)) {
        canvas.style.pointerEvents = 'auto';
    }
}

// Get canvas coordinates from mouse event - ACCOUNTING FOR SCALE
function getCanvasCoordinates(event) {
    const rect = pointsCanvas.getBoundingClientRect();
    
    // Get mouse position relative to canvas display
    const displayX = event.clientX - rect.left;
    const displayY = event.clientY - rect.top;
    
    // Scale to actual canvas coordinates
    const canvasX = displayX * displayScale;
    const canvasY = displayY * displayScale;
    
    return { x: canvasX, y: canvasY };
}

// Handle mouse down on canvas
function handleCanvasMouseDown(event) {
    if (!image) return;

    const coords = getCanvasCoordinates(event);
    const x = coords.x;
    const y = coords.y;

    // Hit detection radius scaled to display
    const hitRadius = 15 * displayScale;

    console.log(`[mousedown] mode=${mode}, click=(${x.toFixed(0)},${y.toFixed(0)}), points=${points.length}, hitRadius=${hitRadius.toFixed(1)}, displayScale=${displayScale.toFixed(2)}`);

    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);

        console.log(`  point[${i}]=(${point.x.toFixed(0)},${point.y.toFixed(0)}) distance=${distance.toFixed(1)} ${distance < hitRadius ? 'HIT' : 'miss'}`);

        if (distance < hitRadius) {
            if (mode === 'delete') {
                console.log(`  -> DELETING point[${i}]`);
                points.splice(i, 1);
                selectedPointIndex = -1;
                updatePointCount();
                drawPoints();
                return;
            } else if (mode === 'move') {
                selectedPointIndex = i;
                isDragging = true;
                updateZoomPreview(point.x, point.y);
                drawPoints();
                return;
            }
        }
    }
    
    if (mode === 'add') {
        points.push({ x, y });
        selectedPointIndex = points.length - 1;
        updatePointCount();
        drawPoints();
    }
}

// Handle mouse move on canvas
function handleCanvasMouseMove(event) {
    if (!image) return;

    const coords = getCanvasCoordinates(event);

    // Always show zoom preview at cursor position
    updateZoomPreview(coords.x, coords.y);

    // Handle dragging in move mode
    if (mode === 'move' && isDragging && selectedPointIndex >= 0) {
        const x = Math.max(0, Math.min(sourceCanvas.width, coords.x));
        const y = Math.max(0, Math.min(sourceCanvas.height, coords.y));

        points[selectedPointIndex].x = x;
        points[selectedPointIndex].y = y;

        drawPoints();
    }
}

// Handle mouse up on canvas
function handleCanvasMouseUp() {
    isDragging = false;
}

// Corner zoom drag handlers
function handleCornerZoomMouseDown(event, cornerKey) {
    if (!image) return;
    const entry = currentCornerAssignment[cornerKey];
    if (!entry) return;

    event.preventDefault();
    cornerDragState = {
        cornerKey,
        pointRef: entry.point,
        pointIndex: entry.index,
        initPointX: entry.point.x,
        initPointY: entry.point.y,
        initMouseX: event.clientX,
        initMouseY: event.clientY,
    };
    selectedPointIndex = entry.index;
    isDragging = true;
    event.target.style.cursor = 'grabbing';
    drawPoints();
}

function handleCornerZoomMouseMove(event) {
    if (!cornerDragState) return;

    // Use absolute mouse delta from drag start to avoid feedback loop
    // (the zoom re-centers on the point each frame, so zoom-relative coords drift)
    // The zoom box CSS size maps to regionSize canvas pixels.
    // 1 mouse pixel in zoom box = regionSize / cssSize canvas pixels.
    const canvas = cornerZoomCanvases[cornerDragState.cornerKey];
    const rect = canvas.getBoundingClientRect();
    const cssSize = rect.width; // actual CSS pixel size of the zoom box
    const regionSize = CORNER_ZOOM_SIZE * displayScale / ZOOM_FACTOR;
    const scale = regionSize / cssSize;
    const canvasX = cornerDragState.initPointX + (event.clientX - cornerDragState.initMouseX) * scale;
    const canvasY = cornerDragState.initPointY + (event.clientY - cornerDragState.initMouseY) * scale;

    // Clamp to canvas bounds
    cornerDragState.pointRef.x = Math.max(0, Math.min(sourceCanvas.width, canvasX));
    cornerDragState.pointRef.y = Math.max(0, Math.min(sourceCanvas.height, canvasY));

    drawPoints();
}

function handleCornerZoomMouseUp() {
    if (cornerDragState) {
        const canvas = cornerZoomCanvases[cornerDragState.cornerKey];
        canvas.style.cursor = 'grab';
        cornerDragState = null;
    }
    isDragging = false;
}

// Update point counter display
function updatePointCount() {
    pointCount.textContent = points.length;
    transformBtn.disabled = points.length < 4;
}

// Zoom preview functions
function updateZoomPreview(pointX, pointY) {
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

    // Crosshair overlay at center — dark outline + white line for contrast
    // Arms are 3x the selection crosshair size (12px base arm half-length)
    const center = ZOOM_CANVAS_SIZE / 2;
    const armLength = 36;

    // Dark outline pass
    zoomCtx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    zoomCtx.lineWidth = 3;

    zoomCtx.beginPath();
    zoomCtx.moveTo(center - armLength, center);
    zoomCtx.lineTo(center + armLength, center);
    zoomCtx.stroke();

    zoomCtx.beginPath();
    zoomCtx.moveTo(center, center - armLength);
    zoomCtx.lineTo(center, center + armLength);
    zoomCtx.stroke();

    // White line pass
    zoomCtx.strokeStyle = '#ffffff';
    zoomCtx.lineWidth = 1.5;

    zoomCtx.beginPath();
    zoomCtx.moveTo(center - armLength, center);
    zoomCtx.lineTo(center + armLength, center);
    zoomCtx.stroke();

    zoomCtx.beginPath();
    zoomCtx.moveTo(center, center - armLength);
    zoomCtx.lineTo(center, center + armLength);
    zoomCtx.stroke();

    // Center dot
    zoomCtx.beginPath();
    zoomCtx.arc(center, center, 3, 0, Math.PI * 2);
    zoomCtx.fillStyle = '#ff6b6b';
    zoomCtx.fill();
}

function hideZoomPreview() {
    zoomCanvas.style.display = 'none';
}

// Corner zoom box positioning
function positionCornerZooms(offsetX, offsetY, displayWidth, displayHeight) {
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

// Assign points to corners based on spatial proximity
function assignPointsToCorners() {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
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
        assignment[pair.key] = { point: points[pair.index], index: pair.index };
        usedCorners.add(pair.key);
        used.add(pair.index);
    }

    return assignment;
}

// Render zoomed content into a corner zoom canvas
function updateCornerZoom(cornerKey, point) {
    const canvas = cornerZoomCanvases[cornerKey];
    const ctx = cornerZoomCtxs[cornerKey];

    const label = cornerKey.toUpperCase();

    if (!point) {
        ctx.clearRect(0, 0, CORNER_ZOOM_SIZE, CORNER_ZOOM_SIZE);
        canvas.classList.remove('has-point');
        // Draw label on placeholder
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

// Update all corner zoom boxes
function updateAllCornerZooms() {
    if (!image || !sourceCanvas.width) {
        currentCornerAssignment = { tl: null, tr: null, bl: null, br: null };
        for (const key of Object.keys(cornerZoomCanvases)) {
            updateCornerZoom(key, null);
        }
        return;
    }
    currentCornerAssignment = assignPointsToCorners();
    for (const [key, entry] of Object.entries(currentCornerAssignment)) {
        updateCornerZoom(key, entry ? entry.point : null);
    }
}

// Draw points on the canvas - SCALED FOR DISPLAY
function drawPoints() {
    if (!pointsCanvas.width || !pointsCanvas.height) return;
    pointsCtx.clearRect(0, 0, pointsCanvas.width, pointsCanvas.height);

    const lineWidth = 2;
    const scale = 1 / displayScale; // image coords → display coords

    if (points.length > 1) {
        pointsCtx.beginPath();
        pointsCtx.moveTo(points[0].x * scale, points[0].y * scale);
        for (let i = 1; i < points.length; i++) {
            pointsCtx.lineTo(points[i].x * scale, points[i].y * scale);
        }
        pointsCtx.strokeStyle = '#4dabf7';
        pointsCtx.lineWidth = lineWidth;
        pointsCtx.stroke();
    }

    if (points.length >= 3) {
        pointsCtx.beginPath();
        pointsCtx.moveTo(points[points.length - 1].x * scale, points[points.length - 1].y * scale);
        pointsCtx.lineTo(points[0].x * scale, points[0].y * scale);
        pointsCtx.strokeStyle = '#4dabf7';
        pointsCtx.lineWidth = lineWidth;
        pointsCtx.setLineDash([5, 5]);
        pointsCtx.stroke();
        pointsCtx.setLineDash([]);
    }

    for (let i = 0; i < points.length; i++) {
        const px = points[i].x * scale;
        const py = points[i].y * scale;
        const crosshairSize = 12;
        const centerDotRadius = 3;

        pointsCtx.strokeStyle = '#ffffff';
        pointsCtx.lineWidth = lineWidth;

        pointsCtx.beginPath();
        pointsCtx.moveTo(px - crosshairSize, py);
        pointsCtx.lineTo(px + crosshairSize, py);
        pointsCtx.stroke();

        pointsCtx.beginPath();
        pointsCtx.moveTo(px, py - crosshairSize);
        pointsCtx.lineTo(px, py + crosshairSize);
        pointsCtx.stroke();

        pointsCtx.beginPath();
        pointsCtx.arc(px, py, centerDotRadius, 0, Math.PI * 2);
        pointsCtx.fillStyle = (i === selectedPointIndex && isDragging) ? '#ff6b6b' : '#339af0';
        pointsCtx.fill();
    }

    updateAllCornerZooms();
}

// Apply perspective correction
function applyPerspectiveCorrection() {
    if (!image || points.length < 4) {
        statusMessage.textContent = "Please select at least 4 points for perspective correction.";
        statusMessage.className = "status error";
        return;
    }
    
    try {
        const orderedPoints = orderPoints(points);
        
        if (orderedPoints.length === 4) {
            applySimplePerspective(orderedPoints);
        } else {
            applyComplexPerspective(orderedPoints);
        }
        if (printBtn) printBtn.disabled = false;

        // Redraw grid after transformation
        if (typeof window.drawGrid === 'function') {
            window.drawGrid(sourceCanvas, displayScale);
        }

        // In folder-browser mode: save normalized points and auto-save/advance
        if (folderHandle && currentFolderImageIndex >= 0) {
            savedNormalizedPoints = normalizePoints(points, sourceCanvas.width, sourceCanvas.height);
            handleSaveToOut();
        }
    } catch (error) {
        console.error("Perspective correction error:", error);
        statusMessage.textContent = `Error: ${error.message || 'Please try adjusting your points.'}`;
        statusMessage.className = "status error";
    }
}

// Simple 4-point perspective correction
function applySimplePerspective(orderedPoints) {
    transformedImageData = applySimple(orderedPoints, { sourceCtx, pointsCanvas, downloadBtn, statusMessage });
}

// Complex multi-point perspective correction
function applyComplexPerspective(orderedPoints) {
    transformedImageData = applyComplex(orderedPoints, { sourceCtx, pointsCanvas, downloadBtn, statusMessage });
}

// --- Folder Browser Functions ---

async function handleOpenFolder() {
    try {
        const result = await openFolder();
        folderHandle = result.dirHandle;
        folderImages = result.imageFiles;
        folderPath.textContent = `📂 ${folderHandle.name}`;
        renderFolderImageList();
        if (folderImages.length > 0) {
            selectFolderImage(0);
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            statusMessage.textContent = `Error opening folder: ${e.message}`;
            statusMessage.className = 'status error';
        }
    }
}

function renderFolderImageList() {
    folderImageList.innerHTML = '';
    folderImages.forEach((img, i) => {
        const item = document.createElement('div');
        item.className = 'folder-image-item' + (i === currentFolderImageIndex ? ' active' : '');
        item.textContent = img.name;
        item.dataset.index = i;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', i === currentFolderImageIndex ? 'true' : 'false');
        item.addEventListener('click', () => selectFolderImage(i));
        folderImageList.appendChild(item);
    });
}

async function selectFolderImage(index) {
    currentFolderImageIndex = index;
    if (saveToOutBtn) saveToOutBtn.disabled = true;
    renderFolderImageList();

    showLoading();
    const file = await loadImageFile(folderImages[index].handle);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function() {
        // Save pending points before reset clears them
        const pendingPoints = savedNormalizedPoints;
        releaseImageMemory();
        image = img;
        setupCanvas();
        resetAllPoints();
        URL.revokeObjectURL(url);

        // Restore saved points from previous image (scaled to new dimensions)
        if (pendingPoints && pendingPoints.length > 0) {
            savedNormalizedPoints = pendingPoints;
            points = denormalizePoints(pendingPoints, sourceCanvas.width, sourceCanvas.height);
            updatePointCount();
            drawPoints();
        }

        hideLoading();
        statusMessage.textContent = `Loaded ${folderImages[index].name} (${img.naturalWidth}×${img.naturalHeight}px)`;
        statusMessage.className = 'status success';
    };
    img.src = url;
}

async function handleSaveToOut() {
    try {
        const filename = deriveOutputFilename(folderImages[currentFolderImageIndex].name);
        await saveToOut(folderHandle, filename, sourceCanvas);
        statusMessage.textContent = `Saved ${filename} to out/`;
        statusMessage.className = 'status success';
        if (saveToOutBtn) saveToOutBtn.disabled = true;

        // Auto-advance to next image
        const nextIndex = getNextImageIndex(currentFolderImageIndex, folderImages.length);
        await selectFolderImage(nextIndex);
    } catch (e) {
        statusMessage.textContent = `Save failed: ${e.message}`;
        statusMessage.className = 'status error';
    }
}

// Reset all points and restore original image
function resetAllPoints() {
    points = [];
    savedNormalizedPoints = null;
    selectedPointIndex = -1;
    isDragging = false;
    transformedImageData = null;
    hideZoomPreview();

    if (originalImageData) {
        sourceCtx.putImageData(originalImageData, 0, 0);
    } else if (image) {
        const imageWidth = image.naturalWidth || image.width;
        const imageHeight = image.naturalHeight || image.height;
        sourceCtx.drawImage(image, 0, 0, imageWidth, imageHeight);
    }

    pointsCanvas.style.pointerEvents = 'all';
    downloadBtn.disabled = true;
    if (printBtn) printBtn.disabled = true;

    updatePointCount();
    drawPoints();
    
    // Redraw grid after reset
    if (typeof window.drawGrid === 'function') {
        window.drawGrid(sourceCanvas, displayScale);
    }
    
    statusMessage.textContent = "All points reset. Select 4+ points to define perspective correction area.";
    statusMessage.className = "status";
}

// Reposition corner zooms on window resize (preserve points)
window.addEventListener('resize', () => {
    if (!image) return;
    const savedPoints = points.map(p => ({ x: p.x, y: p.y }));
    const savedSelected = selectedPointIndex;
    setupCanvas();
    points = savedPoints;
    selectedPointIndex = savedSelected;
    updatePointCount();
    drawPoints();
});

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);