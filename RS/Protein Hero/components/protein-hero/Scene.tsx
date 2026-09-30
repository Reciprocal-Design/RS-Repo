"use client";

import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { BloomEffect, VignetteEffect } from "postprocessing";
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  AmbientLight,
  BackSide,
  Color,
  FogExp2,
  MathUtils,
  MeshBasicMaterial,
  NeutralToneMapping,
  Vector3,
} from "three";
import { Backdrop } from "./Backdrop";
import { HERO } from "./config";
import { Particles } from "./Particles";
import { Debris, Dust } from "./Artifacts";
import { Droplets, FarStructures, LightShafts } from "./Depth";
import { Protein, useProteinGeometries, useSubjectOffset, useSurfaceTextures } from "./Protein";
import { SignalLines } from "./SignalLines";
import { createThemeState, lerp, THEME, type ThemeState } from "./theme";
import type { PointerState } from "./usePointer";

type SceneProps = {
  pointer: PointerState;
  eventSource: React.RefObject<HTMLElement | null>;
  /** Element pinned to the protein on screen (the switch). */
  switchAnchor: React.RefObject<HTMLElement | null>;
  /** Signalling on/off: ON is the dark, signalling look; OFF turns light blue and removes the lines. */
  signalOn: boolean;
  active: boolean;
  reducedMotion: boolean;
  onReady: () => void;
};

const TONE_MAPPING = { ACES_FILMIC: ACESFilmicToneMapping, AGX: AgXToneMapping, NEUTRAL: NeutralToneMapping };
const backLight = new Vector3(...HERO.lights.back.position).normalize();

