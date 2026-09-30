"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshPhysicalMaterial,
  ShaderMaterial,
  Vector3,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HERO } from "./config";
import { blendProteinTheme, createProteinMaterial, type ProteinTextures } from "./proteinMaterial";
import { THEME, type ThemeState } from "./theme";

// Deterministic pseudo-random so the layout is identical on every load.
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * Volumetric light shafts falling from the upper left, far behind the subject.
 * Each is a camera-facing strip with a gaussian profile across it, fading in at the source and
 * out before the far end, widening (flaring) with distance. Additive and dim: they overlap into a
 * soft volume of light rather than reading as separate bars. Widths, brightness and angles vary.
 */
export function LightShafts({ theme, animate }: { theme: ThemeState; animate: boolean }) {
  const { count, color, intensity } = HERO.shafts;

  const { geometry, material } = useMemo(() => {
    const r = rng(5);
    const SEG = 24;
    const pos: number[] = [], dir: number[] = [], side: number[] = [], along: number[] = [], seed: number[] = [];
    const index: number[] = [];
    for (let s = 0; s < count; s++) {
      // Stratified angles with jitter, so shafts neither clump nor sit evenly spaced.
      const angle = -0.62 + ((s + 0.2 + r() * 0.6) / count) * 0.5;
      const origin = new Vector3(-5.5 + r() * 2, 4.2 + r() * 1.2, -5 - r() * 4);
      const d = new Vector3(Math.cos(angle), Math.sin(angle), 0.08).normalize();
      const length = 9 + r() * 5;
      const width = 0.25 + r() * 0.55;
      const bright = 0.5 + r() * 0.8;
      const base = pos.length / 3;
      for (let k = 0; k <= SEG; k++) {
        const a = k / SEG;
        const p = origin.clone().addScaledVector(d, a * length);
        for (const sd of [-1, 1]) {
          pos.push(p.x, p.y, p.z);
          dir.push(d.x, d.y, d.z);
          side.push(sd * width * (0.5 + a * 1.6)); // flare: wider further from the source
          along.push(a);
          seed.push(bright, r());
        }
      }
      for (let k = 0; k < SEG; k++) {
        const i = base + k * 2;
        index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("aDir", new BufferAttribute(new Float32Array(dir), 3));
    g.setAttribute("aSide", new BufferAttribute(new Float32Array(side), 1));
    g.setAttribute("aAlong", new BufferAttribute(new Float32Array(along), 1));
    g.setAttribute("aSeed", new BufferAttribute(new Float32Array(seed), 2));
    g.setIndex(index);

    const m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new Color(color) }, uIntensity: { value: intensity } },
      vertexShader: /* glsl */ `
        attribute vec3 aDir;
        attribute float aSide, aAlong;
        attribute vec2 aSeed;
        varying float vAcross, vAlong, vBright, vSeed;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 dv = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz);
          vec3 across = normalize(cross(dv, normalize(-mv.xyz)));
          mv.xyz += across * aSide;
          vAcross = sign(aSide);
          vAlong = aAlong;
          vBright = aSeed.x;
          vSeed = aSeed.y;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uIntensity;
        uniform vec3 uColor;
        varying float vAcross, vAlong, vBright, vSeed;
        void main() {
          // Soft core + broad halo across the shaft.
          float y2 = vAcross * vAcross;
          float profile = exp(-y2 * 5.0) * 0.7 + exp(-y2 * 1.5) * 0.3;
          // Fade in at the source, out well before the far end.
          float ends = smoothstep(0.0, 0.18, vAlong) * (1.0 - smoothstep(0.45, 1.0, vAlong));
          // Slow breathing, different per shaft.
          float breathe = 0.75 + 0.25 * sin(uTime * (0.15 + vSeed * 0.2) + vSeed * 30.0);
          float a = profile * ends * breathe * vBright * uIntensity;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    });
    return { geometry: g, material: m };
  }, [count, color, intensity]);

  useFrame((state) => {
    if (animate) material.uniforms.uTime.value = state.clock.elapsedTime;
    THEME.shafts(material.uniforms.uColor.value, theme.mix);
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-0.5} />;
}

/**
 * Large protein structures far behind the subject, softened by distance haze and depth of field,
 * so the background reads as a space with layers rather than a flat backdrop.
 */
export function FarStructures({
  geometries,
  textures,
  theme,
  backLightDir,
  animate,
}: {
  geometries: BufferGeometry[];
  textures: ProteinTextures;
  theme: ThemeState;
  backLightDir: { value: Vector3 };
  animate: boolean;
}) {
  const material = useMemo(() => {
    const m = createProteinMaterial(
      { ...HERO.protein, color: HERO.far.color, aoStrength: 1, transmission: { ...HERO.protein.transmission, amount: 0 } },
      textures,
      backLightDir,
    );
    // Semi-transparent and not in the depth buffer: they take on whatever backdrop is behind them
    // (bright glow or dark corner) and depth of field treats them as far away, blurring them fully.
    m.transparent = true;
    m.opacity = HERO.far.opacity;
    m.depthWrite = false;
    return m;
  }, [textures, backLightDir]);
  const refs = useRef<(Group | null)[]>([]);

  useFrame((_, dt) => {
    blendProteinTheme(material, theme.mix, THEME.far);
    if (!animate) return;
    refs.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.y += dt * (0.02 + i * 0.012);
      g.rotation.x += dt * 0.008;
    });
  });

  return (
    <>
      {HERO.far.items.map((item, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)} position={item.position} scale={item.scale} rotation={item.rotation}>
          {geometries.map((g, k) => (
            <mesh key={k} geometry={g} material={material} />
          ))}
        </group>
      ))}
    </>
  );
}

/** A slightly irregular sphere, so droplets don't read as perfect CG balls. */
function dropletGeometry(random: () => number) {
  let g: BufferGeometry = new IcosahedronGeometry(1, 5);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const pos = g.attributes.position, p = new Vector3();
  const k = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(2.5);
  const phase = random() * 6;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    p.multiplyScalar(1 + 0.045 * Math.sin(p.dot(k) + phase));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Clear, water-like droplets drifting around the subject. They refract what is behind them
 * (backdrop, lines, debris, far structures) and catch the environment in sharp highlights.
 */
export function Droplets({ animate }: { animate: boolean }) {
  const { items, roughness, ior, thickness } = HERO.droplets;
  const r = useMemo(() => rng(31), []);
  const geometry = useMemo(() => dropletGeometry(r), [r]);
  const material = useMemo(
    () =>
      new MeshPhysicalMaterial({
        color: "#ffffff",
        transmission: 1,
        roughness,
        ior,
        thickness,
        specularIntensity: 1,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        attenuationColor: new Color("#cfe6f5"),
        attenuationDistance: 2.5,
      }),
    [roughness, ior, thickness],
  );
  const refs = useRef<(Mesh | null)[]>([]);

  useFrame((state) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    items.forEach((d, i) => {
      const m = refs.current[i];
      if (!m) return;
      m.position.set(
        d.position[0] + Math.sin(t * 0.13 + i * 1.7) * 0.12,
        d.position[1] + Math.sin(t * 0.19 + i * 2.3) * 0.1,
        d.position[2],
      );
      m.rotation.set(t * 0.05 + i, t * 0.07 + i * 2, 0);
    });
  });

  return (
    <>
      {items.map((d, i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} geometry={geometry} material={material} position={d.position} scale={d.scale} />
      ))}
    </>
  );
}
