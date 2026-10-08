import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { journeyState } from '../render/journey';
import { displayListToSvg } from '../render/svg';
import { ORGANS, organCenter } from './body';
import { buildGeometry } from './geometry';
import { moduleScene } from './modules';
import { buildSchedule } from './timeline';

describe('body', () => {
  it('lays out every organ inside the body, with the signal reaching all of them', () => {
    const s = moduleScene('body', 7);
    const g = buildGeometry(s);
    expect(g.cells).toHaveLength(1);
    expect(g.cells[0].noNucleus).toBe(true);
    expect(g.organs!.length).toBe(ORGANS.reduce((a, o) => a + o.lobes.length, 0));
    const xs = g.cells[0].cell.points.map((p) => p.x), ys = g.cells[0].cell.points.map((p) => p.y);
    for (const n of g.nodes) {
      expect(n.x).toBeGreaterThan(Math.min(...xs));
      expect(n.x).toBeLessThan(Math.max(...xs));
      expect(n.y).toBeGreaterThan(Math.min(...ys));
      expect(n.y).toBeLessThan(Math.max(...ys));
    }
    const sched = buildSchedule(s);
    for (const n of g.nodes) expect(sched.fire.has(n.id)).toBe(true);
    // It starts at the chosen organ.
    expect(sched.fire.get('body-heart')).toBe(0);
  });

  it('has a dense particle field and a wireframe inside the body, lit as the signal passes', () => {
    const s = moduleScene('body', 7);
    const g = buildGeometry(s);
    expect(g.particles!.length).toBeGreaterThan(2000);
    expect(g.mesh!.length / 4).toBeGreaterThan(400);
    // More detail along the limbs: chains to both hands and both feet.
    for (const k of ['limb0r-9', 'limb0l-9', 'limb1r-8', 'limb1l-8']) expect(g.nodeById.has(`body-${k}`)).toBe(true);
    const lit = (t: number) => buildDisplayList(s, t).prims.filter((p) => p.id.startsWith('body-particles-lit')).length;
    expect(lit(0.01)).toBeLessThan(lit(3));
  });

  it('starts from any organ, two-lobed ones from both lobes', () => {
    const s = moduleScene('body', 7);
    const lungs = { ...s, module: { ...s.module, organ: 'lungs' as const } };
    const sched = buildSchedule(lungs);
    expect(sched.fire.get('body-lungs0')).toBe(0);
    expect(sched.fire.get('body-lungs1')).toBe(0);
    expect(sched.fire.get('body-heart')).toBeGreaterThan(0);
  });

  it('draws as vector, organs in the nucleus group, no nucleus for the body', () => {
    const s = moduleScene('body', 7);
    const svg = displayListToSvg(buildDisplayList(s, 1));
    expect(svg).toContain('id="organ1-nucleus-outline"');
    expect(svg).not.toContain('id="body-nucleus');
    expect(svg).not.toContain('NaN');
  });
});

describe('journey', () => {
  it('runs five equal sections', () => {
    const s = moduleScene('journey', 7);
    expect(buildSchedule(s).total).toBeCloseTo(5 * s.module.sectionLength);
  });

  it('starts on exactly the single cell and ends on the body, with no jumps between sections', () => {
    const s = moduleScene('journey', 7);
    const L = s.module.sectionLength;
    const k = s.cellMap.detailScale;
    const start = journeyState(s, 0);
    expect(start.tissue.zoom).toBeCloseTo(1 / k);
    expect(start.tissue.neighbours).toBe(0);
    expect(start.body.alpha).toBe(0);
    const end = journeyState(s, 5 * L - 1e-6);
    expect(end.body.zoom).toBe(1);
    expect(end.body.alpha).toBe(1);
    expect(end.tissue.alpha).toBe(0);
    expect(end.body.at).toEqual(organCenter(s, s.module.organ));
    // Continuous across every section boundary.
    for (let b = 1; b < 5; b++) {
      const a = journeyState(s, b * L - 1e-6), c = journeyState(s, b * L + 1e-6);
      for (const key of ['tissue', 'body'] as const) {
        expect(c[key].zoom).toBeCloseTo(a[key].zoom, 3);
        expect(c[key].alpha).toBeCloseTo(a[key].alpha, 3);
        expect(c[key].at.x).toBeCloseTo(a[key].at.x, 2);
        expect(c[key].at.y).toBeCloseTo(a[key].at.y, 2);
      }
      expect(c.tissue.neighbours).toBeCloseTo(a.tissue.neighbours, 3);
    }
  });
});
