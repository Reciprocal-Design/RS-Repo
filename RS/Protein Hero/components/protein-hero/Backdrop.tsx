"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { Color, ShaderMaterial, Vector2 } from "three";
import { HERO } from "./config";
import { THEME, type ThemeState } from "./theme";
import type { PointerState } from "./usePointer";

// Screen-space studio backdrop: purple falloff with a warm key glow, drawn behind everything.
export function Backdrop({ pointer, theme }: { pointer: PointerState; theme: ThemeState }) {
  const size = useThree((s) => s.size);
  const bg = HERO.background;

  const material = useMemo(
    () =>
      new ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        uniforms: {
          uTime: { value: 0 },
          uAspect: { value: 1 },
          uPointer: { value: new Vector2() },
          uGlowCenter: { value: new Vector2(...bg.glowCenter) },
          uDeep: { value: new Color(bg.deep) },
          uMid: { value: new Color(bg.mid) },
          uHaze: { value: new Color(bg.haze) },
          uGlow: { value: new Color(bg.glow) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.9999, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uAspect;
          uniform vec2 uPointer, uGlowCenter;
          uniform vec3 uDeep, uMid, uHaze, uGlow;
          varying vec2 vUv;

          // Distances measured against the shorter screen side, so shapes hold up in portrait.
          vec2 toShort(vec2 d) {
            return d * vec2(uAspect, 1.0) / min(uAspect, 1.0);
          }

          float blob(vec2 uv, vec2 c, float r) {
            vec2 d = toShort(uv - c);
            return exp(-dot(d, d) / (r * r));
          }

          void main() {
            vec2 uv = vUv;
            vec2 drift = vec2(sin(uTime * 0.11), cos(uTime * 0.09)) * 0.02 - uPointer * 0.025;

            // Base: deep corners into a mid purple centre.
            vec2 q = toShort(uv - 0.5);
            vec3 col = mix(uMid, uDeep, smoothstep(0.25, 1.15, length(q)));
            // Cool haze drifting on the right.
            col = mix(col, uHaze, blob(uv, vec2(0.82, 0.55) + drift * 0.6, 0.38) * 0.55);
            // Warm key glow behind the subject, upper left, with an HDR core for bloom.
            vec2 gc = uGlowCenter + drift;
            col = mix(col, uGlow, blob(uv, gc, 0.3) * 0.9);
            col += uGlow * blob(uv, gc, 0.17) * 0.2;

            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [bg],
  );

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uAspect.value = size.width / size.height;
    material.uniforms.uPointer.value.set(pointer.smoothX, pointer.smoothY);
    const u = material.uniforms, t = theme.mix;
    THEME.background.deep(u.uDeep.value, t);
    THEME.background.mid(u.uMid.value, t);
    THEME.background.haze(u.uHaze.value, t);
    THEME.background.glow(u.uGlow.value, t);
    const boost = 1 + (HERO.off.backgroundBoost - 1) * t;
    for (const c of [u.uDeep, u.uMid, u.uHaze, u.uGlow]) c.value.multiplyScalar(boost);
  });

  return (
    <mesh renderOrder={-1} frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
