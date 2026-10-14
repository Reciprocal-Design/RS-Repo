import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { heroView, journeyScenes } from '../render/journey';
import { buildGeometry } from './geometry';
import { moduleScene, withHero, withoutTissueMap, withTissueMap, type TissueUpload } from './modules';
import { ORGANIC_NAME, organicTissue } from './organic';
import { pointInPolygon } from './polygon';
import { parseSceneJson, serializeScene } from './sceneIO';
import { buildSchedule } from './timeline';
import type { MapCell, ModuleKind } from './types';

/** An n × n tissue of square cells, 96 wide on a 100 grid (near enough to touch). */
function grid(n = 3): TissueUpload {
  const cells: MapCell[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x = c * 100 + 2, y = r * 100 + 2;
      cells.push({ id: `c${cells.length + 1}`, membrane: [x, y, x + 96, y, x + 96, y + 96, x, y + 96], nucleus: null, enabled: true, seed: cells.length + 1 });
    }
  }
  return { name: 'grid.svg', viewBox: { x: 0, y: 0, width: n * 100, height: n * 100 }, cells };
}
const view = (kind: ModuleKind, hero = 'c5') => withTissueMap(moduleScene(kind, 7), grid(), hero);
const bbox = (pts: { x: number; y: number }[]) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

describe('a shared tissue map', () => {
  it('shows only the selected cell, as the single cell, in the single-cell views', () => {
    for (const kind of ['targetId', 'moa', 'combination', 'toxicity'] as const) {
      const s = view(kind);
      const g = buildGeometry(s);
      expect(g.cells).toHaveLength(1);
      expect(g.cells[0].hero).toBe(true);
      // Centred, spanning what the single cell does (twice its radius × the short side).
      const b = bbox(g.cells[0].cell.points);
      expect((b.x0 + b.x1) / 2).toBeCloseTo(s.canvas.width / 2, 0);
      expect((b.y0 + b.y1) / 2).toBeCloseTo(s.canvas.height / 2, 0);
      expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeCloseTo(2 * s.cell.radius * 1080, -1);
      // Full-size detail, the scene's own pathways, every node inside the cell, no links.
      expect(g.scale).toBe(1);
      expect(g.nodes.every((n) => n.id.startsWith('p'))).toBe(true);
      expect(g.nodes.every((n) => n.x > b.x0 && n.x < b.x1 && n.y > b.y0 && n.y < b.y1)).toBe(true);
      expect(g.edges.some((e) => e.link)).toBe(false);
      expect(buildSchedule(s).fire.size).toBeGreaterThan(1);
    }
  });

  it('keeps each view its own treatment of that cell', () => {
    const last = moduleScene('targetId', 7).pathways[0].layers.length - 1;
    // Target ID: receptor and DEGs only.
    expect(buildGeometry(view('targetId')).nodes.every((n) => n.layer === 0 || n.layer === last)).toBe(true);
    // MOA: a route to uncover; toxicity: a toxic DEG and the cell turning.
    expect(buildGeometry(view('moa')).nodes.some((n) => n.reveal)).toBe(true);
    const tox = view('toxicity');
    expect(buildGeometry(tox).nodes.some((n) => n.toxic)).toBe(true);
    expect(buildDisplayList(tox, 0).underlays!.length).toBe(2);
    // Combination: three targets on the one cell.
    expect(buildGeometry(view('combination')).receptors.filter((r) => r.target).length).toBe(3);
  });

  it('shows the whole map in the tissue view, the selected cell in the middle and starting the signal', () => {
    const s = view('tissue', 'c1');
    const g = buildGeometry(s);
    expect(g.cells).toHaveLength(9);
    const hero = g.cells.find((c) => c.hero)!;
    expect(hero.id).toBe('c1');
    expect(hero.cell.center.x).toBeCloseTo(s.canvas.width / 2, 0);
    expect(hero.cell.center.y).toBeCloseTo(s.canvas.height / 2, 0);
    expect(g.pathways.filter((p) => !p.relayOnly).map((p) => p.id)).toEqual(['p1']);
    // Not centred: the map sits as drawn.
    const fitted = buildGeometry({ ...s, cellMap: { ...s.cellMap, centerHero: false } });
    expect(fitted.cells.find((c) => c.hero)!.cell.center.x).toBeLessThan(s.canvas.width / 2);
  });

  it('selects another cell everywhere, and goes back to each view\'s own cell', () => {
    const a = buildGeometry(view('targetId', 'c5')).cells[0].cell.points[0];
    const moved = withHero(view('targetId', 'c5'), 'c2');
    expect(moved.cellMap.heroId).toBe('c2');
    expect(buildGeometry(moved).cells).toHaveLength(1);
    expect(withHero(moved, 'nope').cellMap.heroId).toBe('c2');
    expect(a).toBeDefined();
    expect(withoutTissueMap(view('targetId')).cellMap.cells).toHaveLength(0);
    expect(withoutTissueMap(view('tissue')).cellMap.around).toBe(true);
    // Saved and loaded with the selection.
    const loaded = parseSceneJson(serializeScene(view('moa', 'c3')));
    expect(loaded.cellMap).toMatchObject({ heroId: 'c3', solo: true });
    expect(buildGeometry(loaded).cells).toHaveLength(1);
  });

  it('starts the journey on the selected cell', () => {
    const s = view('journey', 'c3');
    const g = buildGeometry(journeyScenes(s).tissue);
    expect(g.cells.find((c) => c.hero)!.id).toBe('c3');
    expect(heroView(s).center).toEqual(g.cells.find((c) => c.hero)!.cell.center);
  });
});

