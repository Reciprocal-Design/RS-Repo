# Protein Hero

An interactive, studio-lit 3D protein for a website hero, built with Next.js, React Three Fiber and three.js.

- **Look:** moody purple studio with a warm key glow. The protein is lit by a real studio HDRI (tinted purple, plus custom softboxes) and has a soft waxy surface: baked ambient occlusion, backlit translucency, sheen, a triplanar micro-texture under a smooth clearcoat. Bloom, depth of field, bokeh motes, film grain and vignette on top.
- **Interaction:** drag to spin freely (with inertia), the model leans gently toward the cursor, and it turns slowly when idle. On touch, horizontal drags spin and vertical swipes still scroll the page.
- **Performance:** meshopt-compressed GLB (~580 KB), rendering pauses when the hero is off screen, resolution drops automatically on slow devices, and `prefers-reduced-motion` is respected.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static site in out/
npm run build:static  # refresh the committed preview (index.html + build/)
```

## Static preview

`index.html` and `build/` in this folder are a prebuilt copy of the page, so it opens straight from the repo dashboard / GitHub Pages with no server or build step. All paths are relative, so it works under any URL. Run `npm run build:static` after changing the code or the look, and commit both.

## Use in another Next.js site

Copy `components/ProteinHero.tsx`, `components/ProteinHero.module.css`, `components/protein-hero/` and `public/models/protein.glb`, install `three @react-three/fiber @react-three/drei @react-three/postprocessing postprocessing`, then:

```tsx
import ProteinHero from "@/components/ProteinHero";

<ProteinHero eyebrow="Your eyebrow" title="Your headline">
  {/* optional: your own buttons */}
</ProteinHero>
```

## Tweak the look

Everything visual lives in `components/protein-hero/config.ts`: surface and glow colours, light positions and intensities, bloom, depth of field, grain, how strongly the model reacts to the cursor, and where it sits in the frame.

## Swap the model

Put a new OBJ in `source/` and run:

```bash
npm run convert -- source/your-model.obj public/models/protein.glb
```

The converter welds the mesh, softens it (Taubin smoothing plus a small outward offset, so ridges round off and pinched crevices fill in), centres and normalises it, bakes ambient occlusion into vertex colours, and compresses it. `SMOOTH_ITERATIONS` and `SURFACE_OFFSET` at the top of `scripts/convert-obj.mjs` control how soft it gets.

## Credits

- `public/hdri/studio.exr`: a [Poly Haven](https://polyhaven.com/hdris) studio HDRI, CC0, via [@pmndrs/assets](https://github.com/pmndrs/assets).
- `public/textures/*-normal.webp`: tileable normal maps from [emmelleppi/normal-maps](https://github.com/emmelleppi/normal-maps), CC0, via @pmndrs/assets.
