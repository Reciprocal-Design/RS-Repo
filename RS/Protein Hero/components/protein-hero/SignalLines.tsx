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
  ShaderMaterial,
  TubeGeometry,
  Vector3,
} from "three";
import { HERO } from "./config";

/**
 * Three strands running top-left → bottom-right. They fan out at the edges of the frame, merge
 * into one bundle where they meet the protein (whose surface hides the merge), and split again
 * after exiting. Bright pulses travel along them to show signalling; switching "off" fades the
 * pulses and then the lines themselves away.
 *
 * Each strand is drawn as light rather than as a wire:
 *  - a thin opaque core tube (writes depth, so depth of field keeps it crisp), and
 *  - a wide, soft, additive halo ribbon underneath (a gaussian profile across its width).
 * Both brighten as they approach the protein, ramping up from inside it, so the signal appears
 * to concentrate where it enters and leaves. The strands differ in width, brightness and speed.
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

// Shared GLSL: pulses and the brightness ramp around the protein.
const signalChunk = /* glsl */ `
  uniform float uTime, uActivity, uVisibility, uSeed, uSpeed, uBrightness;
  uniform vec3 uBase, uPulse;

  // A comet: bright head at p, tail trailing back toward the start of the strand.
  float comet(float t, float p, float tail) {
    float d = p - t;
    return d < 0.0 ? smoothstep(0.006, 0.0, -d) : exp(-d / tail);
  }

  // Three staggered pulses per strand, looping. They run slightly past both ends so they
  // enter and leave the frame rather than popping in.
  float pulses(float t) {
    float glow = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float p = fract(uTime * uSpeed * (0.85 + 0.15 * fk) + uSeed + fk * 0.37) * 1.3 - 0.15;
      glow += comet(t, p, 0.035 + 0.02 * fk);
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
    float shimmer = 0.85 + 0.15 * sin(vT * 40.0 - uTime * 1.5 + uSeed * 10.0);
    float near = nearProtein(vDist);
    vec3 col = uBase * shimmer * mix(0.55, 1.0, uActivity) * (1.0 + near * 1.5 * uActivity);
    col += uPulse * pulses(vT) * uActivity * uBrightness;
    gl_FragColor = vec4(col, uVisibility);
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
    // Kept dim on purpose: stacked additive light saturates to white fast, and depth of field
    // spreads the halo further (it sits over the far backdrop in the depth buffer).
    float resting = 0.04 * mix(0.3, 1.0, uActivity) + near * 0.16 * uActivity;
    float glow = pulses(vT) * 0.22 * uActivity * uBrightness;
    vec3 col = (uBase * resting + uPulse * glow) * profile * uVisibility;
    gl_FragColor = vec4(col, 1.0);
  }`;

type Props = {
  on: boolean;
  animate: boolean;
  /** Thickness multiplier: keeps lines at least a pixel or two wide when the camera pulls back (phones). */
  thickness?: number;
};

export function SignalLines({ on, animate, thickness = 1 }: Props) {
  const { radius, haloWidth, base, pulse, pulseIntensity, speed } = HERO.lines;

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
          uBase: { value: new Color(base) },
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
          core: { geometry: new TubeGeometry(curve, SEGMENTS, radius * s.width * thickness, 6, false), material: core },
          halo: { geometry: ribbonGeometry(curve), material: halo },
        };
      }),
    [radius, haloWidth, base, pulse, pulseIntensity, speed, thickness],
  );

  const group = useRef<Group>(null);
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
  });

  return (
    <group ref={group}>
      {strands.map((s, i) => (
        <group key={i}>
          <mesh geometry={s.halo.geometry} material={s.halo.material} frustumCulled={false} renderOrder={1} />
          <mesh geometry={s.core.geometry} material={s.core.material} frustumCulled={false} renderOrder={2} />
        </group>
      ))}
    </group>
  );
}
