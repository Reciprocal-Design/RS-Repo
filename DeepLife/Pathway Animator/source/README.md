# Pathway Animator

Animated cell signalling pathway diagrams (receptor → cytoplasm → transcription factors → DEGs).
Vite + React + TypeScript + Zustand, Canvas 2D.

```sh
npm install
npm run dev     # local dev server
npm test        # geometry, schedule, export and scene JSON tests
npm run build   # typecheck, then build into the tool folder (../index.html + ../assets)
```

The built files one level up are what GitHub Pages serves, so rebuild and commit them after changes.

## Layout

- `src/core/` scene model, defaults, seeded RNG, outlines, layout, connections, layer rules, geometry, signal schedule, scene JSON (pure, deterministic)
- `src/core/svgImport.ts`, `polygon.ts`, `cellMap.ts` cell map: SVG import and pathways across a cluster of cells
- `src/render/` display list + Canvas and SVG backends; `render(ctx, scene, t)` is the single canvas entry point
- `src/ui/` React app, store and exporters

## Cell maps

"Cell map → Import SVG map…" replaces the single cell with a cluster of cells from an SVG (e.g. a Voronoi
map of 18–20 cells). Each membrane and nucleus must be a closed shape (path, polygon, rect, circle or
ellipse; transforms are applied). Shapes are paired by containment: a top-level shape is a membrane and the
largest shape inside it its nucleus; a frame or background holding several cells is ignored, and a cell
without a nucleus gets one. Every cell grows its own network from the shared pathway settings; click a cell
in the preview to add or remove its pathways, Shift-click to re-roll it. Cells start at random offsets
("Start spread"), and "Cell links" pass signals from one cell into a touching neighbour's receptor. The map
is saved in the scene JSON. Try `../samples/cell-cluster-voronoi.svg`.

Status: milestone 5 (PNG and SVG export, scene JSON save/load), plus cell maps. See `milestone-5.png`.
