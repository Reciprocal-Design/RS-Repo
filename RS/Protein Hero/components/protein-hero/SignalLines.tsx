"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  MathUtils,
  PointLight,
  Vector4,
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from "three";
import { HERO } from "./config";
import { COMET_OFFSET, COMET_SPEED, COMETS_PER_STRAND, pulseHead, SIGNAL } from "./signal";

/**
 * Signalling comets on three paths running top-left → bottom-right. The paths fan out at the
 * edges of the frame, merge into one bundle where they meet the protein (whose surface hides the
 * merge), and split again after exiting. The paths themselves are invisible: only the comets are
 * drawn, streaking in, passing through and streaking out. Switching "off" fades them away.
 *
 * Each comet is drawn as light:
 *  - a thin core (writes depth only where a comet is, so depth of field keeps it crisp), and
 *  - a soft, additive halo ribbon underneath (a gaussian profile across its width).
 * Both brighten as a comet approaches the protein, so the signal appears to concentrate where it
 * enters and leaves. The paths differ in width, brightness and speed; comets within a path
 * differ slightly in speed and spacing.
 *
 * Coordinates are relative to the protein's centre, in model radii. The shape is art-directed.
 */
function strandCurve(i: number) {
  // i = -1, 0, 1. Spread shrinks to almost nothing near the protein.
  const pts: [number, number, number][] = [
    [-5.2, 3.3 + i * 1.15, -0.35],
    [-3.1, 1.95 + i * 0.62, -0.15],
    [-1.55, 0.78 + i * 0.18, 0],
    [-0.8, 0.36 + i * 0.02, 0],
    [0, 0, 0],
    [0.8, -0.32 + i * 0.02, 0],
    [1.55, -0.64 + i * 0.2, 0],
    [3.1, -1.18 + i * 0.7, 0.05],
    [5.4, -1.55 + i * 1.35, -0.25],
  ];
  return new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), false, "centripetal");
}

// Per-strand variation, so the three don't read as a diagram.
const STRANDS = [
  { i: -1, width: 0.8, brightness: 0.8, speed: 1.12, seed: 0.0 },
  { i: 0, width: 1.25, brightness: 1.15, speed: 0.9, seed: 0.29 },
  { i: 1, width: 0.65, brightness: 0.7, speed: 1.05, seed: 0.61 },
];

const SEGMENTS = 400;

