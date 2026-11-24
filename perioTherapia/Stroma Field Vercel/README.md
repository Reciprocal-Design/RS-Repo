# Stroma Field (Vercel)

The interactive Next.js version of `perioTherapia/Stroma Field`, built to deploy on Vercel.

A neon density map of a tumour section. Each dot is a 20 µm patch of tissue: the core is its main cell type (tumour, fibroblast, macrophage, T cell, vessel), the ring around it is collagen, from loose lime fibres to dense orange cross-linked collagen.

## How it behaves

- **Two styles.** Neon (black ground, saturated colours) and Clinical (light grey ground, muted pinks, periwinkles and graphite fibres). Switch in the panel, or open the page with `?style=clinical` or `?style=neon`. The last choice is remembered.
- **The cursor carries the antibody.** Moving across the tissue sends out ripples from your path. As each ripple spreads, the collagen rings it crosses come down in a six-petal pattern, breaking into fibre fragments that drift apart and thin out. Dense collagen needs more passes than loose fibres.
- **Edges.** Fade keeps the tissue floating on the background; Bleed fills every empty spot with a small background dot so the grid runs to all four edges of the canvas. Switch in the panel or with `?edge=bleed` / `?edge=fade`. Applies to exports too.
- **Tumour boundary.** A thin outline traces where the tumour started, so its bounds stay visible as it clears.
- **Movement, not hovering.** Holding the cursor still delivers nothing; the amount scales with how far you move. On touch screens, drag.
- **Antibody dose bar** (0–20 mg/kg) sets the ripples: a higher dose sends wider, stronger ripples. At 0 the cursor does nothing.
- **Tumour response.** Once a tumour cell's ring is open, the drug reaches it: it dies back over a few seconds, and about half are replaced by T cells (cyan).
- **Regrowth.** Exposure fades slowly, so a barrier you leave alone grows back. Tumour cells that already died stay cleared until you press Restart.
- Keyboard: focus the map and use the arrow keys to move a virtual cursor. Space pauses, R restarts, N makes new tissue, E opens Export.

## Export

The standard studio export panel: MP4 (H.264), WebM (VP9, optional alpha), PNG sequence (.zip) and single PNG, with size, frame rate, range and quality options. Two clips:

- **Cursor sweep:** 15 s from untouched tissue, a scripted cursor path clears it at the current dose. Replayed frame by frame, so exports are exact.
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
