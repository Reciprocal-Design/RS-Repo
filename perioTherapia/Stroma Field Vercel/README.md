# Stroma Field (Vercel)

The interactive Next.js version of `perioTherapia/Stroma Field`, built to deploy on Vercel.

A neon density map of a tumour section. Each dot is a 20 µm patch of tissue: the core is its main cell type (tumour, fibroblast, macrophage, T cell, vessel), the ring around it is collagen, from loose lime fibres to dense orange cross-linked collagen.

## How it behaves

- **Two-stage timeline (default).** A 15 s sequence. Stage 1, antibody: each ECM ring thins continuously to nothing (about 2 s each, the same way the cancer cells shrink) in waves that close in from the outside toward the tumour. Stage 2, chemotherapy: starts just before stage 1 ends and shrinks the cancer cells into small grey dots, again from the outside in. Play, pause and scrub it in the panel. The Cursor playback mode keeps the interactive version (see below).
- **Stage panel.** Two radial progress rings, Antibody (ECM cleared) and Chemotherapy (tumour cleared), drawn on the map itself so they render into exports. Toggle in the panel or with `?panel=off`.
- **Hero tumour.** Generated tissue puts the main tumour mass in the centre with smaller satellite nests around it. Drawn layouts keep exactly what you draw.

- **Three styles.** Periotherapia (default: the brand palette from Design Approach 3, off-white ground, blue, lavender, mint and yellow cells, charcoal-grey ECM, orange cancer cells), Neon (black ground, saturated colours) and Clinical (light grey ground, muted pinks, periwinkles and graphite fibres). Switch in the panel, or open the page with `?style=brand`, `?style=clinical` or `?style=neon`. The last choice is remembered.
- **Cursor mode** (`?mode=cursor`). The cursor carries the antibody (stage 1); chemotherapy (stage 2) starts once 40% of the ECM is cleared and reaches cancer cells whose rings are open.
- **The cursor carries the antibody.** Moving across the tissue sends out ripples from your path. As each ripple spreads, the collagen rings it crosses come down in a six-petal pattern, breaking into fibre fragments that drift apart and thin out. Dense collagen needs more passes than loose fibres.
- **Edges.** Cropped lets the grid run off the canvas; Bleed shrinks every dot smoothly toward all four edges (most at the corners) and fills the gaps with small background dots, so the matrix tapers away instead of ending abruptly. Switch in the panel or with `?edge=bleed` / `?edge=fade`. Applies to exports too.
- **Background colour.** Pick any ground colour in the panel (Reset returns to the style's own); it is remembered per style, used as the export background, and can be set with `?bg=e4e4e8`.
- **Dot density.** The Dots slider sets how many dots run across the map (48–200, default 120). The tissue keeps the same physical size, so more dots means finer detail. Very high counts are heavy on slower machines. Also settable with `?dots=160`.
- **Drawn layouts.** Draw layout… opens a pad where you sketch the composition with brush, ellipse, rectangle and eraser on two layers: Tissue (where cells grow) and Tumour (where the nests sit; collagen rims form around them). Leave Tumour empty to scatter nests through the tissue. Noise still roughens the edges and textures the inside. Start from a preset (round tumour, ring, two lobes, diagonal band), undo, save the layout as a file and open it again later. The applied layout is remembered in the browser; Back to random returns to generated shapes.
- **Tumour boundary.** A thin outline traces where the tumour started, so its bounds stay visible as it clears.
- **Movement, not hovering.** Holding the cursor still delivers nothing; the amount scales with how far you move. On touch screens, drag.
- **Antibody dose bar** (0–20 mg/kg) sets the ripples: a higher dose sends wider, stronger ripples. At 0 the cursor does nothing.
- **Tumour response.** Cleared cancer cells shrink into small grey dots.
- **Regrowth.** Exposure fades slowly, so a barrier you leave alone grows back. Tumour cells that already died stay cleared until you press Restart.
- Keyboard: focus the map and use the arrow keys to move a virtual cursor. Space pauses, R restarts, N makes new tissue, E opens Export.

## Export

The standard studio export panel: MP4 (H.264), WebM (VP9, optional alpha), PNG sequence (.zip) and single PNG, with size, frame rate, range and quality options. Two clips:

- **Two-stage treatment:** the 15 s timeline, rendered frame by frame (it is a pure function of time, so exports are exact).
- **Current state, looping:** a seamless 6 s loop of the tissue as you left it.

MP4 cannot carry transparency; use WebM with alpha (Chrome or Edge) for the web, or the PNG sequence for After Effects, Premiere, DaVinci or Final Cut. ProRes 4444 from the PNG sequence:

```bash
ffmpeg -framerate 30 -i stroma-field_1920x1080_30fps_%05d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le out.mov
```

## Run

```bash
npm install
npm run dev           # http://localhost:3000
npm run build         # static site in out/
npm run build:static  # refresh the committed preview (index.html + build/)
```

## Deploy to Vercel

1. In Vercel, **Add New → Project** and import `Reciprocal-Design/RS-Repo`.
2. Set **Root Directory** to `perioTherapia/Stroma Field Vercel`. The framework is detected as Next.js; leave the build settings at their defaults.
3. Deploy. The app is a static export (`output: "export"`), so it needs no server functions.

## Static preview

`index.html` and `build/` are a prebuilt copy so the page opens straight from the repo dashboard or GitHub Pages. All paths are relative. Run `npm run build:static` after changing the code, and commit both.

## Files

- `lib/engine.ts`: tissue generation, the cursor-driven treatment model and the canvas renderer (framework-free).
- `lib/exportMedia.ts`: frame-by-frame export with Mediabunny and fflate, loaded on demand.
- `components/StromaField.tsx`: the page, pointer handling and readouts.
- `components/ExportPanel.tsx`: the export dialog.

An abstract illustration of stromal barriers, not a pharmacological model.
