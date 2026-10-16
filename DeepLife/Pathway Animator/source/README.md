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

## Module tabs

Six tabs across the top, one per client module, each with its own scene. All start from the same seed, so they show
the same pathway; "Use this look and pathway in all tabs" copies the current tab's seed, pathway, cell, style and
animation to the others (each keeps its module settings, pathway count, start delays and cell map). The modules are
a preset scene plus a pure transform of the geometry (`src/core/modules.ts`):

**One tissue map for every cell view.** "Tissue map → Upload SVG tissue map…" (on tabs 1–6 and the journey) takes
one SVG of the tissue and applies it everywhere; click a cell in the thumbnail (or in the preview on tab 5) to
select it. Tabs 1–4 then show only the selected cell, as the single cell (its own shape, fitted to the canvas);
tab 5 shows the map with that cell in the middle, zoomed in until about two cells show beyond it along the
canvas's short side ("Cells shown beyond it"; 0 shows the whole map); tab 6 shows the map twice; the journey
starts on it. The
selected cell runs the scene's own pathways and starts the signal. "Remove the map" goes back to each view's own
cell or generated tissue.

1. **Target ID**: only the receptor and its active DEGs, joined directly; the receptor is ringed as the drug target.
2. **MOA elucidation**: works backwards. The signal starts at a chosen DEG and travels one to three routes (one
   protein per layer) in reverse to the receptor, uncovering them as it goes: the route's edges are drawn as the
   signal passes and each node pops up when it is reached. The rest of the network is dimmed.
3. **Target combination**: several ringed receptors (one per pathway) fire together through their whole
   pathways, the proteins in between included ("Receptor → DEG only" hides them).
4. **Target toxicity**: when the signal reaches a toxic DEG (drawn red), the cell's membrane cross-fades to red,
   and back as the loop closes.
5. **Tissue-level target ID** (indication extension): the same cell at the centre (an exact copy of the single
   cell, scaled by "Centre cell size"), with neighbouring cells generated round it to the canvas edges
   (`src/core/tissue.ts`). Only the centre cell starts on its own; links run outward from it, so its signal relays
   on through the tissue. The tissue follows the centre cell when the seed, shape or canvas changes.
   Target toxicity also shows a large warning badge in the middle of the cell as it turns (size adjustable).
   Target combination spaces its receptors unevenly (spacing variation up to 2) and, with crosstalk on,
   interconnects them: each receptor also reaches a few of the other targets' DEGs.
6. **Cross-tissue communication** (`src/core/crossTissue.ts`): one tissue map, its cells split between two tissues
   by colour. Click cells in the preview to switch them between the membrane colour and the second colour (pink by
   default); by default the right-hand half of the map is in the second colour ("Right half" puts that back,
   "None" clears it). The selected cell starts the signal; it spreads through its tissue and crosses into the other
   where they meet, and the links that cross between the two are drawn heavier. With no map uploaded, the tissue is
   generated (`src/core/organic.ts`): irregular cells packed wall to wall in a wide clump with an uneven edge
   (Voronoi cells of evenly scattered points, corners rounded). "New tissue shapes" re-rolls it.
7. **Body**: organ-level connectivity (`src/core/body.ts`). An anatomical front-view outline drawn like the
   membrane in an X-ray look: a dark core, a wide glow reaching in from a bright rim ("Body glow"), and soft
   highlights along the anatomy (collarbones, chest, ribs, hips, shoulders, knees) that model the form. Organs are
   drawn like nuclei, and the same firing lines spread out from a chosen organ: organ to organ, up the neck, and in
   chains out along each arm and leg to the hands and feet. About 2,600 particles fill the body, each lighting up
   in a wave as the signal reaches the network node nearest it; an optional wireframe mesh (a Delaunay
   triangulation, `src/core/delaunay.ts`) is off by default.
   "Use a body image…" swaps the drawn body for an image of a figure on a plain background (a 3D render, say;
   `src/core/bodyImage.ts`): the figure is found from its pixels and cut out with soft edges, the network is fitted
   to its head and shoulders (then sized and moved with the sliders), and only the nodes and particles that land on
   the figure are kept. The image is saved in the scene JSON and used by the Body and journey tabs.
