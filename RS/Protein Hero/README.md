# Protein Hero

An interactive, studio-lit 3D protein for a website hero, built with Next.js, React Three Fiber and three.js.

- **Look:** moody purple studio with a warm key glow, soft waxy surface (baked ambient occlusion, backlit translucency, sheen), bloom, depth of field, bokeh motes, film grain and vignette.
- **Interaction:** drag to spin freely (with inertia), the model leans gently toward the cursor, and it turns slowly when idle. On touch, horizontal drags spin and vertical swipes still scroll the page.
- **Performance:** meshopt-compressed GLB (~580 KB), rendering pauses when the hero is off screen, resolution drops automatically on slow devices, and `prefers-reduced-motion` is respected.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # static site in out/
```

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

The converter welds and smooths the mesh, centres and normalises it, bakes ambient occlusion into vertex colours, and compresses it.