/** Keeps the translucency light direction in view space as the camera/scene changes. */
function BackLightTracker({ dir }: { dir: { value: Vector3 } }) {
  useFrame(({ camera }) => {
    dir.value.copy(backLight).transformDirection(camera.matrixWorldInverse);
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

/** Eases the theme toward the switch state and blends the scene-wide pieces (fog, ambient, bloom, vignette). */
function ThemeDriver({
  theme,
  instant,
  ambient,
  bloom,
  vignette,
}: {
  theme: ThemeState;
  instant: boolean;
  ambient: React.RefObject<AmbientLight | null>;
  bloom: React.RefObject<BloomEffect | null>;
  vignette: React.RefObject<VignetteEffect | null>;
}) {
  const scene = useThree((s) => s.scene);
  useFrame((_, dt) => {
    theme.mix = instant ? theme.target : MathUtils.damp(theme.mix, theme.target, HERO.off.transitionSpeed, Math.min(dt, 0.25));
    if (Math.abs(theme.mix - theme.target) < 0.001) theme.mix = theme.target;
    const t = theme.mix;
    if (scene.fog instanceof FogExp2) THEME.background.mid(scene.fog.color, t);
    if (ambient.current) THEME.ambient(ambient.current.color, t);
    if (bloom.current) bloom.current.intensity = lerp(HERO.post.bloom.intensity, HERO.off.bloomIntensity, t);
    if (vignette.current) vignette.current.darkness = lerp(HERO.post.vignette.darkness, HERO.off.vignetteDarkness, t);
  });
  return null;
}

/**
 * A real studio HDRI for natural reflections, tinted to match the backdrop and lit with custom softboxes.
 * It renders once, and re-renders every frame only while `live` (during a theme transition).
 */
function StudioEnvironment({ theme, live }: { theme: ThemeState; live: boolean }) {
  const { lights } = HERO;
  const dome = useRef<MeshBasicMaterial>(null);
  // The map renders on mount, before the first frame, so start the dome on the right colour.
  const initial = useMemo(() => THEME.envDome(new Color(), theme.mix), []); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(() => dome.current && THEME.envDome(dome.current.color, theme.mix));
  return (
    <Environment
      files={HERO.hdriUrl}
      resolution={512}
      frames={live ? Infinity : 1}
      environmentIntensity={lights.envIntensity}
      environmentRotation={[0, lights.hdriRotation, 0]}
    >
      {/* Translucent dome over the HDRI: keeps its detail but shifts it into the purple studio. */}
      <mesh scale={50}>
        <sphereGeometry args={[1, 32, 16]} />
        <meshBasicMaterial ref={dome} color={initial} side={BackSide} transparent opacity={lights.hdriTint} depthWrite={false} />
      </mesh>
      {/* Large soft overhead box, top-front-left: broad, diffuse key like the reference. */}
      <Lightformer form="rect" color="#eef3f7" intensity={2.2} position={[-3, 5, 4]} scale={[10, 8, 1]} target={[0, 0, 0]} />
      {/* Pale glow behind, upper left: matches the backdrop. */}
      <Lightformer form="rect" color={HERO.background.glow} intensity={2.5} position={[-5, 4, -4]} scale={[8, 8, 1]} target={[0, 0, 0]} />
      {/* Steel-blue kicker, low right. */}
      <Lightformer form="ring" color="#5f7a90" intensity={1.6} position={[5, -2, -2]} scale={4} target={[0, 0, 0]} />
      {/* Slate bounce from below. */}
      <Lightformer form="rect" color="#2e3a47" intensity={1} position={[0, -6, 0]} scale={[12, 12, 1]} target={[0, 0, 0]} />
    </Environment>
  );
}

/** The strands, following the protein's place in the frame (but not its rotation). */
function Lines({ on, animate }: { on: boolean; animate: boolean }) {
  const [ox, oy] = useSubjectOffset();
  // The camera pulls back on tall screens; thicken the lines to match so they don't alias into dashes.
  const aspect = useThree((s) => s.size.width / s.size.height);
  const thickness = Math.round(Math.max(1, 0.85 / aspect) * 10) / 10;
  return (
    <group position={[ox, oy, 0]} scale={HERO.protein.scale}>
      <SignalLines on={on} animate={animate} thickness={thickness} />
    </group>
  );
}

/** Projects the switch anchor to screen space each frame and moves the DOM element there. */
function SwitchTracker({ target, pointer }: { target: React.RefObject<HTMLElement | null>; pointer: PointerState }) {
  const [ox, oy] = useSubjectOffset();
  const v = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const el = target.current;
    if (!el) return;
    const [ax, ay, az] = HERO.switchAnchor;
    const s = HERO.protein.scale;
    const { parallax } = HERO.interaction;
    v.set(ox + ax * s + pointer.smoothX * parallax, oy + ay * s + pointer.smoothY * parallax, az * s).project(camera);
    // Keep the whole switch on screen, with a 16px margin.
    const hw = el.offsetWidth / 2 + 16, hh = el.offsetHeight / 2 + 16;
    const x = MathUtils.clamp(((v.x + 1) / 2) * size.width, hw, size.width - hw);
    const y = MathUtils.clamp(((1 - v.y) / 2) * size.height, hh, size.height - hh);
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  });
  return null;
}

function Far({ theme, backLightDir, animate }: { theme: ThemeState; backLightDir: { value: Vector3 }; animate: boolean }) {
  const geometries = useProteinGeometries();
  const textures = useSurfaceTextures();
  return <FarStructures geometries={geometries} textures={textures} theme={theme} backLightDir={backLightDir} animate={animate} />;
}

function SurfaceDebris({ theme, backLightDir, animate }: { theme: ThemeState; backLightDir: { value: Vector3 }; animate: boolean }) {
  const textures = useSurfaceTextures();
  return <Debris textures={textures} theme={theme} backLightDir={backLightDir} animate={animate} />;
}

export default function Scene({ pointer, eventSource, switchAnchor, signalOn, active, reducedMotion, onReady }: SceneProps) {
  const [dpr, setDpr] = useState(1.75);
  const [lowPower, setLowPower] = useState(false);
  const backLightDir = useMemo(() => ({ value: new Vector3() }), []);
  const { lights, post, camera } = HERO;
  const animate = !reducedMotion;

  // ON = dark diseased look (mix 0), OFF = light blue look (mix 1).
  const theme = useMemo(() => createThemeState(signalOn), []); // eslint-disable-line react-hooks/exhaustive-deps
  theme.target = signalOn ? 0 : 1;
  const ambient = useRef<AmbientLight>(null);
  const bloom = useRef<BloomEffect>(null);
  const vignette = useRef<VignetteEffect>(null);

  // Re-render the environment map only while the look is changing.
  const [envLive, setEnvLive] = useState(false);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) return void (firstRender.current = false);
    setEnvLive(true);
    const id = setTimeout(() => setEnvLive(false), 4000);
    return () => clearTimeout(id);
  }, [signalOn]);

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
        // Refraction renders the scene again; half resolution is nearly invisible once blurred.
        gl.transmissionResolutionScale = 0.5;
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

      <ThemeDriver theme={theme} instant={reducedMotion} ambient={ambient} bloom={bloom} vignette={vignette} />
      <Backdrop pointer={pointer} theme={theme} />

      <ambientLight ref={ambient} color={signalOn ? lights.ambient.color : HERO.off.ambient} intensity={lights.ambient.intensity} />
      <directionalLight color={lights.key.color} intensity={lights.key.intensity} position={lights.key.position} />
      <directionalLight color={lights.back.color} intensity={lights.back.intensity} position={lights.back.position} />
      <directionalLight color={lights.fill.color} intensity={lights.fill.intensity} position={lights.fill.position} />
      <directionalLight color={lights.rim.color} intensity={lights.rim.intensity} position={lights.rim.position} />
      <directionalLight color={lights.accent.color} intensity={lights.accent.intensity} position={lights.accent.position} />
      <directionalLight color={lights.top.color} intensity={lights.top.intensity} position={lights.top.position} />

      <Suspense fallback={null}>
        <StudioEnvironment theme={theme} live={envLive} />
        <Protein pointer={pointer} theme={theme} backLightDir={backLightDir} animate={animate} onReady={onReady} />
        <SurfaceDebris theme={theme} backLightDir={backLightDir} animate={animate} />
        <Far theme={theme} backLightDir={backLightDir} animate={animate} />
        <Droplets animate={animate} />
      </Suspense>
      <Lines on={signalOn} animate={animate} />
      <SwitchTracker target={switchAnchor} pointer={pointer} />
      <LightShafts theme={theme} animate={animate} />
      <Particles theme={theme} animate={animate} />
      <Dust theme={theme} animate={animate} />
      <fogExp2 attach="fog" args={[HERO.background.mid, HERO.background.fog]} />

      <EffectComposer multisampling={lowPower ? 0 : 4} enableNormalPass={false}>
        <DepthOfField
          target={[HERO.layout.wideOffset[0] * 0.5, 0, 0]}
          worldFocusRange={post.dof.focusRange}
          bokehScale={lowPower ? post.dof.bokehScale * 0.6 : post.dof.bokehScale}
        />
        <Bloom
          ref={bloom}
          mipmapBlur
          intensity={post.bloom.intensity}
          luminanceThreshold={post.bloom.threshold}
          luminanceSmoothing={post.bloom.smoothing}
          radius={post.bloom.radius}
        />
        <ToneMapping mode={ToneMappingMode[post.toneMapping]} />
        <Vignette ref={vignette} offset={post.vignette.offset} darkness={post.vignette.darkness} />
        <Noise blendFunction={BlendFunction.OVERLAY} opacity={post.grain} />
      </EffectComposer>
    </Canvas>
  );
}