describe('the tissue view zoomed in on the selected cell', () => {
  const big = () => withTissueMap(moduleScene('tissue', 7), grid(9), 'c41'); // the middle of a 9 × 9 map

  it('shows the selected cell and two cells beyond it along the short side', () => {
    const s = big();
    expect(s.cellMap.rings).toBe(2);
    const g = buildGeometry(s);
    const hero = g.cells.find((c) => c.hero)!;
    expect(hero.cell.center.x).toBeCloseTo(s.canvas.width / 2, 0);
    expect(hero.cell.center.y).toBeCloseTo(s.canvas.height / 2, 0);
    // Cells are 100 apart in the map: on the canvas, two of them (and half the middle one) reach the edge.
    const pitch = g.cells.find((c) => c.id === 'c42')!.cell.center.x - hero.cell.center.x;
    expect((s.canvas.height / 2) / pitch).toBeGreaterThan(2.2);
    expect((s.canvas.height / 2) / pitch).toBeLessThan(2.9);
    // The cells three away are off the canvas, top and bottom.
    const far = g.cells.find((c) => c.id === 'c5')!; // top row, same column
    expect(Math.max(...far.cell.points.map((p) => p.y))).toBeLessThan(0);
  });

  it('zooms with the setting, and detail grows with the cells', () => {
    const s = big();
    const pitch = (rings: number) => {
      const g = buildGeometry({ ...s, cellMap: { ...s.cellMap, rings } });
      return { p: g.cells.find((c) => c.id === 'c42')!.cell.center.x - g.cells.find((c) => c.hero)!.cell.center.x, scale: g.scale };
    };
    expect(pitch(1).p).toBeGreaterThan(pitch(2).p);
    expect(pitch(2).p).toBeGreaterThan(pitch(3).p);
    // 0 shows the whole map, as does asking for more cells than there are.
    expect(pitch(0).p).toBeCloseTo(1080 / 9, 0);
    expect(pitch(8).p).toBeCloseTo(1080 / 9, 0);
    expect(pitch(2).scale).toBeGreaterThan(pitch(0).scale);
    expect(pitch(1).scale).toBeLessThanOrEqual(1);
  });
});

