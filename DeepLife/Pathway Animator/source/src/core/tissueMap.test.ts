import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { heroView, journeyScenes } from '../render/journey';
import { neighbourCells, rotateMap, singleCellView } from './cellMap';
import { buildGeometry } from './geometry';
import { moduleScene, withHero, withoutTissueMap, withTissueMap, type TissueUpload } from './modules';
import { ORGANIC_NAME, organicTissue } from './organic';
import { pointInPolygon } from './polygon';
import { parseSceneJson, serializeScene } from './sceneIO';
import { buildSchedule } from './timeline';
import type { MapCell, ModuleKind, Scene } from './types';

/** A tab as it started before tabs 1–5 went square and zoomed out: 1920 × 1080, zoom 1, no neighbours. */
const classic = (kind: ModuleKind, seed = 7): Scene => {
  const s = moduleScene(kind, seed);
  return {
    ...s,
    canvas: { ...s.canvas, width: 1920, height: 1080 },
    cell: { ...s.cell, neighbours: { ...s.cell.neighbours, show: false } },
    module: { ...s.module, zoom: 1 },
  };
};

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
const view = (kind: ModuleKind, hero = 'c5') => withTissueMap(classic(kind), grid(), hero);
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
    const hero = g.cells.find((c) => c.hero)!;
    expect(hero.id).toBe('c3');
    // Centred on the selected cell (its bounding box), which lies wholly in the frame.
    const v = heroView(s);
    const xs = hero.cell.points.map((p) => p.x), ys = hero.cell.points.map((p) => p.y);
    expect(v.center.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 6);
    expect(v.center.y).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 6);
    for (const p of hero.cell.points) {
      const x = s.canvas.width / 2 + (p.x - v.center.x) * v.zoom, y = s.canvas.height / 2 + (p.y - v.center.y) * v.zoom;
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(s.canvas.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(s.canvas.height);
    }
  });

  it('never crops the starting cell, even a long one, in either layout', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1350]]) {
      // A tall, thin hexagon: by area alone it would be zoomed far past the frame's height.
      const tall: MapCell = {
        id: 'c1', enabled: true, seed: 1, nucleus: null,
        membrane: [0, -300, 60, -150, 60, 150, 0, 300, -60, 150, -60, -150],
      };
      const s0 = moduleScene('journey', 7);
      const s = withTissueMap({ ...s0, canvas: { ...s0.canvas, width: w, height: h } },
        { name: 'tall.svg', viewBox: { x: -400, y: -400, width: 800, height: 800 }, cells: [tall] }, 'c1');
      const g = buildGeometry(journeyScenes(s).tissue);
      const hero = g.cells.find((c) => c.hero)!;
      const v = heroView(s);
      const turned = h > w;
      // The frame as the tissue sees it (sides swapped when turned onto a portrait frame).
      const fw = turned ? h : w, fh = turned ? w : h;
      for (const p of hero.cell.points) {
        expect(Math.abs(p.x - v.center.x) * v.zoom).toBeLessThan(fw / 2);
        expect(Math.abs(p.y - v.center.y) * v.zoom).toBeLessThan(fh / 2);
      }
    }
  });
});

