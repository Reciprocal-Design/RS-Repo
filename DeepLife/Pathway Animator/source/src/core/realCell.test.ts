import { describe, expect, it } from 'vitest';
import { buildDisplayList } from '../render/displayList';
import { realCellNet, realCellState, seekRealVideo, videoTimeAt } from '../render/realCell';
import { defaultScene } from './defaults';
import { buildGeometry } from './geometry';
import { moduleScene, withTissueMap } from './modules';
import { buildSchedule } from './timeline';
import type { MapCell } from './types';

const view = () => moduleScene('realCell', 7);

describe('virtual → real cell', () => {
  it('runs five equal sections: virtual, to real, discovery, back, virtual with the new nodes', () => {
    const s = view();
    const L = s.module.sectionLength;
    expect(buildSchedule(s).total).toBeCloseTo(5 * L);
    const at = (x: number) => realCellState(s, x * L);
    expect(at(0.5)).toMatchObject({ section: 0, video: 0, discovered: 0 });
    expect(at(1.5).video).toBeGreaterThan(0);
    expect(at(1.5).discovered).toBe(0);
    expect(at(2.5)).toMatchObject({ section: 2, video: 1 });
    expect(at(2.5).discovered).toBeGreaterThan(0);
    expect(at(2.5).discovered).toBeLessThan(1);
    expect(at(3.5).discovered).toBe(1);
    expect(at(4.5)).toMatchObject({ section: 4, video: 0, discovered: 1 });
    // No jumps at the section boundaries.
    for (let b = 1; b < 5; b++) {
      const p = realCellState(s, b * L - 1e-6), q = realCellState(s, b * L + 1e-6);
      expect(q.video).toBeCloseTo(p.video, 3);
      expect(q.discovered).toBeCloseTo(p.discovered, 3);
    }
    // The video starts as it fades in, and loops if it is short.
    expect(videoTimeAt(s, 0.5 * L, 4)).toBe(0);
    expect(videoTimeAt(s, L + 1.5, 4)).toBeCloseTo(1.5);
    expect(videoTimeAt(s, L + 5, 4)).toBeCloseTo(1);
  });

  it('discovers inactive nodes, joined by new edges, without moving or changing anything else', () => {
    const s = view();
    const before = buildGeometry(defaultScene(7));
    const g = buildGeometry(realCellNet(s));
    const found = g.nodes.filter((n) => n.discoverAt !== undefined);
    // One more node in each layer after the receptor (as many as had an inactive node to give).
    const layers = defaultScene(7).pathways[0].layers;
    const spare = layers.slice(1).filter((l) => l.nodeCount > l.activeCount).length;
    expect(found.length).toBe(spare);
    for (const n of found) {
      const was = before.nodeById.get(n.id)!;
      expect(was.active).toBe(false);
      expect([n.x, n.y]).toEqual([was.x, was.y]);
      expect(n.active).toBe(true);
    }
    // Every edge that was there still is; each new one joins a discovered node.
    const ids = new Set(g.edges.map((e) => e.id));
    for (const e of before.edges) expect(ids.has(e.id)).toBe(true);
    const added = g.edges.filter((e) => e.discoverAt !== undefined);
    expect(added.length).toBeGreaterThan(0);
    const foundIds = new Set(found.map((n) => n.id));
    for (const e of added) expect(foundIds.has(e.from) || foundIds.has(e.to)).toBe(true);
    // Each discovered node is reached by an edge before it pops up; all is done by the end of discovery.
    for (const n of found) {
      const into = added.filter((e) => e.to === n.id);
      if (into.length) expect(Math.min(...into.map((e) => e.discoverAt!))).toBeLessThan(n.discoverAt!);
    }
    for (const x of [...found, ...added]) expect(x.discoverAt! + g.discoverSpan!).toBeLessThanOrEqual(1 + 1e-9);
    // None asked for: nothing discovered.
    const none = { ...s, module: { ...s.module, newNodes: 0 } };
    expect(buildGeometry(realCellNet(none)).nodes.some((n) => n.discoverAt !== undefined)).toBe(false);
  });

  it('shows the discovered nodes as inactive until discovery reaches them, then as active nodes', () => {
    const v = view();
    const net = realCellNet({ ...v, style: { ...v.style, showInactiveNodes: true } });
    const g = buildGeometry(net);
    const n = g.nodes.filter((x) => x.discoverAt !== undefined).sort((a, b) => b.discoverAt! - a.discoverAt!)[0];
    const e = g.edges.find((x) => x.discoverAt !== undefined)!;
    const ids = (d: number) => new Set(buildDisplayList(net, 1, { discovered: d }).prims.map((p) => p.id));
    const start = ids(0);
    expect(start.has(n.id)).toBe(false);
    expect(start.has(`${n.id}-outer`)).toBe(true); // the grey ring of an inactive node
    expect(start.has(e.id)).toBe(false);
    const end = ids(1);
    expect(end.has(n.id)).toBe(true);
    expect(end.has(`${n.id}-outer`)).toBe(false);
    expect(end.has(e.id)).toBe(true);
    // Part way, an edge is growing: drawn short of its end, with a glowing tip.
    const mid = e.discoverAt! + g.discoverSpan! / 2;
    const grow = buildDisplayList(net, 1, { discovered: mid }).prims;
    const part = grow.find((p) => p.id === e.id)!;
    expect(part.kind === 'bezier' && part.p[3]).not.toEqual(e.bezier[3]);
    expect(grow.some((p) => p.id === `${e.id}-tip`)).toBe(true);
    // The virtual cell's outlines can fade out under a video.
    const faded = buildDisplayList(net, 1, { outlineAlpha: 0 }).prims;
    expect(faded.some((p) => p.group === 'membrane' || p.group === 'nucleus')).toBe(false);
    // With inactive nodes hidden (the default), a discovered node is hidden until it pops up.
    const hiddenNet = realCellNet(view());
    const hid = (d: number) => new Set(buildDisplayList(hiddenNet, 1, { discovered: d }).prims.map((p) => p.id));
    expect(hid(0).has(`${n.id}-outer`)).toBe(false);
    expect(hid(0).has(n.id)).toBe(false);
    expect(hid(1).has(n.id)).toBe(true);
  });

  it('takes the cell selected on an uploaded tissue map, alone', () => {
    const cells: MapCell[] = [0, 1, 2].map((i) => ({
      id: `c${i + 1}`, membrane: [i * 100, 0, i * 100 + 96, 0, i * 100 + 96, 96, i * 100, 96], nucleus: null, enabled: true, seed: i + 1,
    }));
    const s = withTissueMap(view(), { name: 'row.svg', viewBox: { x: 0, y: 0, width: 300, height: 100 }, cells }, 'c2');
    expect(s.cellMap).toMatchObject({ solo: true, heroId: 'c2' });
    const g = buildGeometry(realCellNet(s));
    expect(g.cells).toHaveLength(1);
    expect(g.cells[0].hero).toBe(true);
    expect(g.nodes.some((n) => n.discoverAt !== undefined)).toBe(true);
  });

  it('needs no video to be drawn or exported', async () => {
    const s = view();
    await expect(seekRealVideo(s, 4)).resolves.toBeUndefined();
    expect(buildDisplayList(realCellNet(s), 4, { discovered: realCellState(s, 4).discovered }).prims.length).toBeGreaterThan(10);
  });
});
