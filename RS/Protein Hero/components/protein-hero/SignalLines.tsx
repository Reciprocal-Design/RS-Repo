"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CatmullRomCurve3, Color, Group, MathUtils, ShaderMaterial, TubeGeometry, Vector3 } from "three";
import { HERO } from "./config";

/**
 * Three strands running top-left → bottom-right. They fan out at the edges of the frame, merge
 * into one bundle where they meet the protein (whose surface hides the merge), and split again
 * after exiting. Bright pulses travel along them to show signalling; switching "off" fades the
 * pulses and then the lines themselves away.
 * Coordinates are relative to the protein's centre, in model radii.
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

const vertexShader = /* glsl */ `
  varying float vT;
  #include <fog_pars_vertex>
  void main() {
    vT = uv.x; // 0 at the top-left end, 1 at the bottom-right end
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const fragmentShader = /* glsl */ `
  uniform float uTime, uActivity, uVisibility, uSeed, uSpeed;
  uniform vec3 uBase, uPulse;
  varying float vT;
  #include <fog_pars_fragment>

  // A comet: bright head at p, tail trailing back toward the start of the strand.
  float comet(float t, float p, float tail) {
    float d = p - t;
    return d < 0.0 ? smoothstep(0.006, 0.0, -d) : exp(-d / tail);
  }

  void main() {
    // Faint shimmer along the resting line.
    float shimmer = 0.85 + 0.15 * sin(vT * 40.0 - uTime * 1.5 + uSeed * 10.0);
    vec3 col = uBase * shimmer * mix(0.55, 1.0, uActivity);

    // Three staggered pulses per strand, looping. They run slightly past both ends so they
    // enter and leave the frame rather than popping in.
    float glow = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float p = fract(uTime * uSpeed * (0.85 + 0.15 * fk) + uSeed + fk * 0.37) * 1.3 - 0.15;
      glow += comet(vT, p, 0.035 + 0.02 * fk);
    }
    col += uPulse * glow * uActivity;

    gl_FragColor = vec4(col, uVisibility);
    #include <fog_fragment>
  }`;

export function SignalLines({ on, animate }: { on: boolean; animate: boolean }) {
  const { radius, base, pulse, pulseIntensity, speed } = HERO.lines;

  const strands = useMemo(
    () =>
      [-1, 0, 1].map((i, n) => {
        const geometry = new TubeGeometry(strandCurve(i), 400, radius, 6, false);
        const material = new ShaderMaterial({
          vertexShader,
          fragmentShader,
          fog: true,
          transparent: true,
          uniforms: {
            uTime: { value: 0 },
            uActivity: { value: 1 },
            uVisibility: { value: 1 },
            uSeed: { value: n * 0.29 },
            uSpeed: { value: speed },
            uBase: { value: new Color(base) },
            uPulse: { value: new Color(pulse).multiplyScalar(pulseIntensity) },
            fogColor: { value: new Color() },
            fogDensity: { value: 0 },
            fogNear: { value: 1 },
            fogFar: { value: 10 },
          },
        });
        return { geometry, material };
      }),
    [radius, base, pulse, pulseIntensity, speed],
  );

  const group = useRef<Group>(null);
  useFrame((state, dt) => {
    for (const { material } of strands) {
      const u = material.uniforms;
      if (animate) u.uTime.value = state.clock.elapsedTime;
      // Ease the signal on/off rather than cutting it: pulses die first, then the lines fade away.
      u.uActivity.value = MathUtils.damp(u.uActivity.value, on ? 1 : 0, on ? 2.5 : 2, dt);
      u.uVisibility.value = MathUtils.damp(u.uVisibility.value, on ? 1 : 0, on ? 2 : 1.3, dt);
    }
    if (group.current) group.current.visible = strands[0].material.uniforms.uVisibility.value > 0.003;
  });

  return (
    <group ref={group}>
      {strands.map((s, i) => (
        <mesh key={i} geometry={s.geometry} material={s.material} frustumCulled={false} />
      ))}
    </group>
  );
}
