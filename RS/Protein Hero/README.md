# Protein Hero

An interactive, studio-lit 3D protein for a website hero, built with Next.js, React Three Fiber and three.js.

- **Look:** a diseased protein in a cool slate-blue studio. The blue-grey surface is soft and velvety: subsurface scattering (per-channel wrapped diffuse, so light bleeds softly past the shadow line), backlight translucency through thin ridges, baked ambient occlusion that falls toward the scatter colour instead of black, a fine triplanar grain, low specular with a sheen. Lit by a studio HDRI plus softboxes. The environment has drifting debris fragments, fine dust, bokeh motes and depth haze, with bloom, depth of field, film grain and vignette on top.
- **Signalling:** three strands run from the top left to the bottom right. They merge as they meet the protein, pass through it, and split again after exiting, with glowing pulses travelling along them. A frosted-glass ON/OFF switch sits on the protein's upper right and follows it on screen. ON shows active signalling; OFF fades the pulses out. It is a real, keyboard-accessible toggle (`role="switch"`). Strand shape is in `components/protein-hero/SignalLines.tsx`; colours, thickness, pulse speed and the switch anchor are in `config.ts`.
- **Two looks:** ON is the dark, diseased, signalling scene. Switching OFF eases the whole scene to a light blue protein in a light environment (backdrop, haze, environment lighting, debris, dust, bloom and vignette all blend over), the signalling lines fade away completely, and the copy turns dark navy. The OFF palette lives in `HERO.off` in `config.ts`; `components/protein-hero/theme.ts` does the blending.
- **Interaction:** drag to spin freely (with inertia), the model leans gently toward the cursor, and it turns slowly when idle. On touch, horizontal drags spin and vertical swipes still scroll the page.
- **Performance:** meshopt-compressed GLB (~580 KB), rendering pauses when the hero is off screen, resolution drops automatically on slow devices, and `prefers-reduced-motion` is respected.

## Realism notes

- **Environment:** a real studio HDRI plus softboxes, captured into the environment map. The tint dome is kept well off black, so no reflected direction goes dead.
- **Imperfection and roughness:** baked AO, three triplanar normal layers (broad undulation, detail, very fine grain), albedo mottling and wide roughness variation, so the surface reads as matte and physically rough, never uniform.
- **Soft edges and refraction:** light scatters back out toward the silhouettes (`protein.edgeSoftness`), and partial transmission (`protein.transmission`) lets thin ridges and edges refract what is behind them. Clear droplets drift around the protein and refract the backdrop, lines and far structures. The refraction pass renders at half resolution.
- **Multiple lights:** key, back (translucency), fill, rim, a cool accent from low right and a soft top light, all on top of the HDRI. Two point lights sit where the strands enter and leave the protein and swell as pulses arrive.
- **Signal meets protein:** each pulse's position is mirrored on the CPU (same formula as the line shader) and passed to the protein materials. As a pulse approaches, the surface around it glows as if the light were entering; inside, the glow shows through as it crosses, then fades as it exits. Debris near a strand catches it too. Tune with `lines.surfaceGlow` and `lines.surfaceGlowRadius`.
- **Background depth:** slowly moving cloud-like variation and faint rays in the backdrop, volumetric light shafts, large far structures blended into the haze, then debris, droplets, bokeh and dust at different depths.
- **Light:** everything is linear HDR, tone mapped once near the end of the post chain (ACES), with bloom, grain and vignette. Each signalling strand is a thin opaque core (crisp under depth of field) over a soft additive halo ribbon with a gaussian profile. The glow ramps up where the strands enter and leave the protein, starting inside it. The strands vary in width, brightness and speed.
- **Art-directed, not simulated:** the strand paths, pulses and subsurface scattering are styled approximations, not physical solves. Tune them by eye.
- **Motion:** all pointer response is damped. After a few seconds without input (and always on touch, which never hovers) the protein leans on its own. Reduced motion holds a still pose.
- **Resilience:** rendering pauses off screen and in hidden tabs. Add `?nopause` to the URL to bypass that for automated screenshots. WebGL is probed once; without it the hero shows a flat drawing of the scene and says why.

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
