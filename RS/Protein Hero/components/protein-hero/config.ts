// All the look-and-feel knobs for the hero in one place.
// Colours are sRGB hex; intensities are in three.js physical units.

const ASSETS = process.env.NEXT_PUBLIC_ASSET_BASE ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const HERO = {
  modelUrl: `${ASSETS}/models/protein.glb`,
  // Studio HDRI (Poly Haven "studio_small_09", CC0), converted to 1k by `npm run hdri`.
  hdriUrl: `${ASSETS}/hdri/studio.hdr`,
  // Broad, soft undulation (CC0, via @pmndrs/assets), projected triplanar since the mesh has no UVs.
  macroNormalUrl: `${ASSETS}/textures/macro-normal.webp`,

  camera: { fov: 30, distance: 4.4 },

  // Where the subject sits. On wide screens it moves right to leave room for the copy.
  layout: {
    wideOffset: [0.42, 0.02] as [number, number],
    narrowOffset: [0, 0.3] as [number, number],
  },

  // Diseased protein: cool, desaturated blue-grey, soft and velvety with light scattering under the surface.
  protein: {
    color: "#637483", // blue-grey albedo
    scatter: "#6c8ba3", // colour light picks up travelling under the surface
    scatterWrap: [0.55, 0.7, 0.85] as [number, number, number], // how far each channel (r,g,b) bleeds past the shadow line
    translucency: "#9cc0d8", // backlight glowing through thin ridges
    rim: "#c9d8e4", // velvety sheen on silhouettes
    roughness: 0.72,
    specular: 0.35, // 0..1, lower = softer, less mirror-like highlights
    aoStrength: 1.3, // >1 deepens the baked crevice shading
    scale: 0.92,
    // A broad, soft undulation so the surface isn't geometrically perfect.
    macro: { scale: 1.6, strength: 0.25 },
    // Imperfection: nothing in nature is uniform.
    mottle: 0.16, // albedo variation across the surface (0..1)
    roughnessVariation: 0.6, // roughness varies by ± this fraction
    edgeSoftness: 0.22, // light scattering back out at the silhouettes (0..1)
    // Partial transmission: refraction through thin ridges and edges (set amount 0 to disable).
    transmission: { amount: 0.12, thickness: 0.9, ior: 1.36, distance: 0.6 },
  },

  background: {
    deep: "#070b10", // corners
    mid: "#18212a", // main dark slate
    haze: "#28343f", // cool haze, right
    glow: "#4a5865", // faint key glow behind the subject
    glowCenter: [0.46, 0.6] as [number, number], // uv, 0..1
    glowStrength: 0.3, // how strongly the glow (and its rays) lift the backdrop: kept low for a dark, even ground
    fog: 0.045, // depth haze density: far debris fades into the backdrop
  },

  lights: {
    // Soft key from the top-front-left, like the reference.
    key: { color: "#eef3f7", intensity: 1.8, position: [-2.2, 3, 2.6] as [number, number, number] },
    // Behind the subject: drives the translucency through thin ridges.
    back: { color: "#c3d6e6", intensity: 1.6, position: [-3, 2.6, -2.4] as [number, number, number] },
    fill: { color: "#cfdbe6", intensity: 0.7, position: [2.8, 0.4, 3.5] as [number, number, number] },
    rim: { color: "#6f8fae", intensity: 0.9, position: [3.2, -1.8, -1.2] as [number, number, number] },
    // Cool accent from low front-right: a second, coloured source so the forms read in more than one light.
    accent: { color: "#7fd3e6", intensity: 0.6, position: [2.6, -2.2, 2.2] as [number, number, number] },
    // Soft overhead: separates the top of the forms from the background.
    top: { color: "#e3ecf4", intensity: 0.5, position: [0.3, 4, 0.5] as [number, number, number] },
    ambient: { color: "#4f6072", intensity: 0.3 },
    envIntensity: 0.3,
    // Euler (x, y, z) in radians. Turns the HDRI so its brightest softbox sits top-front-left,
    // agreeing with the key light (solved from the map's brightest region).
    hdriRotation: [-1.41, -1.47, 0] as [number, number, number],
    // The light rig (HDRI + key, back, rim and accent lights) slowly orbits the subject, so the
    // direction of light keeps changing. Fill, top and ambient stay put so it never goes dark.
    orbitSpeed: 0.12, // radians per second (one turn ≈ 52 s); 0 to hold still
    hdriTint: 0.6, // 0 = raw neutral HDRI, 1 = fully the slate studio dome
    envDome: "#3a4959", // dome tint colour; kept well off black so no reflected direction goes dead
  },

  // Signalling strands: three lines merging through the protein, with travelling glow pulses.
  // Signalling comets: no visible lines, just comets streaking along three paths that merge
  // through the protein, entering on one side and exiting on the other.
  lines: {
    radius: 0.0032, // comet core thickness, in model radii
    haloWidth: 0.013, // half-width of the soft glow around each comet
    pulse: "#cfe8ff", // comet colour
    pulseIntensity: 8, // HDR multiplier; bloom turns this into glow
    speed: 0.09, // laps per second along a path
    cometsPerStrand: 7, // comets travelling each of the three paths
    tail: 0.028, // tail length, as a fraction of the path
    lightIntensity: 2.5, // point lights where the strands enter and leave the protein, lighting its surface
    // As a pulse nears the protein, the surface around it glows, as if the light were entering it;
    // inside, the glow shows through as it travels across, then fades as the pulse exits.
    surfaceGlow: 0.85, // strength of that glow (per comet; there are many)
    surfaceGlowRadius: 0.32, // how far it spreads around the pulse (model radii)
  },

  // The ON/OFF switch sits on the protein's upper right; this is its anchor, relative to the protein centre.
  switchAnchor: [0.62, 0.66, 0.9] as [number, number, number],

  // Background depth.
  shafts: { count: 7, color: "#c9d9e6", intensity: 0.035 }, // volumetric light shafts from the upper left
  far: {
    color: "#4a5a69",
    opacity: 0.35, // blended over the backdrop, so they only just emerge from the haze
    items: [
      { position: [-4.6, 2.2, -17] as [number, number, number], scale: 1.3, rotation: [0.4, 1, 0] as [number, number, number] },
      { position: [5.4, -2, -19] as [number, number, number], scale: 1.6, rotation: [1.2, 2, 0.3] as [number, number, number] },
    ],
  },
  // Clear refracting droplets around the subject.
  droplets: {
    roughness: 0.06,
    ior: 1.33,
    thickness: 0.35,
    items: [
      { position: [-0.95, 0.6, 0.9] as [number, number, number], scale: 0.12 },
      { position: [1.75, -0.25, 0.6] as [number, number, number], scale: 0.1 },
      { position: [-2.1, 0.3, -1.6] as [number, number, number], scale: 0.17 },
      { position: [0.95, -1.05, 1.2] as [number, number, number], scale: 0.07 },
      { position: [2.5, 0.95, -2] as [number, number, number], scale: 0.24 },
      { position: [-0.25, 1.3, 0.6] as [number, number, number], scale: 0.055 },
    ],
  },

  // Environment artifacts.
  particles: { count: 22, color: "#8fa4b8", intensity: 0.75 }, // soft bokeh motes
  debris: { count: 11, color: "#4d5a66" }, // small drifting fragments
  dust: { count: 600, color: "#a9b8c6", opacity: 0.8 }, // fine suspended specks

  // The OFF look: the switch flips the scene to a light blue protein in a light environment,
  // and the signalling lines disappear. Everything above is the ON (dark, diseased) look.
  off: {
    protein: {
      color: "#8fcbea", // light blue
      scatter: "#58b4e0",
      translucency: "#c4ebfb",
      rim: "#eaf8fe",
    },
    debris: "#86b7d3",
    background: {
      deep: "#9dbdd6",
      mid: "#c9e0f0",
      haze: "#e8f5fc",
      glow: "#f6fcff",
    },
    backgroundBoost: 1.2,
    glowStrength: 0.9, // the light look keeps its bright, airy glow // brightens the backdrop past what tone mapping would otherwise allow
    envDome: "#b4d2e7",
    ambient: "#a9cbe2",
    particles: "#ffffff",
    dust: "#ffffff",
    shafts: "#ffffff",
    far: "#b4d1e5",
    bloomIntensity: 0.3, // the bright backdrop needs less bloom
    vignetteDarkness: 0.15,
    transitionSpeed: 1.6, // higher = faster change between looks
  },

  interaction: {
    tilt: [0.18, 0.32] as [number, number], // max radians the model leans toward the cursor (x, y)
    parallax: 0.06, // how far the model drifts toward the cursor
    dragSpeed: 0.006, // radians per pixel dragged
    inertia: 3.2, // higher = spin settles faster after release
    autoRotate: 0.12, // radians per second when idle
    idleAfter: 3, // seconds without input before the model starts leaning on its own (touch never hovers)
    idleLean: [0.55, 0.4] as [number, number], // how far that autonomous lean wanders (x, y), like a cursor
  },

  post: {
    toneMapping: "ACES_FILMIC" as "ACES_FILMIC" | "AGX" | "NEUTRAL",
    exposure: 1.05,
    bloom: { intensity: 0.42, threshold: 0.78, smoothing: 0.35, radius: 0.75 },
    dof: { focusRange: 3.6, bokehScale: 7 },
    vignette: { offset: 0.3, darkness: 0.55 },
    grain: 0.05,
  },
};
