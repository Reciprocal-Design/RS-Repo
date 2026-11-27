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

Tabs across the top, one per client module, each with its own scene. All start from the same seed, so they show
the same pathway; "Use this look and pathway in all tabs" copies the current tab's seed, pathway, cell, style and
animation to the others (each keeps its module settings, pathway count, start delays and cell map). The modules are
a preset scene plus a pure transform of the geometry (`src/core/modules.ts`):

**Short loops.** To keep exported videos small, tabs 1–5 run one pulse, one way, from the receptor to the DEGs, at a
slower pace than the plain animator (0.8 s a layer; about 4–5 s a loop for tabs 1–3, about 7.5 s for tabs 4 and 5,
every cell active), the body rests briefly (about 6 s), and tab 8 runs five 2 s sections (10 s). "Relay hops",
"Hold at end" and "Section length" lengthen them.

**Default pathway and map.** Every pathway starts with a receptor, then 4 cytoplasm, 4 cytoplasm, 3 nucleus and 3 DEG
nodes, all active, and every cell of a tissue follows those settings ("Cell variation" under Cell map adds drift). The
app opens on `src/assets/default-tissue-map.svg`; "Remove the map" goes back to the generated cells.

**One tissue map for every cell view.** "Tissue map → Upload SVG tissue map…" (on tabs 1–5 and the journey) takes
one SVG of the tissue and applies it everywhere; click a cell in the thumbnail (or in the preview on tab 4) to
select it. "↺ 90°" / "↻ 90°" and "Rotation" (any angle, −180° to 180°) turn the map in every view, about its
middle; "Reset" puts it back as uploaded. Tabs 1–3 then show only the selected cell, as the single cell (its own shape, fitted to the canvas);
tabs 4 and 5 show the whole map; the journey
starts on it. The
selected cell runs the scene's own pathways and starts the signal. "Remove the map" goes back to each view's own
cell or generated tissue.

1. **Target identification and MOA**: the drug target's receptor is ringed. Every active protein and line of the
   pathway is always on in the gradient, and a pulse runs one way, from the receptor down to the DEGs, then starts
   again. The loop closes seamlessly.
2. **Target combination**: the pathway of tab 1, unchanged, and one more: two ringed receptors, pulsing together. The
   second comes in on the right-hand side of the cell, above the first (the furthest right place with room clear of
   the first, then well up towards the top of the right-hand side; failing that anywhere on the right, then wherever there is most room). It is
   simpler than the first (a cytoplasm row fewer, 3-2-2 proteins, fewer branches and merges, roomy rows) so the two
   crowd each other less, and each of its DEGs talks to the two nearest of the first's orange DEGs, every one of
   those reached. Tabs
   1–3 stay in step: the cell, look, motion and layer settings changed in one change in the others. They start with a
   6.5 px comet and 3.55 px lines.
3. **Target toxicity**: exactly tab 1's pathway. One DEG in the nucleus is larger, red, and radiates rings for the
   whole loop; nothing else on screen is red. The main route into it stands out (at most two inputs per protein on
   it, back to the receptor) and every other line and protein fades back.
4. **Tissue-level target ID** (indication extension): the layout of tab 5 in one colour. The whole tissue map fills the
   canvas, every cell active: all start within a second of each other, their signals crossing between cells along
   the links (an arrival pulses; it does not run the next cell's pathway again), so the loop is about one pathway
   long, like tabs 1–3. With no map, the tissue is generated.
5. **Cross-tissue communication** (`src/core/crossTissue.ts`): one tissue map, its cells split between two tissues
   by colour. Click cells in the preview to switch them between the membrane colour and the second colour (pink by
   default); by default the right-hand half of the map is in the second colour ("Right half" puts that back,
   "None" clears it). Every cell is active, as on tab 4, its signals crossing between cells and into the other
   tissue where they meet; the links that cross between the two are drawn heavier. With no map uploaded, the tissue is
   generated (`src/core/organic.ts`): irregular cells packed wall to wall in a wide clump with an uneven edge
   (Voronoi cells of evenly scattered points, corners rounded). "New tissue shapes" re-rolls it.
6. **Body**: organ-level connectivity (`src/core/body.ts`). An anatomical front-view outline drawn like the
   membrane in an X-ray look: a dark core, a wide glow reaching in from a bright rim ("Body glow"), and soft
   highlights along the anatomy (collarbones, chest, ribs, hips, shoulders, knees) that model the form. Organs have no
   outline: a soft radial wash in the body's purple marks each organ's zone, and the same firing lines spread out from a chosen organ: organ to organ, up the neck, and in
   chains out along each arm and leg to the hands and feet. About 2,600 particles fill the body, each lighting up
   in a wave as the signal reaches the network node nearest it; an optional wireframe mesh (a Delaunay
   triangulation, `src/core/delaunay.ts`) is off by default.
   "Use a body image…" swaps the drawn body for an image of a figure on a plain background (a 3D render, say;
   `src/core/bodyImage.ts`): the figure is found from its pixels and cut out with soft edges, the network is fitted
   to its head and shoulders (then sized and moved with the sliders), and only the nodes and particles that land on
   the figure are kept. The image is saved in the scene JSON and used by the Body and journey tabs.
7. **Cell → tissue → body** (`src/render/journey.ts`): the website's scroll sequence, in five sections of equal
   length: cell, cell → tissue (the camera pulls back from the centre cell as the neighbours fade in),
   tissue ("Tissue zoom" 1× zooms in just enough that tissue fills the frame, no edge of the cell layer showing;
   the default, 0.7×, stands a little further back so more cells show), tissue → body (the whole tissue comes inside a circle, which shrinks to one white dot of the body, on the chosen organ, as the body fades in round it),
   body (its dots fire with no lines between them). The tissue is the generated one round the single cell, or an SVG map imported under Cell map: then the
   cell nearest the map's middle is the centre cell, shown alone at the single cell's size to start with (every
   other cell, and the links to them, faded out) and starting the signal. The tissue layer fades out towards its
   edges, so it never ends in a hard cut. Layout: "Mobile · landscape" (1920 × 1080) or "Desktop · portrait"
   (1080 × 1350, for a page with text beside it); on any canvas taller than it is wide, the cell and tissue are
   the landscape composition turned 90° and the body is fitted upright. Export it with Export → PNG sequence (frames `{name}_0001.png` onward, saved into a folder you pick in
   Chrome and Edge, or as one ZIP elsewhere); the panel lists how many frames each section takes.

8. **Virtual → real cell** (`src/render/realCell.ts`, `src/core/discovery.ts`): the selected cell, in five sections
   of equal length: the virtual cell; a real cell video ("Add a real cell video…") fading in under the network as the
   virtual cell's outlines fade out; discovery, on the real cell: new edges grow in and new nodes pop up (inactive
   nodes becoming active, "New nodes per layer", with the edges the pathway would give them; nothing else moves);
   back to the virtual cell; the virtual cell with the new nodes and edges. Size, place and dim the video to line
   the real cell up with the network. The video is held for the session only (never saved in the scene JSON);
   every exported frame waits for the video to reach its exact frame, so PNG sequences and videos are frame-exact.

