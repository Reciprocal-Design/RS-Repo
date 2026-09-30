"use client";

import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { Suspense, useMemo, useState } from "react";
import { ACESFilmicToneMapping, AgXToneMapping, BackSide, NeutralToneMapping, Vector3 } from "three";
import { Backdrop } from "./Backdrop";
import { HERO } from "./config";
import { Particles } from "./Particles";
import { Echo, Protein } from "./Protein";
import type { PointerState } from "./usePointer";

type SceneProps = {
  pointer: PointerState;
  eventSource: React.RefObject<HTMLElement | null>;
  active: boolean;
  reducedMotion: boolean;
  onReady: () => void;
};

const TONE_MAPPING = { ACES_FILMIC: ACESFilmicToneMapping, AGX: AgXToneMapping, NEUTRAL: NeutralToneMapping };
const keyLight = new Vector3(...HERO.lights.key.position).normalize();

/** Keeps the translucency light direction in view space as the camera/scene changes. */
function BackLightTracker({ dir }: { dir: { value: Vector3 } }) {
  useFrame(({ camera }) => {
    dir.value.copy(keyLight).transformDirection(camera.matrixWorldInverse);
  });
  return null;
}

/** Pulls the camera back on tall screens so the subject always fits the width. */
function Rig() {
  const { camera, size } = useThree();
  const aspect = size.width / size.height;
  const distance = HERO.camera.distance * Math.max(1, 0.85 / aspect);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  return null;
}

function StudioEnvironment() {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={HERO.lights.envIntensity}>
      <mesh scale={50}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial color={HERO.background.deep} side={BackSide} />
      </mesh>
      {/* Warm softbox behind, upper left: matches the glow in the backdrop. */}
      <Lightformer form="rect" color={HERO.background.glow} intensity={5} position={[-5, 4, -4]} scale={[8, 8, 1]} target={[0, 0, 0]} />
      {/* Broad, dim front fill. */}
      <Lightformer form="rect" color="#f4e4ff" intensity={0.9} position={[2, 1.5, 6]} scale={[7, 4, 1]} target={[0, 0, 0]} />
      {/* Violet kicker, low right. */}
      <Lightformer form="ring" color="#8d68dc" intensity={2.2} position={[5, -2, -2]} scale={4} target={[0, 0, 0]} />
      {/* Purple bounce from below. */}
      <Lightformer form="rect" color="#5d3f8f" intensity={1} position={[0, -6, 0]} scale={[12, 12, 1]} target={[0, 0, 0]} />
    </Environment>
  );
}

export default function Scene({ pointer, eventSource, active, reducedMotion, onReady }: SceneProps) {
  const [dpr, setDpr] = useState(1.75);
  const [lowPower, setLowPower] = useState(false);
  const backLightDir = useMemo(() => ({ value: new Vector3() }), []);
  const { lights, post, camera } = HERO;
  const animate = !reducedMotion;

  return (
    <Canvas
      eventSource={eventSource as React.RefObject<HTMLElement>}
      frameloop={active ? "always" : "never"}
      dpr={[1, dpr]}
      camera={{ fov: camera.fov, position: [0, 0, camera.distance], near: 0.1, far: 50 }}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false, depth: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = TONE_MAPPING[post.toneMapping];
        gl.toneMappingExposure = post.exposure;
      }}
      style={{ position: "absolute", inset: 0 }}
    >
      <PerformanceMonitor
        onDecline={() => {
          setDpr(1);
          setLowPower(true);
        }}
        onIncline={() => setDpr(1.75)}
      />
      <Rig />
      <BackLightTracker dir={backLightDir} />

      <Backdrop pointer={pointer} />

      <ambientLight color={lights.ambient.color} intensity={lights.ambient.intensity} />
      <directionalLight color={lights.key.color} intensity={lights.key.intensity} position={lights.key.position} />
      <directionalLight color={lights.fill.color} intensity={lights.fill.intensity} position={lights.fill.position} />
      <directionalLight color={lights.rim.color} intensity={lights.rim.intensity} position={lights.rim.position} />
      <StudioEnvironment />

      <Suspense fallback={null}>
        <Protein pointer={pointer} backLightDir={backLightDir} animate={animate} onReady={onReady} />
        {HERO.echo.enabled && <Echo backLightDir={backLightDir} animate={animate} />}
      </Suspense>
      <Particles animate={animate} />

      <EffectComposer multisampling={lowPower ? 0 : 4} enableNormalPass={false}>
        <DepthOfField
          target={[HERO.layout.wideOffset[0] * 0.5, 0, 0]}
          worldFocusRange={post.dof.focusRange}
          bokehScale={lowPower ? post.dof.bokehScale * 0.6 : post.dof.bokehScale}
        />
        <Bloom
          mipmapBlur
          intensity={post.bloom.intensity}
          luminanceThreshold={post.bloom.threshold}
          luminanceSmoothing={post.bloom.smoothing}
          radius={post.bloom.radius}
        />
        <ToneMapping mode={ToneMappingMode[post.toneMapping]} />
        <Vignette offset={post.vignette.offset} darkness={post.vignette.darkness} />
        <Noise blendFunction={BlendFunction.OVERLAY} opacity={post.grain} />
      </EffectComposer>
    </Canvas>
  );
}
