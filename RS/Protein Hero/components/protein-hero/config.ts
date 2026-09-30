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

  // Diseased protein: cool, desaturated blue-grey, soft and velvety with light scattering under the surface.
  protein: {
    color: "#72828f", // blue-grey albedo
    scatter: "#6c8ba3", // colour light picks up travelling under the surface
    scatterWrap: [0.55, 0.7, 0.85] as [number, number, number], // how far each channel (r,g,b) bleeds past the shadow line
    translucency: "#9cc0d8", // backlight glowing through thin ridges
    rim: "#c9d8e4", // velvety sheen on silhouettes
    roughness: 0.66,
    specular: 0.35, // 0..1, lower = softer, less mirror-like highlights
    aoStrength: 1.3, // >1 deepens the baked crevice shading
    scale: 0.92,
    // Surface texture: fine grain plus a broad, soft undulation.
    detail: { scale: 11, strength: 0.3 }, // repeats per model radius, bump strength
    macro: { scale: 1.6, strength: 0.25 },
  },

  background: {
    deep: "#10161e", // corners
    mid: "#34424f", // main slate
    haze: "#6f8292", // cool haze, right
    glow: "#b9c7d1", // pale key glow behind the subject's upper left
    glowCenter: [0.46, 0.6] as [number, number], // uv, 0..1
    fog: 0.045, // depth haze density: far debris fades into the backdrop
  },

  lights: {
    // Soft key from the top-front-left, like the reference.
    key: { color: "#eef3f7", intensity: 2, position: [-2.2, 3, 2.6] as [number, number, number] },
    // Behind the subject: drives the translucency through thin ridges.
    back: { color: "#c3d6e6", intensity: 1.6, position: [-3, 2.6, -2.4] as [number, number, number] },
    fill: { color: "#cfdbe6", intensity: 0.7, position: [2.8, 0.4, 3.5] as [number, number, number] },
    rim: { color: "#6f8fae", intensity: 0.9, position: [3.2, -1.8, -1.2] as [number, number, number] },
    ambient: { color: "#4f6072", intensity: 0.3 },
    envIntensity: 0.5,
    hdriRotation: 0.6, // radians; turns the HDRI's softboxes around the subject
    hdriTint: 0.6, // 0 = raw neutral HDRI, 1 = fully the slate studio dome
  },

  // Environment artifacts.
  particles: { count: 22, color: "#8fa4b8", intensity: 1.1 }, // soft bokeh motes
  debris: { count: 11, color: "#4d5a66" }, // small drifting fragments
  dust: { count: 600, color: "#a9b8c6", opacity: 0.8 }, // fine suspended specks

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
