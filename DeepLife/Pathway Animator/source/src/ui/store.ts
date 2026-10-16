import { create } from 'zustand';
import { makePathway } from '../core/defaults';
import { heroCellOf, mapCellAt, mapCells, middleCellId, rotateMap, soloActive } from '../core/cellMap';
import { defaultCellMap } from '../core/defaults';
import { pinkCellIds } from '../core/crossTissue';
import { buildGeometry } from '../core/geometry';
import { pointInPolygon } from '../core/polygon';
import { withStructureOf } from '../core/layers';
import { onBodyImage } from '../core/bodyImage';
import { MODULES, moduleScene, shareScene, withHero, withoutTissueMap, withTissueMap, type TissueUpload } from '../core/modules';
import { hash, randomSeed } from '../core/rng';
import type { CellMap, LayerSpec, Pathway, Scene, Vec2 } from '../core/types';

/** One scene per module tab, all from the same seed so they show the same pathway. */
const TABS = MODULES.map((m) => moduleScene(m.kind, 1234));

interface AppState {
  /** One scene per module tab; `scene` is always `tabs[active]`. */
  tabs: Scene[];
  active: number;
  setTab: (index: number) => void;
  /** Copy this tab's look and pathway to every other tab (each keeps its module settings). */
  shareToAllTabs: () => void;
  /** A loaded scene file, into the current tab: it keeps the tab's module. */
  loadScene: (scene: Scene) => void;
  /** Use a body image (data URL; '' for none) in every tab that shows the body (Body, journey). */
  setBodyImage: (src: string) => void;
  scene: Scene;
  time: number;
  playing: boolean;
  setScene: (update: (s: Scene) => Scene) => void;
  /** Update one pathway. */
  setPathway: (index: number, update: (p: Pathway) => Pathway) => void;
  /**
   * Edit layers of one pathway. With "Same layer structure" on, structural
   * edits (add, remove, region) are applied to every pathway, each keeping its
   * own node counts; `countsOnly` edits always stay with their pathway.
   */
  editLayers: (index: number, update: (layers: LayerSpec[]) => LayerSpec[], opts?: { countsOnly?: boolean }) => void;
  /** 1–5 pathways. Extra pathways are kept when reducing, so raising the count restores them. */
  setPathwayCount: (n: number) => void;
  regenerateAll: () => void;
  regeneratePathway: (index: number) => void;
  setTime: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setCellMap: (update: (m: CellMap) => CellMap) => void;
  /**
   * Click on the map. On an uploaded tissue map with a selected cell, a click
   * selects the cell under it (in every view); with `toggle` (Alt) it adds or
   * removes that cell's pathways instead. On other maps a click toggles the
   * pathways. `reroll` (Shift) gives the cell a new layout.
   */
  clickMapCell: (p: Vec2, reroll: boolean, toggle?: boolean) => void;
  /** Cross-tissue: switch a cell (at a canvas point) between the first and the second colour. */
  togglePinkCell: (p: Vec2) => void;
  /** Use an uploaded tissue map in every view that shows cells, its middle cell selected. */
  setTissueMap: (map: TissueUpload) => void;
  /** Select a cell of the uploaded tissue map, in every view. */
  setHeroCell: (id: string) => void;
  /** Turn the shared tissue map to this many degrees from the SVG as uploaded, in every view. */
  rotateTissueMap: (deg: number) => void;
  /** Drop the uploaded tissue map: each view goes back to its own cell or generated tissue. */
  clearTissueMap: () => void;
}

/** State with the current tab's scene replaced. */
const put = (st: AppState, scene: Scene) => ({ scene, tabs: st.tabs.map((s, i) => (i === st.active ? scene : s)) });

