import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { defaultScene } from './defaults';
import { buildSchedule } from './timeline';
import { planVideo, videoSize, videoSizeError } from './video';

describe('video export plan', () => {
  it('covers whole loops with frames spread exactly across them', () => {
    const s = defaultScene(3);
    const T = buildSchedule(s).total;
    for (const fps of [24, 30, 60]) {
      for (const loops of [1, 3]) {
        const p = planVideo(s, fps, loops);
        expect(p.span).toBeCloseTo(T * loops, 9);
        expect(p.frames).toBe(Math.round(T * loops * fps));
        expect(p.timeAt(0)).toBe(0);
        // The frame after the last is exactly the loop's end: the video loops seamlessly.
        expect(p.timeAt(p.frames)).toBeCloseTo(p.span, 9);
        // Spacing stays within a whisker of 1/fps.
        expect(Math.abs(p.timeAt(1) - 1 / fps)).toBeLessThan(0.5 / fps / p.frames + 1e-9);
      }
    }
  });

  it('seamless: the first frame is the one that follows the last', () => {
    const s = defaultScene(3);
    s.animation = { ...s.animation, continuous: true };
    const p = planVideo(s, 30, 2);
    const at = (t: number) => JSON.stringify(buildDisplayList(s, t));
    expect(at(p.timeAt(p.frames))).toBe(at(p.timeAt(0)));
  });

  it('a non-looping scene exports one run, whatever the loop count', () => {
    const s = defaultScene(3);
    s.animation = { ...s.animation, loop: false };
    expect(planVideo(s, 30, 5).span).toBeCloseTo(buildSchedule(s).total, 9);
  });

  it('sizes are even, and too-large sizes are refused', () => {
    const s = defaultScene(3);
    s.canvas = { ...s.canvas, width: 1001, height: 563 };
    const v = videoSize(s, 1);
    expect(v.width % 2).toBe(0);
    expect(v.height % 2).toBe(0);
    expect(videoSizeError(3840, 2160)).toBeNull();
    expect(videoSizeError(7680, 4320)).toMatch(/at most/);
  });
});
