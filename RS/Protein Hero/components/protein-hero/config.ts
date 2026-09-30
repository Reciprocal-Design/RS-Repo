// All the look-and-feel knobs for the hero in one place.
// Colours are sRGB hex; intensities are in three.js physical units.

const ASSETS = process.env.NEXT_PUBLIC_ASSET_BASE ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const HERO = {
  modelUrl: `${ASSETS}/models/protein.glb`,
  // Poly Haven studio HDRI (CC0, via @pmndrs/assets): real softbox reflections on the surface.
  hdriUrl: `${ASSETS}/hdri/studio.exr`,
  // Tileable normal maps (CC0, via @pmndrs/assets), projected triplanar since the mesh has no UVs.
  detailNormalUrl: `${ASSETS}/textures/detail-normal.webp`,
  macroNormalUrl: `${ASSETS}/textures/macro-normal.webp`,

  camera: { fov: 30, distance: 4.4 },

  // Where the subject sits. On wide screens it moves right to leave room for the copy.
  layout: {
    wideOffset: [0.42, 0.02] as [number, number],
    narrowOffset: [0, 0.3] as [number, number],
  },

  protein: {
    color: "#e2917c", // salmon surface
    translucency: "#ff7a4d", // light scattering through thin ridges
    rim: "#ffd7c2", // soft fresnel sheen
    roughness: 0.52,
    aoStrength: 1.6, // >1 deepens the baked crevice shading
    scale: 0.92,
    // Surface texture: fine skin-like pores plus a broad, soft undulation.
    detail: { scale: 7, strength: 0.5 }, // repeats per model radius, bump strength
    macro: { scale: 1.6, strength: 0.25 },
    clearcoat: 0.35, // smooth wet layer over the textured base
  },

  background: {
    deep: "#2e1a47", // corners
    mid: "#74509c", // main purple
    lilac: "#b196d6", // right-hand haze
    glow: "#ffdc8f", // warm key glow, behind the subject's upper left
    glowCenter: [0.46, 0.6] as [number, number], // uv, 0..1
  },

  lights: {
    key: { color: "#ffdcae", intensity: 3.2, position: [-3, 2.6, -2.4] as [number, number, number] },
    fill: { color: "#ffe4f0", intensity: 1.3, position: [2.5, 1.2, 4] as [number, number, number] },
    rim: { color: "#9b78ff", intensity: 1.1, position: [3.2, -1.8, -1.2] as [number, number, number] },
    ambient: { color: "#7a5aa8", intensity: 0.25 },
    envIntensity: 0.55,
    hdriRotation: 0.6, // radians; turns the HDRI's softboxes around the subject
    hdriTint: 0.6, // 0 = raw neutral HDRI, 1 = fully the purple studio dome
  },

  particles: { count: 22, color: "#6f8dff", intensity: 1.6 },

  interaction: {
    tilt: [0.18, 0.32] as [number, number], // max radians the model leans toward the cursor (x, y)
    parallax: 0.06, // how far the model drifts toward the cursor
    dragSpeed: 0.006, // radians per pixel dragged
    inertia: 3.2, // higher = spin settles faster after release
    autoRotate: 0.12, // radians per second when idle
  },

  post: {
    toneMapping: "ACES_FILMIC" as "ACES_FILMIC" | "AGX" | "NEUTRAL",
    exposure: 1.05,
    bloom: { intensity: 0.6, threshold: 0.78, smoothing: 0.35, radius: 0.75 },
    dof: { focusRange: 3.6, bokehScale: 7 },
    vignette: { offset: 0.3, darkness: 0.55 },
    grain: 0.05,
  },
};
