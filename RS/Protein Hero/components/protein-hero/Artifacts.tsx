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
  ShaderMaterial,
  Vector3,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HERO } from "./config";
import { createProteinMaterial, type ProteinTextures } from "./proteinMaterial";

// Deterministic pseudo-random so the layout is identical on every load.
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** A lumpy fragment: an icosphere pushed around by a few random waves, with fake AO in the dips. */
function makeFragment(random: () => number) {
  let g: BufferGeometry = new IcosahedronGeometry(1, 4);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const waves = Array.from({ length: 6 }, () => ({
    k: new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize().multiplyScalar(2 + random() * 4),
    phase: random() * Math.PI * 2,
    amp: 0.08 + random() * 0.12,
  }));
  const stretch = new Vector3(0.7 + random() * 0.6, 0.7 + random() * 0.6, 0.7 + random() * 0.6);
  const pos = g.attributes.position;
  const color = new Float32Array(pos.count * 3);
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let d = 0;
    for (const w of waves) d += w.amp * Math.sin(p.dot(w.k) + w.phase);
    p.multiplyScalar(1 + d).multiply(stretch);
    pos.setXYZ(i, p.x, p.y, p.z);
    color[i * 3] = color[i * 3 + 1] = color[i * 3 + 2] = Math.min(1, 0.75 + d * 1.5);
  }
  g.setAttribute("color", new BufferAttribute(color, 3));
  g.computeVertexNormals();
  return g;
}

/** Small drifting, tumbling fragments scattered in depth around the protein. */
export function Debris({
  textures,
  backLightDir,
  animate,
}: {
  textures: ProteinTextures;
  backLightDir: { value: Vector3 };
  animate: boolean;
}) {
  const { count, color } = HERO.debris;
  const material = useMemo(
    () => createProteinMaterial({ ...HERO.protein, color, aoStrength: 1 }, textures, backLightDir),
    [color, textures, backLightDir],
  );

  const pieces = useMemo(() => {
    const r = rng(11);
    const shapes = Array.from({ length: 5 }, () => makeFragment(r));
    const out: {
      geometry: BufferGeometry;
      position: [number, number, number];
      rotation: [number, number, number];
      scale: number;
      spin: [number, number];
      drift: number;
      phase: number;
    }[] = [];
    while (out.length < count) {
      const z = -8 + r() * 9; // mostly behind; a few just in front of the subject
      const spread = 1 + (4.4 - z) * 0.33;
      const x = (r() - 0.5) * spread * 2.4, y = (r() - 0.5) * spread * 1.4;
      if (Math.hypot(x - 0.4, y) < 1.35 && z > -3) continue; // keep the subject clear
      out.push({
        geometry: shapes[out.length % shapes.length],
        position: [x, y, z],
        rotation: [r() * 6, r() * 6, r() * 6],
        scale: 0.04 + r() * r() * 0.12,
        spin: [(r() - 0.5) * 0.3, (r() - 0.5) * 0.3],
        drift: 0.02 + r() * 0.04,
        phase: r() * Math.PI * 2,
      });
    }
    return out;
  }, [count]);

  const refs = useRef<(Group | null)[]>([]);
  useFrame((state, dt) => {
    if (!animate) return;
    const t = state.clock.elapsedTime;
    pieces.forEach((p, i) => {
      const g = refs.current[i];
      if (!g) return;
      g.rotation.x += p.spin[0] * dt;
      g.rotation.y += p.spin[1] * dt;
      g.position.y = p.position[1] + Math.sin(t * p.drift * 6 + p.phase) * 0.12;
      g.position.x = p.position[0] + Math.cos(t * p.drift * 4 + p.phase) * 0.08;
    });
  });

  return (
    <group>
      {pieces.map((p, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)} position={p.position} rotation={p.rotation} scale={p.scale}>
          <mesh geometry={p.geometry} material={material} />
        </group>
      ))}
    </group>
  );
}

/** Fine suspended specks, animated entirely on the GPU. */
export function Dust({ animate }: { animate: boolean }) {
  const { count, color, opacity } = HERO.dust;

  const geometry = useMemo(() => {
    const r = rng(23);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (r() - 0.5) * 12;
      pos[i * 3 + 1] = (r() - 0.5) * 7;
      pos[i * 3 + 2] = -9 + r() * 12;
      seed[i * 2] = r();
      seed[i * 2 + 1] = r();
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new BufferAttribute(seed, 2));
    return g;
  }, [count]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new Color(color) },
          uOpacity: { value: opacity },
          uPixelRatio: { value: 1 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime, uPixelRatio;
          attribute vec2 aSeed;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            // Slow upward drift with a gentle wander; wraps vertically.
            p.y = mod(p.y + uTime * (0.02 + aSeed.x * 0.05) + 3.5, 7.0) - 3.5;
            p.x += sin(uTime * 0.2 + aSeed.y * 40.0) * 0.15;
            p.z += cos(uTime * 0.17 + aSeed.x * 30.0) * 0.1;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (0.8 + aSeed.y * 2.2) * uPixelRatio * (14.0 / -mv.z);
            // Twinkle a little, and fade the nearest specks so they never pop in front of the lens.
            vAlpha = (0.55 + 0.45 * sin(uTime * (0.5 + aSeed.x) + aSeed.y * 20.0)) * smoothstep(0.8, 2.0, -mv.z);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vAlpha * uOpacity;
            gl_FragColor = vec4(uColor * a, a);
          }`,
      }),
    [color, opacity],
  );

  useFrame((state) => {
    if (animate) material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
