"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import { Color, ShaderMaterial, Vector2, Vector3 } from "three";
import { HERO } from "./config";
import { THEME, type ThemeState } from "./theme";
import type { PointerState } from "./usePointer";

// Screen-space studio backdrop: purple falloff with a warm key glow, drawn behind everything.
const KEY = new Vector3(...HERO.lights.key.position).normalize();
const Y_AXIS = new Vector3(0, 1, 0);

export function Backdrop({ pointer, theme, rig }: { pointer: PointerState; theme: ThemeState; rig: { angle: number } }) {
  const key = useMemo(() => new Vector3(), []);
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
          uGlowStrength: { value: bg.glowStrength },
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
          uniform float uTime, uAspect, uGlowStrength;
          uniform vec2 uPointer, uGlowCenter;
          uniform vec3 uDeep, uMid, uHaze, uGlow;
          varying vec2 vUv;

          // Distances measured against the shorter screen side, so shapes hold up in portrait.
          vec2 toShort(vec2 d) {
            return d * vec2(uAspect, 1.0) / min(uAspect, 1.0);
          }

          // Value noise + fbm for slow, cloud-like variation.
          float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
          }
          float fbm(vec2 p) {
            float v = 0.0, a = 0.5;
            for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
            return v;
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
            col = mix(col, uHaze, blob(uv, vec2(0.82, 0.55) + drift * 0.6, 0.45) * 0.4);
            // Key glow behind the subject: broad and soft, its strength set per look.
            vec2 gc = uGlowCenter + drift;
            col = mix(col, uGlow, blob(uv, gc, 0.36) * uGlowStrength);
            col += uGlow * blob(uv, gc, 0.2) * 0.2 * smoothstep(0.5, 0.9, uGlowStrength);

            // Depth and complexity: slow cloudy variation in brightness, finer wisps of haze...
            vec2 sq = toShort(uv - 0.5);
            float clouds = fbm(sq * 2.2 + vec2(uTime * 0.012, -uTime * 0.008));
            float wisps = fbm(sq * 4.6 - vec2(uTime * 0.02, 0.0) + clouds * 1.5);
            col *= 0.93 + 0.14 * clouds;
            col = mix(col, uHaze, smoothstep(0.5, 0.85, wisps) * 0.12);
            // ...and faint rays fanning out from the key glow.
            vec2 rd = toShort(uv - gc);
            float ang = atan(rd.y, rd.x);
            float rays = pow(fbm(vec2(ang * 5.0, uTime * 0.04)), 3.0) * exp(-length(rd) * 1.8);
            col += uGlow * rays * 0.4 * uGlowStrength;

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
    // The glow follows the orbiting key light across the frame: it sits on the side the light
    // comes from, and passes behind the subject when the key swings round behind it.
    key.copy(KEY).applyAxisAngle(Y_AXIS, rig.angle);
    material.uniforms.uGlowCenter.value.set(bg.glowCenter[0] + (key.x - KEY.x) * 0.32, bg.glowCenter[1]);
    const u = material.uniforms, t = theme.mix;
    THEME.background.deep(u.uDeep.value, t);
    THEME.background.mid(u.uMid.value, t);
    THEME.background.haze(u.uHaze.value, t);
    THEME.background.glow(u.uGlow.value, t);
    u.uGlowStrength.value = HERO.background.glowStrength + (HERO.off.glowStrength - HERO.background.glowStrength) * t;
    const boost = 1 + (HERO.off.backgroundBoost - 1) * t;
    for (const c of [u.uDeep, u.uMid, u.uHaze, u.uGlow]) c.value.multiplyScalar(boost);
  });

  return (
    <mesh renderOrder={-1} frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
