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

// Folder browser DOM elements
const folderBrowserGroup = document.getElementById('folderBrowserGroup');
const openFolderBtn = document.getElementById('openFolderBtn');
const folderImageList = document.getElementById('folderImageList');
const folderPath = document.getElementById('folderPath');
const saveToOutBtn = document.getElementById('saveToOutBtn');

// Canvas contexts
const sourceCtx = sourceCanvas.getContext('2d');
const pointsCtx = pointsCanvas.getContext('2d');

// State variables
let image = null;
let points = [];
let selectedPointIndex = -1;
let mode = 'add';
let isDragging = false;
let transformedImageData = null;
let originalImageData = null;
let displayScale = 1; // Scale factor between display and actual image

// Folder browser state
let folderHandle = null;
let folderImages = [];
let currentFolderImageIndex = -1;

// Point persistence state
let savedNormalizedPoints = null; // Normalized points (0-1) for reuse across folder images

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
    pointsCanvas.addEventListener('mouseleave', handleCanvasMouseUp);
    
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

    const sampleImage = new Image();
    sampleImage.onload = function() {
        image = sampleImage;
        setupCanvas();
        statusMessage.textContent = "Sample image loaded. Select 4+ points to define perspective correction area.";
        statusMessage.className = "status success";
    };
    sampleImage.onerror = function() {
        statusMessage.textContent = "Failed to load sample image. Please upload your own image.";
        statusMessage.className = "status error";
    };

    sampleImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Handle image upload
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            image = img;
            setupCanvas();
            resetAllPoints();
            statusMessage.textContent = `Image loaded (${img.naturalWidth}×${img.naturalHeight}px). Original resolution preserved. Select 4+ points.`;
            statusMessage.className = "status success";
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
    pointsCanvas.width = imageWidth;
    pointsCanvas.height = imageHeight;
    
    // Calculate scale factor between display and actual canvas
    displayScale = imageWidth / displayWidth;
    
    // Store displayScale globally for grid function
    window.currentDisplayScale = displayScale;
    
    // Set CSS display size (visual size in browser)
    sourceCanvas.style.width = displayWidth + 'px';
    sourceCanvas.style.height = displayHeight + 'px';
    pointsCanvas.style.width = displayWidth + 'px';
    pointsCanvas.style.height = displayHeight + 'px';
    
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
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
        
        if (distance < hitRadius) {
            if (mode === 'delete') {
                points.splice(i, 1);
                selectedPointIndex = -1;
                updatePointCount();
                drawPoints();
                return;
            } else if (mode === 'move') {
                selectedPointIndex = i;
                isDragging = true;
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
    if (!image || mode !== 'move' || !isDragging || selectedPointIndex < 0) return;
    
    const coords = getCanvasCoordinates(event);
    const x = Math.max(0, Math.min(sourceCanvas.width, coords.x));
    const y = Math.max(0, Math.min(sourceCanvas.height, coords.y));
    
    points[selectedPointIndex].x = x;
    points[selectedPointIndex].y = y;
    
    drawPoints();
}

// Handle mouse up on canvas
function handleCanvasMouseUp() {
    isDragging = false;
}

// Update point counter display
function updatePointCount() {
    pointCount.textContent = points.length;
    transformBtn.disabled = points.length < 4;
}

// Draw points on the canvas - SCALED FOR DISPLAY
function drawPoints() {
    pointsCtx.clearRect(0, 0, pointsCanvas.width, pointsCanvas.height);
    
    // Scale line width and point size for display
    const lineWidth = 2 * displayScale;
    const pointRadius = 8 * displayScale;
    const fontSize = 14 * displayScale;
    
    if (points.length > 1) {
        pointsCtx.beginPath();
        pointsCtx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            pointsCtx.lineTo(points[i].x, points[i].y);
        }
        pointsCtx.strokeStyle = '#4dabf7';
        pointsCtx.lineWidth = lineWidth;
        pointsCtx.stroke();
    }
    
    if (points.length >= 3) {
        pointsCtx.beginPath();
        pointsCtx.moveTo(points[points.length - 1].x, points[points.length - 1].y);
        pointsCtx.lineTo(points[0].x, points[0].y);
        pointsCtx.strokeStyle = '#4dabf7';
        pointsCtx.lineWidth = lineWidth;
        pointsCtx.setLineDash([5 * displayScale, 5 * displayScale]);
        pointsCtx.stroke();
        pointsCtx.setLineDash([]);
    }
    
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        
        pointsCtx.beginPath();
        pointsCtx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
        pointsCtx.fillStyle = (i === selectedPointIndex && isDragging) ? '#ff6b6b' : '#339af0';
        pointsCtx.fill();
        pointsCtx.strokeStyle = '#ffffff';
        pointsCtx.lineWidth = lineWidth;
        pointsCtx.stroke();
        
        pointsCtx.fillStyle = '#ffffff';
        pointsCtx.font = `bold ${fontSize}px Arial`;
        pointsCtx.textAlign = 'center';
        pointsCtx.textBaseline = 'middle';
        pointsCtx.fillText(i + 1, point.x, point.y);
    }
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

    const file = await loadImageFile(folderImages[index].handle);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function() {
        // Save pending points before reset clears them
        const pendingPoints = savedNormalizedPoints;
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

// Initialize on page load
window.addEventListener('DOMContentLoaded', init);