/** A flat strip along the curve; the vertex shader turns it to face the camera. */
function ribbonGeometry(curve: CatmullRomCurve3) {
  const n = SEGMENTS + 1;
  const pos = new Float32Array(n * 2 * 3), tan = new Float32Array(n * 2 * 3);
  const side = new Float32Array(n * 2), t = new Float32Array(n * 2);
  const p = new Vector3(), d = new Vector3();
  for (let k = 0; k < n; k++) {
    const u = k / SEGMENTS;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, d);
    for (let s = 0; s < 2; s++) {
      const v = k * 2 + s;
      p.toArray(pos, v * 3);
      d.toArray(tan, v * 3);
      side[v] = s === 0 ? -1 : 1;
      t[v] = u;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < SEGMENTS; k++) {
    const a = k * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aTangent", new BufferAttribute(tan, 3));
  g.setAttribute("aSide", new BufferAttribute(side, 1));
  g.setAttribute("aT", new BufferAttribute(t, 1));
  g.setIndex(index);
  return g;
}

// Shared GLSL: comets and the brightness ramp around the protein.
const signalChunk = /* glsl */ `
  #define COMETS ${COMETS_PER_STRAND}
  uniform float uTime, uActivity, uVisibility, uSeed, uSpeed, uBrightness, uTail;
  uniform float uCometSpeed[COMETS], uCometOffset[COMETS];
  uniform vec3 uPulse;

  // A comet: small bright head at p, short tail trailing back toward the start of the path.
  // The tail falls off as a gaussian, so it ends crisply instead of lingering like an exponential.
  float comet(float t, float p) {
    float d = p - t;
    return d < 0.0 ? smoothstep(0.004, 0.0, -d) : exp(-(d * d) / (uTail * uTail));
  }

  // Comets looping along the path, each with its own speed and phase (see signal.ts). They run
  // slightly past both ends so they enter and leave the frame rather than popping in.
  float pulses(float t) {
    float glow = 0.0;
    for (int k = 0; k < COMETS; k++) {
      float p = fract(uTime * uSpeed * uCometSpeed[k] + uSeed + uCometOffset[k]) * 1.3 - 0.15;
      glow += comet(t, p);
    }
    return glow;
  }

  // Brightness ramps up over roughly the protein's own size, starting inside it, so the
  // strands glow where they enter and exit instead of stopping flat at the surface.
  float nearProtein(float dist) {
    return smoothstep(2.1, 0.7, dist);
  }
`;

const coreVertex = /* glsl */ `
  varying float vT;
  varying float vDist;
  #include <fog_pars_vertex>
  void main() {
    vT = uv.x; // 0 at the top-left end, 1 at the bottom-right end
    vDist = length(position); // distance from the protein centre
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const coreFragment = /* glsl */ `
  ${signalChunk}
  varying float vT;
  varying float vDist;
  #include <fog_pars_fragment>
  void main() {
    // No resting line: only comets are drawn. Everything else is discarded, so it neither shows
    // nor writes depth (depth of field then sees only the comets).
    float g = pulses(vT);
    float a = clamp(g, 0.0, 1.0) * uActivity * uVisibility;
    if (a < 0.01) discard;
    float near = nearProtein(vDist);
    vec3 col = uPulse * g * uBrightness * uActivity * (1.0 + near * 0.8);
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }`;

const haloVertex = /* glsl */ `
  attribute vec3 aTangent;
  attribute float aSide;
  attribute float aT;
  uniform float uWidth;
  varying float vT;
  varying float vSide;
  varying float vDist;
  void main() {
    vT = aT;
    vSide = aSide;
    vDist = length(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Camera-facing: offset across the strand, perpendicular to both it and the view ray.
    vec3 tv = normalize((modelViewMatrix * vec4(aTangent, 0.0)).xyz);
    vec3 across = normalize(cross(tv, normalize(-mv.xyz)));
    // Wider where the signal concentrates near the protein.
    float w = uWidth * (1.0 + 0.8 * smoothstep(2.1, 0.7, vDist));
    mv.xyz += across * aSide * w;
    gl_Position = projectionMatrix * mv;
  }`;

const haloFragment = /* glsl */ `
  ${signalChunk}
  varying float vT;
  varying float vSide;
  varying float vDist;
  void main() {
    // Gaussian falloff across the ribbon: a tighter inner glow plus a broad, faint halo.
    float y2 = vSide * vSide;
    float profile = exp(-y2 * 9.0) * 0.6 + exp(-y2 * 2.5) * 0.4;
    float near = nearProtein(vDist);
    // Only the comets glow. Kept dim on purpose: stacked additive light saturates to white fast,
    // and depth of field spreads the halo further (it sits over the far backdrop in the depth buffer).
    float glow = pulses(vT) * 0.22 * uActivity * uBrightness * (1.0 + near * 0.8);
    vec3 col = uPulse * glow * profile * uVisibility;
    gl_FragColor = vec4(col, 1.0);
  }`;

type Props = {
  on: boolean;
  animate: boolean;
  /** Thickness multiplier: keeps lines at least a pixel or two wide when the camera pulls back (phones). */
  thickness?: number;
};

export function SignalLines({ on, animate, thickness = 1 }: Props) {
  const { radius, haloWidth, pulse, pulseIntensity, speed, tail } = HERO.lines;

  const strands = useMemo(
    () =>
      STRANDS.map((s) => {
        const curve = strandCurve(s.i);
        const uniforms = () => ({
          uTime: { value: 0 },
          uActivity: { value: 1 },
          uVisibility: { value: 1 },
          uSeed: { value: s.seed },
          uSpeed: { value: speed * s.speed },
          uBrightness: { value: s.brightness },
          uTail: { value: tail },
          uCometSpeed: { value: COMET_SPEED },
          uCometOffset: { value: COMET_OFFSET },
          uPulse: { value: new Color(pulse).multiplyScalar(pulseIntensity) },
        });
        const core = new ShaderMaterial({
          vertexShader: coreVertex,
          fragmentShader: coreFragment,
          fog: true,
          transparent: true,
          uniforms: {
            ...uniforms(),
            fogColor: { value: new Color() },
            fogDensity: { value: 0 },
            fogNear: { value: 1 },
            fogFar: { value: 10 },
          },
        });
        const halo = new ShaderMaterial({
          vertexShader: haloVertex,
          fragmentShader: haloFragment,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: { ...uniforms(), uWidth: { value: haloWidth * s.width * thickness } },
        });
        return {
          curve,
          spec: s,
          core: { geometry: new TubeGeometry(curve, SEGMENTS, radius * s.width * thickness, 6, false), material: core },
          halo: { geometry: ribbonGeometry(curve), material: halo },
        };
      }),
    [radius, haloWidth, pulse, pulseIntensity, speed, tail, thickness],
  );

  const group = useRef<Group>(null);
  const entryLight = useRef<PointLight>(null);
  const exitLight = useRef<PointLight>(null);
  const tmp = useMemo(() => ({ p: new Vector3(), entry: new Vector3(), exit: new Vector3() }), []);
  useFrame((state, dt) => {
    for (const s of strands) {
      for (const m of [s.core.material, s.halo.material]) {
        const u = m.uniforms;
        if (animate) u.uTime.value = state.clock.elapsedTime;
        // Ease the signal on/off rather than cutting it: pulses die first, then the lines fade away.
        u.uActivity.value = MathUtils.damp(u.uActivity.value, on ? 1 : 0, on ? 2.5 : 2, dt);
        u.uVisibility.value = MathUtils.damp(u.uVisibility.value, on ? 1 : 0, on ? 2 : 1.3, dt);
      }
    }
    if (group.current) group.current.visible = strands[0].core.material.uniforms.uVisibility.value > 0.003;

    // Mirror the shader's pulse heads on the CPU: hand their view-space positions to the protein
    // materials (so the surface glows where a pulse approaches), and swell the entry/exit lights
    // as pulses arrive.
    const { camera } = state;
    const lines = group.current;
    const u0 = strands[0].core.material.uniforms;
    const level = u0.uActivity.value * u0.uVisibility.value;
    const time = u0.uTime.value;
    const entryPos = entryLight.current?.position ?? tmp.entry;
    const exitPos = exitLight.current?.position ?? tmp.exit;
    let nearEntry = 0, nearExit = 0, n = 0;
    for (const s of strands) {
      const speed = s.core.material.uniforms.uSpeed.value;
      for (let k = 0; k < COMETS_PER_STRAND; k++, n++) {
        const out: Vector4 = SIGNAL.pulses.value[n];
        const head = pulseHead(time, speed, s.spec.seed, k);
        if (!lines || head < 0 || head > 1 || level < 0.001) {
          out.w = 0;
          continue;
        }
        s.curve.getPointAt(head, tmp.p); // strand-local
        nearEntry = Math.max(nearEntry, Math.exp(-tmp.p.distanceToSquared(entryPos) / 0.5));
        nearExit = Math.max(nearExit, Math.exp(-tmp.p.distanceToSquared(exitPos) / 0.5));
        tmp.p.applyMatrix4(lines.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        out.set(tmp.p.x, tmp.p.y, tmp.p.z, level * s.spec.brightness);
      }
    }
    const base = level * HERO.lines.lightIntensity;
    // A low base (no lines to justify a constant glow) that swells as comets arrive.
    if (entryLight.current) entryLight.current.intensity = base * (0.15 + 1.2 * nearEntry);
    if (exitLight.current) exitLight.current.intensity = base * (0.15 + 1.2 * nearExit);
  });

  return (
    <>
      {/* Lights stay mounted (hidden groups skip their lights), so they fade rather than pop. */}
      <pointLight ref={entryLight} color={pulse} position={[-1.05, 0.46, 0.35]} distance={2.2} decay={2} intensity={0} />
      <pointLight ref={exitLight} color={pulse} position={[1.05, -0.42, 0.35]} distance={2.2} decay={2} intensity={0} />
    <group ref={group}>
      {strands.map((s, i) => (
        <group key={i}>
          <mesh geometry={s.halo.geometry} material={s.halo.material} frustumCulled={false} renderOrder={1} />
          <mesh geometry={s.core.geometry} material={s.core.material} frustumCulled={false} renderOrder={2} />
        </group>
      ))}
    </group>
    </>
  );
}