**Zoom (tabs 1–3).** Tabs 1–3 start on a square 2000 × 2000 canvas, zoomed out round the centre cell so more of
the cells round it show (tabs 1–3 with "Show neighbouring cells" on). "Zoom" at the top of the module settings
(0.3–1.5; 1 is the cell at its own size) scales the whole view about the centre cell: the cell, its network, line,
node and receptor sizes, and the neighbours round it, together. They start at
0.6. It is saved with each tab; scene files saved before it load at 1.

9. **Tabs in sequence** (`src/core/sequence.ts`, `src/render/sequence.ts`): the tabs you tick (1–5 by default), in
   the order you set, played one after another: each moves on as soon as its pulse reaches the end of the pathway
   (about 27 s and 820 frames at 30 fps for tabs 1–5), the next fading in over it ("Crossfade", 0–5 s; eased).
   "Equal sections" gives every tab the same length instead (fitted to the tab that needs longest, rounded up to
   half a second, or set "Section length"), each running its pulse and holding to the end of its section. Each tab plays as it is set up in its own tab,
   fitted inside this tab's canvas (Landscape, Square or Portrait), with these differences in the sequence only (the
   tabs themselves are unchanged; `module.seqPart`, never saved):
   - every tab's signal runs once: one pulse from the receptor to the DEGs (no return trips), then holds;
   - target combination, from the start of its section, builds its second pathway out from where it meets the first
     (the DEG crosstalk) back to its receptor, a layer at a time, before the pulse;
   - a tissue view that follows a single cell starts framed on that cell exactly as the previous tab showed it, and
     zooms out into the tissue (2 s) before its signal starts, so the transition is seamless.
   The journey and real-cell tabs play as they are. The export panel lists the frames per tab and the frame each
   starts on.

**Neighbouring cells.** In the single-cell views (the plain animator, tabs 1–3 and 8), "Cell membrane → Show
neighbouring cells" draws the cells round the cell behind it, outlines only, without changing the cell's size or
place: the selected cell's real neighbours when a tissue map is uploaded (with the same transform that fits the
cell to the canvas), otherwise a tissue generated round the cell. "Neighbour opacity" sets how see-through they
are, and "Monochrome neighbours" draws them in greys. The same option on the Cell → tissue → body tab shows the
tissue's other cells round the centre cell in the cell section, as see-through (optionally grey) outlines, which
grow to full opacity and colour, their pathways fading in, as the camera pulls back into the tissue.

**Saved settings.** Every tab's settings, and the open tab, are saved in the browser (localStorage) a moment after
each change, so a reload comes back to where you were. "Scene → Reset all settings" goes back to the defaults. A body
image too large for the browser's storage is left out of the saved copy (save a scene JSON to keep it).

Scene JSON saves the current tab, including its module settings; a file loads into the current tab and keeps the
tab's module.

## Video export

"Export → Video" renders the animation frame by frame (not a screen recording, so every frame is exact at
any size) and encodes it with the browser's own WebCodecs encoder: MP4 (H.264) or WebM (VP9), ×0.5/×1/×2
the canvas size (up to 4096 px a side), 24–60 fps, 1–20 loops. Frame times are spread exactly across whole
loops, so a looping or continuous scene exports as a seamlessly looping video. Where the browser has no
H.264 encoder (some Firefox and Linux builds), MP4 falls back to WebM. The muxer (Mediabunny) is loaded
only when a video is exported. "Export tabs 1–5" saves the first five module tabs as five videos in one go, with the
same settings (each tab at its own canvas size), named `1_…` to `5_…`: into a folder you pick in Chrome and
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
a row a signal can pass on; as each step is a whole pathway, long chains make long loops. "↺ 90°", "↻ 90°" and
"Rotation" turn the imported map (cells keep their pathways and seeds). The map, turned, is saved in the scene JSON. Try
`../samples/cell-cluster-voronoi.svg`.

Status: milestone 5 (PNG and SVG export, scene JSON save/load), plus cell maps. See `milestone-5.png`.
