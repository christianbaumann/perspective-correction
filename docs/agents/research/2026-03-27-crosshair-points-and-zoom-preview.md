---
date: "2026-03-27T07:00:42.627929+00:00"
git_commit: 7300d1f7e1ab67e79fa30e13b178731e85764a89
branch: main
topic: "Replacing numbered point markers with crosshairs and adding a zoomed preview"
tags: [research, codebase, points, canvas, crosshair, zoom]
status: complete
---

# Research: Crosshair Points and Zoomed Preview

## Research Question
How are points currently rendered, and what would need to change to:
1. Replace the numbered circle markers with crosshair cursors
2. Add a larger crosshair in the top-center showing a 2.5x zoom of the area around the currently selected/active point

## Summary
Points are rendered entirely in the `drawPoints()` function in `script.js` (lines 325-372). Each point is a filled blue circle with a white border and a centered number label. The canvas architecture uses a three-layer stack, with points drawn on the topmost `pointsCanvas`. There is no existing zoom/magnifier functionality anywhere in the codebase. The CSS already implements a custom cursor (white circle with `mix-blend-mode: difference`) via a `::before` pseudo-element on `.canvas-wrapper`.

## Detailed Findings

### 1. Current Point Rendering — `drawPoints()` (`script.js:325-372`)

The function clears `pointsCanvas`, then draws:

- **Connecting lines** (lines 333-342): Solid blue (`#4dabf7`) lines between consecutive points with `lineWidth = 2 * displayScale`.
- **Closing dashed line** (lines 344-353): A dashed line from the last point back to the first (when 3+ points exist).
- **Point circles** (lines 355-371): For each point:
  - `arc()` with radius `8 * displayScale` — filled blue (`#339af0`), or red (`#ff6b6b`) when being dragged.
  - White stroke border with `lineWidth = 2 * displayScale`.
  - White number label (`i + 1`) centered inside, using `bold ${14 * displayScale}px Arial`.

Key scaling constants used:
| Constant | Base value | Scaled |
|---|---|---|
| `lineWidth` | 2 | `2 * displayScale` |
| `pointRadius` | 8 | `8 * displayScale` |
| `fontSize` | 14 | `14 * displayScale` |

### 2. Canvas Architecture (`index.html:205-209`, `styles.css:180-232`)

Three canvases stacked via `position: absolute` inside `.canvas-wrapper`:

| Canvas | z-index | pointer-events | Purpose |
|---|---|---|---|
| `sourceCanvas` | 1 | none | Displays the image |
| `gridCanvas` | 2 | none | Optional dashed grid overlay |
| `pointsCanvas` | 3 | all | Interactive point layer |

All three canvases are set to the **original image resolution** (`image.naturalWidth x naturalHeight`) and CSS-scaled to fit the container. The scale factor `displayScale = imageWidth / displayWidth` converts between mouse coords and canvas coords (`script.js:186`).

### 3. Existing Custom Cursor (`styles.css:192-212`)

The `.canvas-wrapper` already hides the native cursor (`cursor: none`) and uses a `::before` pseudo-element as a custom cursor:

```css
.canvas-wrapper::before {
    content: '';
    position: fixed;
    left: var(--cursor-x, -100px);
    top: var(--cursor-y, -100px);
    width: 20px;
    height: 20px;
    border: 2px solid white;
    border-radius: 50%;
    pointer-events: none;
    z-index: 9999;
    transform: translate(-50%, -50%);
    mix-blend-mode: difference;
    opacity: 0;
}
```

Position is tracked via `mousemove` on `canvasWrapper` (`script.js:56-63`), setting CSS custom properties `--cursor-x` and `--cursor-y`.

Individual `canvas` elements also declare `cursor: crosshair` (`styles.css:217`), but this is overridden by the wrapper's `cursor: none`.

### 4. Point Interaction / Selection State (`script.js:39-41, 261-316`)

State variables relevant to "which point is active":
- `selectedPointIndex` (line 39): Index of the currently selected point, or `-1` if none.
- `isDragging` (line 41): `true` while a point is being dragged in move mode.
- `mode` (line 40): One of `'add'`, `'move'`, `'delete'`.

**When a point is selected**: `selectedPointIndex` is set during `handleCanvasMouseDown` (line 283 for move mode, line 293 for add mode). It persists until another point is selected or reset.

**Visual feedback for selection**: Only used during drag — the fill color changes to red (`#ff6b6b`) when `i === selectedPointIndex && isDragging` (line 360).

### 5. Hit Detection (`script.js:269-289`)

Hit radius is `15 * displayScale`. The function iterates all points and checks Euclidean distance from the click position.

### 6. No Existing Zoom/Magnifier

There is no zoom, loupe, or magnified preview anywhere in the codebase. The only magnification-related concept is `displayScale` used for coordinate conversion.

## Code References

- `script.js:325-372` — `drawPoints()` function: all point rendering logic
- `script.js:355-371` — Individual point circle + number drawing
- `script.js:329-331` — Scaling constants: `lineWidth`, `pointRadius`, `fontSize`
- `script.js:39-41` — State: `selectedPointIndex`, `mode`, `isDragging`
- `script.js:261-297` — `handleCanvasMouseDown()`: point selection and creation
- `script.js:300-311` — `handleCanvasMouseMove()`: drag handling
- `script.js:56-63` — Cursor position tracking via CSS vars
- `script.js:156-221` — `setupCanvas()`: canvas sizing and `displayScale` calculation
- `styles.css:180-212` — `.canvas-wrapper` styling, custom cursor pseudo-element
- `styles.css:214-232` — Canvas z-index stacking
- `index.html:205-209` — Canvas HTML structure

## Architecture Documentation

### What needs to change for crosshair markers

The `drawPoints()` function (`script.js:325-372`) is the single location where point markers are rendered. The numbered circle drawing (lines 355-371) would be replaced with crosshair drawing logic (two perpendicular lines through the point center). The connecting lines between points (lines 333-353) are independent and would remain unchanged.

### What needs to be built for the zoomed preview

No existing infrastructure exists for this. A new element would need to be created — most likely:
- A new `<canvas>` element positioned at the top-center of `.canvas-wrapper` (or absolutely positioned above the canvas stack)
- It would sample from `sourceCanvas` image data around the active point's coordinates
- Draw that region scaled to 2.5x, with a crosshair overlay at center
- Update on `mousemove` during drag, and on point selection
- The `originalImageData` (`script.js:43`) or direct `sourceCtx.getImageData()` can provide pixel data for the zoom region
- The `pointsCanvas` content around the point could also be composited to show the crosshair in the zoom view

### Data flow for zoom preview

```
selectedPointIndex changes (mousedown/mousemove)
  → read point coords: points[selectedPointIndex].x/y
  → extract region from sourceCanvas: sourceCtx.getImageData(x - r, y - r, 2r, 2r)
  → draw scaled-up onto zoom canvas: zoomCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, dw, dh)
  → draw crosshair overlay on zoom canvas
```

## Open Questions

- Should the crosshair markers on points use the same `mix-blend-mode: difference` as the cursor, or a fixed color scheme?
- Should the zoom preview show for all points or only the actively selected/dragged point?
- Where exactly should the zoom preview be positioned — inside the canvas wrapper (overlaying the image) or outside it (e.g., above the canvas area)?
- Should the zoom preview be visible at all times when points exist, or only during point interaction (add/move)?
