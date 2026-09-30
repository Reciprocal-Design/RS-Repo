"use client";

import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Group, MathUtils, Mesh, NoColorSpace, Quaternion, RepeatWrapping, Vector3 } from "three";
import { HERO } from "./config";
import { blendProteinTheme, createProteinMaterial } from "./proteinMaterial";
import type { ThemeState } from "./theme";
import type { PointerState } from "./usePointer";

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const q = new Quaternion();

export function useProteinGeometries(url: string = HERO.modelUrl) {
  const gltf = useGLTF(url, false, true);
  return useMemo(() => {
    const list: BufferGeometry[] = [];
    gltf.scene.traverse((o) => (o as Mesh).isMesh && list.push((o as Mesh).geometry));
    return list;
  }, [gltf]);
}

/** Where the protein sits in the frame: right of centre on wide screens, raised on narrow ones. */
export function useSubjectOffset() {
  const aspect = useThree((s) => s.size.width / s.size.height);
  return aspect > 1.15 ? HERO.layout.wideOffset : HERO.layout.narrowOffset;
}

export function useSurfaceTextures() {
  const [detail, macro, grunge] = useTexture([HERO.surfaceNormalUrl, HERO.macroNormalUrl, HERO.surfaceGrungeUrl]);
  return useMemo(() => {
    for (const t of [detail, macro, grunge]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.colorSpace = NoColorSpace; // data maps (normals, grunge), not colour
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    return { detail, macro, grunge };
  }, [detail, macro, grunge]);
}

type Props = {
  pointer: PointerState;
  theme: ThemeState;
  backLightDir: { value: Vector3 };
  animate: boolean;
  onReady?: () => void;
};

/** The hero subject: free drag-to-spin with inertia, a gentle lean toward the cursor, and a slow idle turn. */
export function Protein({ pointer, theme, backLightDir, animate, onReady }: Props) {
  const geometries = useProteinGeometries(HERO.modelUrl);
  const textures = useSurfaceTextures();
  const material = useMemo(() => createProteinMaterial(HERO.protein, textures, backLightDir), [textures, backLightDir]);
  const lean = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const velocity = useRef({ x: 0, y: 0 });
  const intro = useRef(animate ? 0 : 1);
  const idle = useRef(0);
  const [ox, oy] = useSubjectOffset();

  useEffect(() => onReady?.(), [onReady]);

  useFrame((_, dt) => {
    if (!lean.current || !spin.current) return;
    blendProteinTheme(material, theme.mix);
    const { tilt, parallax, dragSpeed, inertia, autoRotate } = HERO.interaction;
    dt = Math.min(dt, 1 / 20);

    // With no input for a few seconds (and always on touch, which never hovers), hand the lean
    // over to a slow autonomous wander, blended in and out so it never snaps.
    const now = performance.now();
    const { idleAfter, idleLean } = HERO.interaction;
    const isIdle = animate && !pointer.dragging && now - pointer.lastInput > idleAfter * 1000;
    idle.current = MathUtils.damp(idle.current, isIdle ? 1 : 0, isIdle ? 0.6 : 4, dt);
    const t = now / 1000;
    const wanderX = Math.sin(t * 0.21) * idleLean[0] + Math.sin(t * 0.47 + 1.3) * idleLean[0] * 0.3;
    const wanderY = Math.sin(t * 0.17 + 2.1) * idleLean[1];
    const targetX = MathUtils.lerp(pointer.x, wanderX, idle.current);
    const targetY = MathUtils.lerp(pointer.y, wanderY, idle.current);

    // Ease the cursor (shared with the backdrop and the switch).
    pointer.smoothX = MathUtils.damp(pointer.smoothX, targetX, 3, dt);
    pointer.smoothY = MathUtils.damp(pointer.smoothY, targetY, 3, dt);

    // Drag → angular velocity; release → inertia decays back to the idle turn.
    const v = velocity.current;
    if (pointer.dragging) {
      v.x = (pointer.dragDX * dragSpeed) / dt;
      v.y = (pointer.dragDY * dragSpeed) / dt;
    } else {
      const k = Math.exp(-inertia * dt);
      v.x = v.x * k + (animate ? autoRotate : 0) * (1 - k);
      v.y *= k;
    }
    pointer.dragDX = pointer.dragDY = 0;
    // Rotate about screen axes so dragging always feels direct, in any orientation.
    spin.current.quaternion.premultiply(q.setFromAxisAngle(Y, v.x * dt));
    spin.current.quaternion.premultiply(q.setFromAxisAngle(X, v.y * dt));

    // Lean and drift toward the cursor.
    lean.current.rotation.x = -pointer.smoothY * tilt[0];
    lean.current.rotation.y = pointer.smoothX * tilt[1];
    lean.current.position.x = ox + pointer.smoothX * parallax;
    lean.current.position.y = oy + pointer.smoothY * parallax;

    // Intro: grow in with an ease-out, then a slow breathing float.
    intro.current = Math.min(1, intro.current + dt / 2.2);
    const e = 1 - Math.pow(1 - intro.current, 3);
    lean.current.scale.setScalar(HERO.protein.scale * (0.86 + 0.14 * e));
    if (animate) lean.current.position.y += Math.sin(t * 0.55) * 0.025;
  });

  return (
    <group ref={lean}>
      <group ref={spin} rotation={[0.35, -0.6, 0.1]}>
        {geometries.map((g, i) => (
          <mesh key={i} geometry={g} material={material} />
        ))}
      </group>
    </group>
  );
}

useGLTF.preload(HERO.modelUrl, false, true);
useTexture.preload([HERO.surfaceNormalUrl, HERO.macroNormalUrl, HERO.surfaceGrungeUrl]);
