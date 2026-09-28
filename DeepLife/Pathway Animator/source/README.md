# Pathway Animator

Animated cell signalling pathway diagrams (receptor → cytoplasm → transcription factors → DEGs).
Vite + React + TypeScript + Zustand, Canvas 2D.

```sh
npm install
npm run dev     # local dev server
npm test        # geometry stability and connection-rule tests
npm run build   # typecheck, then build into the tool folder (../index.html + ../assets)
```

The built files one level up are what GitHub Pages serves, so rebuild and commit them after changes.

## Layout

- `src/core/` scene model, defaults, seeded RNG, outlines, layout, connections, layer rules, geometry, signal schedule (pure, deterministic)
- `src/render/` display list + Canvas backend; `render(ctx, scene, t)` is the single entry point
- `src/ui/` React app and store

Status: milestone 4 (animation: comets, node pulses, lit edges, timeline). See `milestone-4.png`.
