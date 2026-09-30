import { Color, Vector4 } from "three";
import { HERO } from "./config";

/**
 * Where the signalling pulses are right now, shared between the lines (which write it every
 * frame) and the protein-style materials (which glow where a pulse is near). One hero per page.
 *
 * Each entry is a pulse head in view space (xyz) and its strength (w, 0 when off the strand or
 * switched off). Three strands × three pulses.
 */
export const PULSE_COUNT = 9;

export const SIGNAL = {
  pulses: { value: Array.from({ length: PULSE_COUNT }, () => new Vector4()) },
  color: { value: new Color(HERO.lines.pulse) },
  glow: { value: HERO.lines.surfaceGlow },
  radius: { value: HERO.lines.surfaceGlowRadius },
};

/** Head position (0..1 along the strand, may run past either end) of pulse k, as the line shader computes it. */
export function pulseHead(time: number, speed: number, seed: number, k: number) {
  const x = time * speed * (0.85 + 0.15 * k) + seed + k * 0.37;
  return (x - Math.floor(x)) * 1.3 - 0.15;
}
