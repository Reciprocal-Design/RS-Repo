"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, MeshBasicMaterial, Object3D } from "three";
import { HERO } from "./config";

// Deterministic pseudo-random so the layout is identical on every load.
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Small bright motes scattered in depth; depth of field turns them into soft bokeh. */
export function Particles({ animate }: { animate: boolean }) {
  const { count, color, intensity } = HERO.particles;
  const ref = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const material = useMemo(
    () => new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), toneMapped: false }),
    [color, intensity],
  );

  const motes = useMemo(() => {
    const r = rng(7);
    const out: { x: number; y: number; z: number; s: number; speed: number; phase: number }[] = [];
    while (out.length < count) {
      // Either well behind or well in front of the subject, so depth of field always softens them.
      const z = r() < 0.7 ? -7 + r() * 5 : 1.6 + r() * 1.2;
      const spread = 1 + (4.4 - z) * 0.35;
      const x = (r() - 0.5) * spread * 2.2, y = (r() - 0.5) * spread * 1.3;
      if (Math.hypot(x, y) < 1.1 && z > -3) continue; // keep the subject clear
      out.push({ x, y, z, s: 0.02 + r() * 0.035, speed: 0.03 + r() * 0.05, phase: r() * Math.PI * 2 });
    }
    return out;
  }, [count]);

  const place = (t: number) => {
    const mesh = ref.current;
    if (!mesh) return;
    motes.forEach((m, i) => {
      const y = ((m.y + t * m.speed + 2.75) % 5.5) - 2.75;
      dummy.position.set(m.x + Math.sin(t * 0.3 + m.phase) * 0.12, y, m.z);
      dummy.scale.setScalar(m.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => place(0));
  useFrame((state) => animate && place(state.clock.elapsedTime));

  return (
    <instancedMesh ref={ref} args={[undefined, material, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 12, 12]} />
    </instancedMesh>
  );
}
