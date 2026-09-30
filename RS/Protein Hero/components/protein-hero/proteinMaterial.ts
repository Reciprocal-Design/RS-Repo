import { Color, MeshPhysicalMaterial, ShaderChunk, Texture, Vector3 } from "three";

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
  detail: DetailLayer;
  macro: DetailLayer;
};

export type ProteinTextures = { detail: Texture; macro: Texture };

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
 *  - triplanar normal maps in object space (the mesh has no UVs): fine grain + broad undulation
 *  - low specular and a sheen instead of a clearcoat, so reflections stay soft
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
  });

  const uniforms = {
    uBackLightDir: backLightDir,
    uScatter: { value: new Color(opts.scatter) },
    uScatterWrap: { value: new Vector3(...opts.scatterWrap) },
    uTranslucency: { value: new Color(opts.translucency) },
    uRim: { value: new Color(opts.rim) },
    uAOPower: { value: opts.aoStrength },
    uDetailMap: { value: textures.detail },
    uMacroMap: { value: textures.macro },
    uDetail: { value: [opts.detail.scale, opts.detail.strength] },
    uMacro: { value: [opts.macro.scale, opts.macro.strength] },
  };

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
        uniform sampler2D uDetailMap, uMacroMap;
        uniform vec2 uDetail, uMacro; // (scale, strength)
        uniform mat3 normalMatrix;
        varying vec3 vObjPos;
        varying vec3 vObjNormal;

        // Triplanar normal mapping with whiteout blending (object space in, object space out).
        vec3 triplanarNormal(sampler2D map, vec3 p, vec3 n, float scale, float strength) {
          vec3 w = pow(abs(n), vec3(4.0));
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
        diffuseColor.rgb *= mix(uScatter * 0.35, vec3(1.0), bakedAO);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 n0 = normalize(vObjNormal);
          vec3 n1 = triplanarNormal(uMacroMap, vObjPos, n0, uMacro.x, uMacro.y);
          vec3 n2 = triplanarNormal(uDetailMap, vObjPos, n1, uDetail.x, uDetail.y);
          normal = normalize(normalMatrix * n2);
        }`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        {
          vec3 N = normal;
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

          // Keep reflections out of the crevices.
          reflectedLight.indirectSpecular *= mix(0.1, 1.0, bakedAO);
          reflectedLight.directSpecular *= mix(0.3, 1.0, bakedAO);
        }`,
      );
  };

  return material;
}
