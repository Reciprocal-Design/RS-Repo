import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { heroView, journeyScenes, journeyState } from '../render/journey';
import { displayListToSvg } from '../render/svg';
import { ORGANS, organCenter } from './body';
import { buildGeometry } from './geometry';
import { moduleScene } from './modules';
import type { MapCell, Scene } from './types';
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
    const base = moduleScene('body', 7);
    expect(buildGeometry(base).mesh).toBeUndefined(); // the wireframe is off by default
    const s = { ...base, module: { ...base.module, bodyMesh: true } };
    const g = buildGeometry(s);
    expect(g.particles!.length).toBeGreaterThan(2000);
    expect(g.mesh!.length / 4).toBeGreaterThan(400);
    // More detail along the limbs: chains to both hands and both feet.
    for (const k of ['limb0r-9', 'limb0l-9', 'limb1r-8', 'limb1l-8']) expect(g.nodeById.has(`body-${k}`)).toBe(true);
    const lit = (t: number) => buildDisplayList(s, t).prims.filter((p) => p.id.startsWith('body-particles-lit')).length;
    expect(lit(0.01)).toBeLessThan(lit(3));
    const none = { ...s, module: { ...s.module, bodyParticles: false } };
    expect(buildGeometry(none).particles).toBeUndefined();
  });

  it('fills the body and lights its form', () => {
    const s = moduleScene('body', 7);
    const prims = buildDisplayList(s, 1).prims;
    expect(prims.some((p) => p.id === 'body-body-fill' && p.kind === 'closedSpline' && !!p.fill)).toBe(true);
    expect(prims.filter((p) => p.id.startsWith('body-anatomy-')).length).toBeGreaterThan(30);
    const svg = displayListToSvg(buildDisplayList(s, 1));
    expect(svg).toContain('id="body-body-fill"');
    expect(svg).not.toContain('NaN');
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

/** The journey on an imported map: a 3 × 3 grid of square cells. */
function gridJourney(): Scene {
  const s = moduleScene('journey', 7);
  const cells: MapCell[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = c * 100 + 5, y = r * 100 + 5;
      cells.push({ id: `c${cells.length + 1}`, membrane: [x, y, x + 90, y, x + 90, y + 90, x, y + 90], nucleus: null, enabled: true, seed: cells.length + 1 });
    }
  }
  return { ...s, cellMap: { ...s.cellMap, around: false, name: 'grid.svg', viewBox: { x: 0, y: 0, width: 300, height: 300 }, cells } };
}

describe('journey on an imported map', () => {
  it('starts on the middle cell, alone, at the single cell size', () => {
    const s = gridJourney();
    const g = buildGeometry(journeyScenes(s).tissue);
    const hero = g.cells.find((c) => c.hero)!;
    expect(hero.id).toBe('c5');
    const v = heroView(s);
    expect(v.center.x).toBeCloseTo(hero.cell.center.x, 6);
    expect(v.zoom).toBeGreaterThan(1);
    const start = journeyState(s, 0);
    expect(start.tissue.origin).toEqual(v.center);
    expect(start.tissue.at).toEqual({ x: s.canvas.width / 2, y: s.canvas.height / 2 });
    expect(start.tissue.neighbours).toBe(0);
    // The centre cell starts the signal; links run out from it.
    expect(g.pathways.find((p) => p.id === 'p1')!.relayOnly).toBeFalsy();
    expect(g.edges.filter((e) => e.link).every((e) => !e.to.startsWith('p1-'))).toBe(true);
  });

  it('pulls back from the middle cell to the whole map with no jumps', () => {
    const s = gridJourney();
    const L = s.module.sectionLength;
    for (let b = 1; b < 3; b++) {
      const a = journeyState(s, b * L - 1e-6), c = journeyState(s, b * L + 1e-6);
      expect(c.tissue.zoom).toBeCloseTo(a.tissue.zoom, 3);
      expect(c.tissue.origin.x).toBeCloseTo(a.tissue.origin.x, 2);
      expect(c.tissue.origin.y).toBeCloseTo(a.tissue.origin.y, 2);
    }
    expect(journeyState(s, 2.5 * L).tissue.zoom).toBe(1);
  });
});

describe('journey in portrait', () => {
  const portrait = (s: Scene): Scene => ({ ...s, canvas: { ...s.canvas, width: 1080, height: 1350 } });

  it('turns the cell and tissue 90°: the tissue is laid out landscape, the body portrait', () => {
    const s = portrait(moduleScene('journey', 7));
    const { tissue, body } = journeyScenes(s);
    expect(tissue.canvas).toMatchObject({ width: 1350, height: 1080 });
    expect(body.canvas).toMatchObject({ width: 1080, height: 1350 });
    const start = journeyState(s, 0);
    expect(start.tissue.turn).toBe(true);
    expect(start.tissue.at).toEqual({ x: 540, y: 675 });
    expect(start.tissue.origin).toEqual(heroView(s).center);
    expect(start.body.turn).toBeUndefined();
    // Mid-tissue, the tissue's own centre sits at the frame's centre.
    const mid = journeyState(s, 2.5 * s.module.sectionLength);
    expect(mid.tissue.origin).toEqual({ x: 675, y: 540 });
    expect(mid.tissue.at).toEqual({ x: 540, y: 675 });
  });

  it('turns an imported map too, starting on its middle cell, with no jumps', () => {
    const s = portrait(gridJourney());
    expect(buildGeometry(journeyScenes(s).tissue).cells.find((c) => c.hero)!.id).toBe('c5');
    const L = s.module.sectionLength;
    for (let b = 1; b < 5; b++) {
      const a = journeyState(s, b * L - 1e-6), c = journeyState(s, b * L + 1e-6);
      for (const key of ['tissue', 'body'] as const) {
        expect(c[key].zoom).toBeCloseTo(a[key].zoom, 3);
        expect(c[key].origin.x).toBeCloseTo(a[key].origin.x, 2);
        expect(c[key].at.y).toBeCloseTo(a[key].at.y, 2);
      }
    }
  });

  it('keeps landscape as it was', () => {
    const s = moduleScene('journey', 7);
    expect(journeyState(s, 0).tissue.turn).toBe(false);
    expect(journeyScenes(s).tissue.canvas).toEqual(s.canvas);
  });
});
