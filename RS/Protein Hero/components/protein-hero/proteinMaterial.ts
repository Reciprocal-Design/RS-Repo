import { Color, MeshPhysicalMaterial, ShaderChunk, Texture, Vector3 } from "three";
import { PULSE_COUNT, SIGNAL } from "./signal";
import { THEME } from "./theme";

type DetailLayer = { scale: number; strength: number };

export type ProteinMaterialOptions = {
  color: string;
  scatter: string;
  scatterWrap: [number, number, number];
  translucency: string;
  rim: string;
  roughness: number;
  specular: number;
  aoStrength: number;
  macro: DetailLayer;
  bumps: { octaves: [number, number][]; shade: number };
  mottle: number;
  roughnessVariation: number;
  edgeSoftness: number; // how much light scatters out at the silhouettes (0..1)
  // Partial transmission: thin ridges and edges let light and the background through, refracted.
  transmission: { amount: number; thickness: number; ior: number; distance: number };
};

export type ProteinTextures = { macro: Texture };

// three's physical direct-diffuse line, swapped for a subsurface version below.
const DIRECT_DIFFUSE = "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );";
const SSS_DIRECT_DIFFUSE = /* glsl */ `{
    // Subsurface scattering (wrapped, per-channel diffuse): light entering the surface travels a
    // little before exiting, so it bleeds past the shadow line, more in the scatter colour.
    float NdotL = dot( geometryNormal, directLight.direction );
    vec3 wrapped = saturate( ( vec3( NdotL ) + uScatterWrap ) / ( 1.0 + uScatterWrap ) );
    // Tint the soft shadow-side falloff with the scatter colour.
    vec3 bleed = mix( uScatter, vec3( 1.0 ), saturate( NdotL * 2.0 ) );
    vec3 sssIrradiance = wrapped * bleed * directLight.color;
    reflectedLight.directDiffuse += sssIrradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  }`;

/**
 * MeshPhysicalMaterial with a soft, velvety "organic" look:
 *  - subsurface scattering approximation: per-channel wrapped diffuse on every light, tinted terminator
 *  - backlight translucency through thin ridges
 *  - baked AO from vertex colours, tinted toward the scatter colour so crevices glow rather than go black
 *  - a triplanar normal map in object space (the mesh has no UVs) for a broad, soft undulation
 *  - procedural 3D relief (simplex noise, three octaves) for lumps, knobs and grain: no texture,
 *    so no seams or streaks, and it moves with the protein
 *  - low specular and a sheen instead of a clearcoat, so reflections stay soft
 *  - partial transmission with volume attenuation: refraction through thin ridges and soft edges
 *  - signalling glow: the surface lights up around approaching pulses (positions from signal.ts)
 *
 * `backLightDir` is shared so the scene can update it (view-space) every frame.
 */