export const useApp = create<AppState>((set) => ({
  tabs: TABS,
  active: 0,
  scene: TABS[0],
  setTab: (index) => set((st) => (index === st.active ? {} : { active: index, scene: st.tabs[index] })),
  shareToAllTabs: () =>
    set((st) => ({ tabs: st.tabs.map((s, i) => (i === st.active ? s : shareScene(st.scene, s))) })),
  loadScene: (loaded) =>
    set((st) => {
      // A file saved before modules existed takes the tab's module settings;
      // any other keeps its own settings but the tab's kind.
      const own = st.scene.module;
      const module = loaded.module.kind === 'custom' ? { ...own } : { ...loaded.module, kind: own.kind };
      return put(st, { ...loaded, module });
    }),
  setBodyImage: (src) =>
    set((st) => {
      const tabs = st.tabs.map((s) =>
        s.module.kind === 'body' || s.module.kind === 'journey' ? { ...s, module: { ...s.module, bodyImage: src } } : s,
      );
      return { tabs, scene: tabs[st.active] };
    }),
  time: 0,
  playing: false,
  setScene: (update) => set((st) => put(st, update(st.scene))),
  setPathway: (index, update) =>
    set((st) => put(st, { ...st.scene, pathways: st.scene.pathways.map((p, i) => (i === index ? update(p) : p)) })),
  editLayers: (index, update, opts) =>
    set((st) => {
      const { scene } = st;
      const shared = scene.sameLayersForAll && !opts?.countsOnly;
      const model = update(scene.pathways[index].layers);
      return put(st, {
        ...scene,
        pathways: scene.pathways.map((p, i) => {
          if (i === index) return { ...p, layers: model };
          if (!shared) return p;
          // Pathways share a structure, so the same index-based edit lines up;
          // fall back to copying the model if it somehow does not.
          return { ...p, layers: withStructureOf(update(p.layers), model) };
        }),
      });
    }),
  setPathwayCount: (n) =>
    set((st) => {
      const s = st.scene;
      const count = Math.max(1, Math.min(5, Math.round(n)));
      const pathways = [...s.pathways];
      for (let i = pathways.length; i < count; i++) {
        pathways.push({
          ...makePathway(s.seed, i, s.pathways[0].layers),
          startDelay: +(i * s.animation.pathwayStagger).toFixed(2),
        });
      }
      if (s.sameLayersForAll) {
        for (let i = 1; i < count; i++) pathways[i] = { ...pathways[i], layers: withStructureOf(pathways[i].layers, pathways[0].layers) };
      }
      return put(st, { ...s, pathwayCount: count, pathways });
    }),
  // New scene seed (outlines, decorative receptors) and new seeds for every unlocked pathway.
  regenerateAll: () =>
    set((st) => {
      const seed = randomSeed();
      return put(st, {
        ...st.scene,
        seed,
        pathways: st.scene.pathways.map((p, i) => (p.locked ? p : { ...p, seed: hash(seed, 'pathway', i) })),
      });
    }),
  regeneratePathway: (index) =>
    set((st) => put(st, {
      ...st.scene,
      pathways: st.scene.pathways.map((p, i) => (i === index ? { ...p, seed: randomSeed() } : p)),
    })),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setCellMap: (update) => set((st) => put(st, { ...st.scene, cellMap: update(st.scene.cellMap) })),
  togglePinkCell: (p) =>
    set((st) => {
      const g = buildGeometry(st.scene);
      const hit = g.cells.find((c) => pointInPolygon(p, c.cell.points));
      if (!hit) return {};
      const pink = pinkCellIds(st.scene, g.cells);
      if (pink.has(hit.id)) pink.delete(hit.id);
      else pink.add(hit.id);
      return put(st, { ...st.scene, module: { ...st.scene.module, pinkCells: [...pink] } });
    }),
  setTissueMap: (map) =>
    set((st) => {
      const probe = { ...st.scene, cellMap: { ...defaultCellMap(), viewBox: map.viewBox, cells: map.cells } };
      const hero = middleCellId(probe) ?? map.cells[0]?.id ?? '';
      const tabs = st.tabs.map((s) => withTissueMap(s, map, hero));
      return { tabs, scene: tabs[st.active] };
    }),
  setHeroCell: (id) =>
    set((st) => {
      const tabs = st.tabs.map((s) => withHero(s, id));
      return { tabs, scene: tabs[st.active] };
    }),
  rotateTissueMap: (deg) =>
    set((st) => {
      const tabs = st.tabs.map((s) => (heroCellOf(s.cellMap) ? { ...s, cellMap: rotateMap(s.cellMap, deg) } : s));
      return { tabs, scene: tabs[st.active] };
    }),
  clearTissueMap: () =>
    set((st) => {
      const tabs = st.tabs.map((s) => (heroCellOf(s.cellMap) ? withoutTissueMap(s) : s));
      return { tabs, scene: tabs[st.active] };
    }),
  clickMapCell: (p, reroll, toggle) =>
    set((st) => {
      // A solo view shows one cell: nothing to pick or switch off.
      if (soloActive(st.scene)) return {};
      const hit = mapCellAt(st.scene, p);
      if (!hit) return {};
      if (heroCellOf(st.scene.cellMap) && !reroll && !toggle) {
        const tabs = st.tabs.map((s) => withHero(s, hit.id));
        return { tabs, scene: tabs[st.active] };
      }
      // A tissue's cells are generated; storing them keeps each one's on/off and seed.
      const cells = mapCells(st.scene).map((c) =>
        c.id !== hit.id ? c : reroll ? { ...c, enabled: true, seed: randomSeed() } : { ...c, enabled: !c.enabled },
      );
      return put(st, { ...st.scene, cellMap: { ...st.scene.cellMap, cells } });
    }),
}));

// When a body image finishes loading, rebuild the scenes that use it (their
// geometry was made without it).
onBodyImage(() =>
  useApp.setState((st) => {
    const tabs = st.tabs.map((s) => (s.module.bodyImage ? { ...s } : s));
    return { tabs, scene: tabs[st.active] };
  }),
);