8. **Cell → tissue → body** (`src/render/journey.ts`): the website's scroll sequence, in five sections of equal
   length: cell, cell → tissue (the camera pulls back from the centre cell as the neighbours fade in),
   tissue (zoomed in just enough that tissue fills the frame, no edge of the cell layer showing; "Tissue zoom"
   goes closer or pulls back), tissue → body (the tissue shrinks into the chosen organ and fades as the body fades in round it),
   body. The tissue is the generated one round the single cell, or an SVG map imported under Cell map: then the
   cell nearest the map's middle is the centre cell, shown alone at the single cell's size to start with (every
   other cell, and the links to them, faded out) and starting the signal. The tissue layer fades out towards its
   edges, so it never ends in a hard cut. Layout: "Mobile · landscape" (1920 × 1080) or "Desktop · portrait"
   (1080 × 1350, for a page with text beside it); on any canvas taller than it is wide, the cell and tissue are
   the landscape composition turned 90° and the body is fitted upright. Export it with Export → PNG sequence (frames `{name}_0001.png` onward, saved into a folder you pick in
   Chrome and Edge, or as one ZIP elsewhere); the panel lists how many frames each section takes.

9. **Virtual → real cell** (`src/render/realCell.ts`, `src/core/discovery.ts`): the selected cell, in five sections
   of equal length: the virtual cell; a real cell video ("Add a real cell video…") fading in under the network as the
   virtual cell's outlines fade out; discovery, on the real cell: new edges grow in and new nodes pop up (inactive
   nodes becoming active, "New nodes per layer", with the edges the pathway would give them; nothing else moves);
   back to the virtual cell; the virtual cell with the new nodes and edges. Size, place and dim the video to line
   the real cell up with the network. The video is held for the session only (never saved in the scene JSON);
   every exported frame waits for the video to reach its exact frame, so PNG sequences and videos are frame-exact.

Scene JSON saves the current tab, including its module settings; a file loads into the current tab and keeps the
tab's module.

## Video export

"Export → Video" renders the animation frame by frame (not a screen recording, so every frame is exact at
any size) and encodes it with the browser's own WebCodecs encoder: MP4 (H.264) or WebM (VP9), ×0.5/×1/×2
the canvas size (up to 4096 px a side), 24–60 fps, 1–20 loops. Frame times are spread exactly across whole
loops, so a looping or continuous scene exports as a seamlessly looping video. Where the browser has no
H.264 encoder (some Firefox and Linux builds), MP4 falls back to WebM. The muxer (Mediabunny) is loaded
only when a video is exported. "Export tabs 1–6" saves the six module tabs as six videos in one go, with the
same settings (each tab at its own canvas size), named `1_…` to `6_…`: into a folder you pick in Chrome and
Edge, or as one ZIP elsewhere. WebM can be saved with a transparent background (VP9 with an alpha channel: it
plays transparent in Chrome, Edge and Firefox; Safari ignores the alpha); MP4 always includes the background.

## Continuous motion

"Animation → Continuous" makes the signal never stop: every event repeats with one period, so the end of
the signal runs on into the start of the next loop and the loop is seamless. The period is the longest one
for which a comet is travelling at every moment; "Density" shortens it so more signals overlap. Each edge
stays lit for "Lit edge hold" after its comet, then fades.

## Cell maps

"Cell map → Import SVG map…" replaces the single cell with a cluster of cells from an SVG (e.g. a Voronoi
map of 18–20 cells). Each membrane and nucleus must be a closed shape (path, polygon, rect, circle or
ellipse; transforms are applied). Shapes are paired by containment: a top-level shape is a membrane and the
largest shape inside it its nucleus; a frame or background holding several cells is ignored, and a cell
without a nucleus gets one. Every cell grows its own network from the shared pathway settings; click a cell
in the preview to add or remove its pathways, Shift-click to re-roll it. "Cell variation" lets node and
layer counts drift from cell to cell, and each cell turns its pathways toward its widest cytoplasm. Cells
start at random offsets ("Start spread"). Links (0–8 per pair of touching cells) keep the signal moving forward:
surface → nucleus → out to the next cell. A link leaves from a DEG (so a cell passes the signal on only once its
own pathway has run), through the far side of the cell (never back across the pathway it has just run), and
arrives at a receptor of the neighbour: the neighbour's own where that faces the sender, otherwise a relay
receptor made on the facing wall. Where the signal has a source (a selected or centre cell, or the side a second
tissue receives it on), the other cells turn their receptors to face it. The "Relay chain" sets how many cells in
a row a signal can pass on; as each step is a whole pathway, long chains make long loops. The map is saved in the scene JSON. Try
`../samples/cell-cluster-voronoi.svg`.

Status: milestone 5 (PNG and SVG export, scene JSON save/load), plus cell maps. See `milestone-5.png`.
