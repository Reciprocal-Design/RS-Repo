import { Color, MeshPhysicalMaterial, Vector3 } from "three";

export type ProteinMaterialOptions = {
  color: string;
  translucency: string;
  rim: string;
  roughness: number;
  aoStrength: number;
};

/**
 * MeshPhysicalMaterial with a soft, waxy "organic" look:
 *  - baked AO from vertex colours (deepened with a power curve, also applied to reflections)
 *  - cheap subsurface translucency from a back light (light bleeding through thin ridges)
 *  - wrapped diffuse so the terminator stays soft
 *  - fresnel sheen on silhouettes
 *
 * `backLightDir` is shared so the scene can update it (view-space) every frame.
 */
export function createProteinMaterial(opts: ProteinMaterialOptions, backLightDir: { value: Vector3 }) {
  const material = new MeshPhysicalMaterial({
    color: opts.color,
    roughness: opts.roughness,
    metalness: 0,
    vertexColors: true,
    sheen: 0.5,
    sheenRoughness: 0.55,
    sheenColor: new Color(opts.rim),
    clearcoat: 0.18,
    clearcoatRoughness: 0.38,
  });

  const uniforms = {
    uBackLightDir: backLightDir,
    uTranslucency: { value: new Color(opts.translucency) },
    uRim: { value: new Color(opts.rim) },
    uAOPower: { value: opts.aoStrength },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform vec3 uBackLightDir;
        uniform vec3 uTranslucency;
        uniform vec3 uRim;
        uniform float uAOPower;`,
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