describe('the generated organic tissue', () => {
  it('packs irregular cells wall to wall, each with a nucleus inside it', () => {
    const map = organicTissue(7);
    expect(map.cells.length).toBeGreaterThan(14);
    expect(map.cells.length).toBeLessThan(32);
    expect(organicTissue(7)).toEqual(map); // the same seed, the same tissue
    expect(organicTissue(8).cells[0].membrane).not.toEqual(map.cells[0].membrane);
    const poly = (a: number[]) => a.reduce<{ x: number; y: number }[]>((o, v, i) => (i % 2 ? o : [...o, { x: v, y: a[i + 1] }]), []);
    const cells = map.cells.map((c) => ({ m: poly(c.membrane), n: poly(c.nucleus!) }));
    for (const c of cells) {
      expect(c.n.every((p) => pointInPolygon(p, c.m))).toBe(true);
      // No cell's wall crosses into another's.
      for (const o of cells) if (o !== c) expect(c.m.some((p) => pointInPolygon(p, o.m))).toBe(false);
    }
    // Close together: every cell has a neighbour within a twentieth of its own width.
    for (const c of cells) {
      const w = Math.max(...c.m.map((p) => p.x)) - Math.min(...c.m.map((p) => p.x));
      const gap = Math.min(...cells.filter((o) => o !== c).flatMap((o) => o.m.flatMap((q) => c.m.map((p) => Math.hypot(p.x - q.x, p.y - q.y)))));
      expect(gap).toBeLessThan(w / 20 + 12);
    }
  });

  it('is what the cross-tissue view starts from: one wide tissue', () => {
    const s = moduleScene('crossTissue', 7);
    expect(s.cellMap).toMatchObject({ name: ORGANIC_NAME, around: false });
    expect(s.cellMap.heroId).not.toBe('');
    expect(s.cellMap.cells.length).toBeGreaterThan(28);
    const g = buildGeometry(s);
    expect(g.cells.length).toBe(s.cellMap.cells.length); // the map once, not twice
    // Neighbours are near enough to pass the signal on.
    expect(g.edges.some((e) => e.link)).toBe(true);
    // Removing an uploaded map comes back to it.
    expect(withoutTissueMap(view('crossTissue')).cellMap.name).toBe(ORGANIC_NAME);
  });
});

describe('cross-tissue communication', () => {
  const pinkOf = (x: ReturnType<typeof view>) => buildGeometry(x).cells.filter((c) => c.glow === x.module.tissue2Color).map((c) => c.id);

  for (const [name, make] of [['an uploaded map', () => view('crossTissue', 'c4')], ['the generated tissue', () => moduleScene('crossTissue', 7)]] as const) {
    it(`splits one map into two tissues by colour, the signal crossing where they meet (${name})`, () => {
      const s = make();
      const g = buildGeometry(s);
      // The map once: every cell of it, each id once.
      expect(g.cells.length).toBe(s.cellMap.cells.length);
      expect(new Set(g.cells.map((c) => c.id)).size).toBe(g.cells.length);
      // By default the right-hand half is in the second colour, never the selected cell.
      const pink = new Set(pinkOf(s));
      const hero = g.cells.find((c) => c.hero)!;
      expect(pink.has(hero.id)).toBe(false);
      const xs = g.cells.map((c) => c.cell.center.x);
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      for (const c of g.cells) if (c !== hero) expect(pink.has(c.id)).toBe(c.cell.center.x > mid);
      // The signal starts in the selected cell and reaches the other tissue.
      expect(g.pathways.filter((p) => !p.relayOnly).map((p) => p.id)).toEqual(['p1']);
      const cellOf = (id: string) => /^(c\d+)-/.exec(id)?.[1] ?? hero.id;
      const fired = new Set([...buildSchedule(s).fire.keys()].map(cellOf));
      expect([...pink].some((id) => fired.has(id))).toBe(true);
      // Links crossing between the tissues are drawn heavier; those within one are not.
      const crossing = g.edges.filter((e) => e.link && pink.has(cellOf(e.from)) !== pink.has(cellOf(e.to)));
      expect(crossing.length).toBeGreaterThan(0);
      expect(crossing.every((e) => e.weight === 2.2)).toBe(true);
      expect(g.edges.filter((e) => e.link && pink.has(cellOf(e.from)) === pink.has(cellOf(e.to))).every((e) => !e.weight)).toBe(true);
    });
  }

  it('draws in pink exactly the cells picked', () => {
    const s = view('crossTissue', 'c4');
    const picked = { ...s, module: { ...s.module, pinkCells: ['c1', 'c5'] } };
    expect(pinkOf(picked).sort()).toEqual(['c1', 'c5']);
    expect(pinkOf({ ...s, module: { ...s.module, pinkCells: [] } })).toEqual([]);
    // Only colours and line weights change: the same cells, networks and links.
    expect(buildGeometry(picked).edges.map((e) => e.id)).toEqual(buildGeometry(s).edges.map((e) => e.id));
    // Saved and loaded.
    expect(parseSceneJson(serializeScene(picked)).module.pinkCells).toEqual(['c1', 'c5']);
    expect(parseSceneJson(serializeScene(s)).module.pinkCells).toBeNull();
  });
});