describe('the tissue view zoomed in on the selected cell', () => {
  const big = () => withTissueMap(classic('tissue'), grid(9), 'c41'); // the middle of a 9 × 9 map

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

describe('neighbouring cells round a single cell', () => {
  const on = (s: Scene, opacity = 0.35, mono = false): Scene => ({ ...s, cell: { ...s.cell, neighbours: { show: true, opacity, mono } } });
  const nbPrims = (s: Scene) => buildDisplayList(s, 0, { signal: false }).prims.filter((p) => p.id.startsWith('nb'));
  const own = (s: Scene) => JSON.stringify(buildDisplayList(s, 0, { signal: false }).prims.filter((p) => !p.id.startsWith('nb')));

  it('can be off; shown, the cell itself is unchanged and they sit round it, see-through', () => {
    const s = classic('targetId');
    expect(nbPrims(s)).toHaveLength(0);
    const shown = on(s);
    const prims = nbPrims(shown);
    expect(prims.length).toBeGreaterThan(0);
    expect(own(shown)).toBe(own(s));
    // None of them overlaps the cell: their centres are outside it.
    const cell = buildGeometry(s).cells[0].cell.points;
    for (const n of neighbourCells(shown)) expect(pointInPolygon(n.cell.center, cell)).toBe(false);
    // See-through: every neighbour prim is at most the chosen opacity of its full-strength self.
    const full = nbPrims(on(s, 1));
    prims.forEach((p, i) => expect(p.opacity ?? 1).toBeCloseTo((full[i].opacity ?? 1) * 0.35, 9));
  });

  it('can be drawn in greys', () => {
    const grey = nbPrims(on(moduleScene('targetId', 7), 0.5, true));
    const strokes = grey.flatMap((p) => ('stroke' in p && typeof p.stroke === 'string' ? [p.stroke] : []));
    expect(strokes.length).toBeGreaterThan(0);
    for (const c of strokes) {
      const [r, g, b] = c.match(/[\d.]+/g)!.map(Number);
      expect(Math.abs(r - g)).toBeLessThan(1.5);
      expect(Math.abs(g - b)).toBeLessThan(1.5);
    }
  });

  it('with a tissue map, are the selected cell’s real neighbours at the same scale', () => {
    const s = on(view('targetId', 'c5'));
    const ns = neighbourCells(s);
    expect(ns.length).toBe(8); // the 3 × 3 grid round the middle cell
    const hero = buildGeometry(s).cells.find((c) => c.id === 'c5')!;
    const pitch = Math.min(...ns.map((n) => Math.hypot(n.cell.center.x - hero.cell.center.x, n.cell.center.y - hero.cell.center.y)));
    // Cells are 100 apart and 96 wide in the map, so the nearest neighbour is about one cell width (plus the gap) away.
    const width = Math.max(...hero.cell.points.map((p) => p.x)) - Math.min(...hero.cell.points.map((p) => p.x));
    expect(pitch / width).toBeCloseTo(100 / 96, 1);
    expect(own(s)).toBe(own(view('targetId', 'c5')));
  });

  it('are not added to views that already show many cells', () => {
    for (const kind of ['tissue', 'crossTissue', 'journey', 'body'] as ModuleKind[]) {
      const s = on(moduleScene(kind, 7));
      expect(singleCellView(s)).toBe(false);
    }
  });
});

describe('turning an uploaded map', () => {
  /** A 3 × 2 grid: wider than tall, so a quarter turn shows. */
  function wide(): TissueUpload {
    const g = grid(3);
    return { ...g, viewBox: { x: 0, y: 0, width: 300, height: 200 }, cells: g.cells.slice(0, 6) };
  }

  it('turns the cells about the middle and swaps the viewBox on a quarter turn', () => {
    const s = withTissueMap(moduleScene('tissue', 7), wide(), 'c2');
    const r = rotateMap(s.cellMap, 90);
    expect(r.rotation).toBe(90);
    expect(r.viewBox).toEqual({ x: 50, y: -50, width: 200, height: 300 });
    // Clockwise (y down): the top-left corner of c1 goes to the top right.
    expect(r.cells[0].membrane.slice(0, 2)).toEqual([248, -48]);
    // Ids, seeds, the selected cell and the view's settings stay.
    expect(r.cells.map((c) => [c.id, c.seed])).toEqual(s.cellMap.cells.map((c) => [c.id, c.seed]));
    expect(r).toMatchObject({ heroId: 'c2', centerHero: true, rings: 2 });
  });

  it('comes back exactly after four quarter turns, or back to 0', () => {
    const cm = withTissueMap(moduleScene('journey', 7), wide(), 'c2').cellMap;
    let r = cm;
    for (let i = 1; i <= 4; i++) r = rotateMap(r, 90 * i);
    expect(r.cells).toEqual(cm.cells);
    expect(r.viewBox).toEqual(cm.viewBox);
    expect(r.rotation).toBeUndefined();
    const back = rotateMap(rotateMap(cm, 37), 0);
    expect(back.viewBox).toEqual(cm.viewBox);
    back.cells.forEach((c, i) => c.membrane.forEach((v, j) => expect(v).toBeCloseTo(cm.cells[i].membrane[j], 2)));
  });

  it('boxes any angle round the turned map, and is saved with the scene', () => {
    const s = withTissueMap(moduleScene('crossTissue', 7), wide(), 'c2');
    const r = { ...s, cellMap: rotateMap(s.cellMap, 45) };
    const w = (300 + 200) * Math.SQRT1_2;
    expect(r.cellMap.viewBox.width).toBeCloseTo(w, 6);
    expect(r.cellMap.viewBox.height).toBeCloseTo(w, 6);
    for (const c of r.cellMap.cells) {
      for (let i = 0; i < c.membrane.length; i += 2) {
        expect(c.membrane[i]).toBeGreaterThanOrEqual(r.cellMap.viewBox.x);
        expect(c.membrane[i]).toBeLessThanOrEqual(r.cellMap.viewBox.x + w);
      }
    }
    expect(buildGeometry(r).cells.length).toBe(6);
    const loaded = parseSceneJson(serializeScene(r));
    expect(loaded.cellMap.rotation).toBe(45);
    expect(loaded.cellMap.sourceViewBox).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    // Turning a loaded map goes on from where it was saved.
    expect(rotateMap(loaded.cellMap, 0).viewBox).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });

  it('leaves a generated tissue alone', () => {
    const t = moduleScene('tissue', 7).cellMap;
    expect(rotateMap(t, 90)).toBe(t);
  });
});
