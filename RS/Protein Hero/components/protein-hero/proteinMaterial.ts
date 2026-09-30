import { Color, MeshPhysicalMaterial, Texture, Vector3 } from "three";

type DetailLayer = { scale: number; strength: number };

export type ProteinMaterialOptions = {
  color: string;
  translucency: string;
  rim: string;
  roughness: number;
  aoStrength: number;
  clearcoat: number;
  detail: DetailLayer;
  macro: DetailLayer;
};

export type ProteinTextures = { detail: Texture; macro: Texture };

/**
 * MeshPhysicalMaterial with a soft, waxy "organic" look:
 *  - triplanar normal maps in object space (the mesh has no UVs): fine pores + broad undulation,
 *    under a smooth clearcoat so highlights stay glossy
 *  - baked AO from vertex colours (deepened with a power curve, also applied to reflections)
 *  - cheap subsurface translucency from a back light (light bleeding through thin ridges)
 *  - wrapped diffuse so the terminator stays soft
 *  - fresnel sheen on silhouettes
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
    vertexColors: true,
    sheen: 0.5,
    sheenRoughness: 0.55,
    sheenColor: new Color(opts.rim),
    clearcoat: opts.clearcoat,
    clearcoatRoughness: 0.3,
  });

  const uniforms = {
    uBackLightDir: backLightDir,
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
      // Baked AO lives in vColor; curve it rather than multiplying it in raw.
      .replace(
        "#include <color_fragment>",
        /* glsl */ `float bakedAO = pow(clamp(vColor.r, 0.0, 1.0), uAOPower);
        diffuseColor.rgb *= bakedAO;`,
      )
      .replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
        {
          vec3 N = normal;
          vec3 V = geometryViewDir;
          vec3 L = normalize(uBackLightDir);
          float cavity = mix(0.25, 1.0, bakedAO);

          // Light travelling through the surface toward the viewer.
          vec3 H = normalize(L + N * 0.45);
          float through = pow(saturate(dot(V, -H)), 2.5);
          // Wrapped lambert keeps the shadow side from going dead.
          float wrap = saturate((dot(N, L) + 0.55) / 1.55);
          reflectedLight.directDiffuse += uTranslucency * (through * 1.6 + wrap * 0.22) * cavity;

          // Silhouette sheen.
          float fresnel = pow(1.0 - saturate(dot(N, V)), 3.0);
          reflectedLight.indirectDiffuse += uRim * fresnel * 0.35 * bakedAO;

          // Keep reflections out of the crevices.
          reflectedLight.indirectSpecular *= mix(0.15, 1.0, bakedAO);
          reflectedLight.directSpecular *= mix(0.4, 1.0, bakedAO);
        }`,
      );
  };

  return material;
}