export function createProteinMaterial(
  opts: ProteinMaterialOptions,
  textures: ProteinTextures,
  backLightDir: { value: Vector3 },
) {
  const material = new MeshPhysicalMaterial({
    color: opts.color,
    roughness: opts.roughness,
    metalness: 0,
    specularIntensity: opts.specular,
    vertexColors: true,
    sheen: 0.8,
    sheenRoughness: 0.75,
    sheenColor: new Color(opts.rim),
    transmission: opts.transmission.amount,
    thickness: opts.transmission.thickness,
    ior: opts.transmission.ior,
    attenuationColor: new Color(opts.scatter),
    attenuationDistance: opts.transmission.distance,
  });

  const uniforms = {
    uBackLightDir: backLightDir,
    uScatter: { value: new Color(opts.scatter) },
    uScatterWrap: { value: new Vector3(...opts.scatterWrap) },
    uTranslucency: { value: new Color(opts.translucency) },
    uRim: { value: new Color(opts.rim) },
    uAOPower: { value: opts.aoStrength },
    uMacroMap: { value: textures.macro },
    uMacro: { value: [opts.macro.scale, opts.macro.strength] },
    uMottle: { value: opts.mottle },
    uBumpScale: { value: new Vector3(...opts.bumps.octaves.map((o) => o[0])) },
    uBumpStrength: { value: new Vector3(...opts.bumps.octaves.map((o) => o[1])) },
    uBumpShade: { value: opts.bumps.shade },
    uRoughVar: { value: opts.roughnessVariation },
    uEdgeSoftness: { value: opts.edgeSoftness },
    // Shared with every protein-style material; written by the signal lines each frame.
    uPulses: SIGNAL.pulses,
    uPulseColor: SIGNAL.color,
    uPulseGlow: SIGNAL.glow,
    uPulseRadius: SIGNAL.radius,
  };

  material.userData.uniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    const physicalLights = ShaderChunk.lights_physical_pars_fragment;
    if (!physicalLights.includes(DIRECT_DIFFUSE)) {
      console.warn("proteinMaterial: three.js lighting chunk changed; subsurface diffuse not applied.");
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying vec3 vObjPos;
        varying vec3 vObjNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vObjPos = position;
        vObjNormal = normal;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform vec3 uBackLightDir;
        uniform vec3 uScatter;
        uniform vec3 uScatterWrap;
        uniform vec3 uTranslucency;
        uniform vec3 uRim;
        uniform float uAOPower;
        uniform sampler2D uMacroMap;
        uniform vec2 uMacro; // (scale, strength)
        uniform float uMottle, uRoughVar, uEdgeSoftness, uBumpShade;
        uniform vec3 uBumpScale, uBumpStrength;
        uniform vec4 uPulses[${PULSE_COUNT}];
        uniform vec3 uPulseColor;
        uniform float uPulseGlow, uPulseRadius;
        uniform mat3 normalMatrix;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;

        // 3D simplex noise. From webgl-noise by Ian McEwan / Ashima Arts (MIT License),
        // https://github.com/ashima/webgl-noise
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        float snoise(vec3 v) {
          const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
          const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
          vec3 i = floor(v + dot(v, C.yyy));
          vec3 x0 = v - i + dot(i, C.xxx);
          vec3 g = step(x0.yzx, x0.xyz);
          vec3 l = 1.0 - g;
          vec3 i1 = min(g.xyz, l.zxy);
          vec3 i2 = max(g.xyz, l.zxy);
          vec3 x1 = x0 - i1 + C.xxx;
          vec3 x2 = x0 - i2 + C.yyy;
          vec3 x3 = x0 - D.yyy;
          i = mod289(i);
          vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
          float n_ = 0.142857142857;
          vec3 ns = n_ * D.wyz - D.xzx;
          vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
          vec4 x_ = floor(j * ns.z);
          vec4 y_ = floor(j - 7.0 * x_);
          vec4 x = x_ * ns.x + ns.yyyy;
          vec4 y = y_ * ns.x + ns.yyyy;
          vec4 h = 1.0 - abs(x) - abs(y);
          vec4 b0 = vec4(x.xy, y.xy);
          vec4 b1 = vec4(x.zw, y.zw);
          vec4 s0 = floor(b0) * 2.0 + 1.0;
          vec4 s1 = floor(b1) * 2.0 + 1.0;
          vec4 sh = -step(h, vec4(0.0));
          vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
          vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
          vec3 p0 = vec3(a0.xy, h.x);
          vec3 p1 = vec3(a0.zw, h.y);
          vec3 p2 = vec3(a1.xy, h.z);
          vec3 p3 = vec3(a1.zw, h.w);
          vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
          p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
          vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
          m = m * m;
          return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
        }

        // Procedural relief: height and its object-space gradient, summed over three octaves.
        void reliefAt(vec3 p, out float height, out vec3 grad) {
          height = 0.0;
          grad = vec3(0.0);
          for (int i = 0; i < 3; i++) {
            vec3 q = p * uBumpScale[i] + float(i) * 17.31;
            float h0 = snoise(q);
            const float e = 0.12;
            vec3 g = vec3(snoise(q + vec3(e, 0.0, 0.0)), snoise(q + vec3(0.0, e, 0.0)), snoise(q + vec3(0.0, 0.0, e))) - h0;
            grad += (g / e) * uBumpStrength[i];
            height += h0 * uBumpStrength[i];
          }
        }

        // A signed -1..1 variation signal from a normal map's slope channels, projected triplanar.
        float triplanarVariation(sampler2D map, vec3 p, vec3 n, float scale) {
          vec3 w = pow(abs(n), vec3(6.0)); // tight blend: less smearing where projections overlap
          w /= w.x + w.y + w.z;
          vec2 a = texture2D(map, p.zy * scale).xy, b = texture2D(map, p.xz * scale).xy, c = texture2D(map, p.xy * scale).xy;
          vec2 s = (a * w.x + b * w.y + c * w.z) * 2.0 - 1.0;
          return clamp((s.x + s.y) * 1.4, -1.0, 1.0);
        }

        // Triplanar normal mapping with whiteout blending (object space in, object space out).
        vec3 triplanarNormal(sampler2D map, vec3 p, vec3 n, float scale, float strength) {
          vec3 w = pow(abs(n), vec3(6.0)); // tight blend: less smearing where projections overlap
          w /= w.x + w.y + w.z;
          vec3 tx = texture2D(map, p.zy * scale).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(map, p.xz * scale).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(map, p.xy * scale).xyz * 2.0 - 1.0;
          tx.xy *= strength; ty.xy *= strength; tz.xy *= strength;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
          ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
          tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
        }`,
      )
      .replace("#include <lights_physical_pars_fragment>", physicalLights.replace(DIRECT_DIFFUSE, SSS_DIRECT_DIFFUSE))
      // Baked AO lives in vColor. Curve it, and let crevices fall toward the scatter colour, not black.
      .replace(
        "#include <color_fragment>",
        /* glsl */ `float bakedAO = pow(clamp(vColor.r, 0.0, 1.0), uAOPower);
        diffuseColor.rgb *= mix(uScatter * 0.35, vec3(1.0), bakedAO);
        // Imperfection: broad blotchy albedo variation, and an independent, finer roughness variation.
        vec3 objN = normalize(vObjNormal);
        float mottle = triplanarVariation(uMacroMap, vObjPos + 3.7, objN, 0.9);
        float roughVar = triplanarVariation(uMacroMap, vObjPos * 1.9 - 1.3, objN, 2.3);
        diffuseColor.rgb *= 1.0 + mottle * uMottle;
        // Procedural relief (used again for the normal below): valleys a touch darker.
        float reliefHeight;
        vec3 reliefGrad;
        reliefAt(vObjPos, reliefHeight, reliefGrad);
        diffuseColor.rgb *= 1.0 + clamp(reliefHeight * 4.0, -1.0, 1.0) * uBumpShade;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + roughVar * uRoughVar), 0.05, 1.0);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 n0 = normalize(vObjNormal);
          vec3 n1 = triplanarNormal(uMacroMap, vObjPos, n0, uMacro.x, uMacro.y);
          // Tilt the normal against the relief's slope (the gradient's part along the surface).
          vec3 n2 = normalize(n1 - (reliefGrad - dot(reliefGrad, n1) * n1));
          normal = normalize(normalMatrix * n2);
        }`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        {
          // Shape-level effects use the smooth normal: the fine relief would otherwise read as
          // countless tiny grazing edges and light up as bright veins.
          vec3 N = nonPerturbedNormal;
          vec3 V = geometryViewDir;
          vec3 L = normalize(uBackLightDir);
          float cavity = mix(0.3, 1.0, bakedAO);

          // Backlight travelling through thin parts toward the viewer.
          vec3 H = normalize(L + N * 0.5);
          float through = pow(saturate(dot(V, -H)), 2.0);
          reflectedLight.directDiffuse += uTranslucency * through * 0.9 * cavity;

          // Soft silhouette glow.
          float fresnel = pow(1.0 - saturate(dot(N, V)), 2.5);
          reflectedLight.indirectDiffuse += uRim * fresnel * 0.3 * bakedAO;

          // Softer edges: toward the silhouette, light that entered elsewhere scatters back out,
          // so edges lift toward the scatter colour instead of ending in a hard dark line.
          float edge = pow(1.0 - saturate(dot(N, V)), 1.6);
          reflectedLight.indirectDiffuse += uScatter * edge * uEdgeSoftness * mix(0.4, 1.0, bakedAO);

          // Signalling glow: light from each nearby pulse spreads under the surface around it.
          // Pulses outside approach and brighten it; pulses inside show through as they cross.
          vec3 P = -vViewPosition;
          float pulseGlow = 0.0;
          for (int i = 0; i < ${PULSE_COUNT}; i++) {
            vec3 d = P - uPulses[i].xyz;
            pulseGlow += uPulses[i].w * exp(-dot(d, d) / (uPulseRadius * uPulseRadius));
          }
          vec3 glowTint = mix(uScatter, uPulseColor, 0.5);
          reflectedLight.directDiffuse += glowTint * pulseGlow * uPulseGlow * mix(0.5, 1.0, bakedAO);

          // Keep reflections out of the crevices.
          reflectedLight.indirectSpecular *= mix(0.1, 1.0, bakedAO);
          reflectedLight.directSpecular *= mix(0.3, 1.0, bakedAO);
        }`,
      );
  };

  return material;
}

/** Blends the material between its ON and OFF colours (t = 0 ON, 1 OFF). */
export function blendProteinTheme(material: MeshPhysicalMaterial, t: number, color = THEME.protein.color) {
  const u = material.userData.uniforms;
  color(material.color, t);
  THEME.protein.scatter(u.uScatter.value, t);
  THEME.protein.translucency(u.uTranslucency.value, t);
  THEME.protein.rim(u.uRim.value, t);
  THEME.protein.rim(material.sheenColor, t);
  THEME.protein.scatter(material.attenuationColor, t);
}
