import { Color } from "three";
import { HERO } from "./config";

/**
 * The scene has two looks: ON (dark, diseased, signalling) and OFF (light blue, calm).
 * `mix` eases from 0 (ON) to 1 (OFF) after the switch flips; every themed part of the scene
 * blends its colours with it each frame.
 */
export type ThemeState = { mix: number; target: number };

export function createThemeState(on: boolean): ThemeState {
  const v = on ? 0 : 1;
  return { mix: v, target: v };
}

/** A pair of colours (ON, OFF) that can be blended into `out`. */
export function colorPair(on: string, off: string) {
  const a = new Color(on), b = new Color(off);
  return (out: Color, t: number) => out.lerpColors(a, b, t);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Convenience: ON values come from the main config, OFF values from HERO.off.
const { off } = HERO;
export const THEME = {
  protein: {
    color: colorPair(HERO.protein.color, off.protein.color),
    scatter: colorPair(HERO.protein.scatter, off.protein.scatter),
    translucency: colorPair(HERO.protein.translucency, off.protein.translucency),
    rim: colorPair(HERO.protein.rim, off.protein.rim),
  },
  debris: colorPair(HERO.debris.color, off.debris),
  background: {
    deep: colorPair(HERO.background.deep, off.background.deep),
    mid: colorPair(HERO.background.mid, off.background.mid),
    haze: colorPair(HERO.background.haze, off.background.haze),
    glow: colorPair(HERO.background.glow, off.background.glow),
  },
  envDome: colorPair(HERO.lights.envDome, off.envDome),
  ambient: colorPair(HERO.lights.ambient.color, off.ambient),
  particles: colorPair(HERO.particles.color, off.particles),
  dust: colorPair(HERO.dust.color, off.dust),
  shafts: colorPair(HERO.shafts.color, off.shafts),
};
