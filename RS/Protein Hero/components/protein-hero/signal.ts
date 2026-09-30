import { Color, Vector4 } from "three";
import { HERO } from "./config";

/**
 * Where the signalling comets are right now, shared between the strands (which write it every
 * frame) and the protein-style materials (which glow where a comet is near). One hero per page.
 *
 * Each entry is a comet head in view space (xyz) and its strength (w, 0 when off the strand or
 * switched off).
 */
export const STRAND_COUNT = 3;
export const COMETS_PER_STRAND = HERO.lines.cometsPerStrand;
export const PULSE_COUNT = STRAND_COUNT * COMETS_PER_STRAND;

// Per-comet speed multipliers and phase offsets: roughly even spacing with a little irregularity,
// so comets flow rather than march in lockstep. Shared by the shader (as uniforms) and the CPU
// mirror below, so the protein's glow always lines up with the visible comets.
export const COMET_SPEED = Array.from({ length: COMETS_PER_STRAND }, (_, k) => 0.85 + 0.3 * frac(k * 0.618 + 0.13));
export const COMET_OFFSET = Array.from({ length: COMETS_PER_STRAND }, (_, k) => k / COMETS_PER_STRAND + 0.05 * Math.sin(k * 12.9898));

function frac(x: number) {
  return x - Math.floor(x);
}

export const SIGNAL = {
  pulses: { value: Array.from({ length: PULSE_COUNT }, () => new Vector4()) },
  color: { value: new Color(HERO.lines.pulse) },
  glow: { value: HERO.lines.surfaceGlow },
  radius: { value: HERO.lines.surfaceGlowRadius },
};

/** Head position (0..1 along the strand, running slightly past either end) of comet k, as the shader computes it. */
export function pulseHead(time: number, speed: number, seed: number, k: number) {
  return frac(time * speed * COMET_SPEED[k] + seed + COMET_OFFSET[k]) * 1.3 - 0.15;
}
