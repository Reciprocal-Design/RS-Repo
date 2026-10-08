import { create } from 'zustand';
import { makePathway } from '../core/defaults';
import { mapCellAt, mapCells } from '../core/cellMap';
import { withStructureOf } from '../core/layers';
import { MODULES, moduleScene, shareScene } from '../core/modules';
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
  /** Click on the map: toggle that cell's pathways, or with `reroll`, give it a new layout. */
  clickMapCell: (p: Vec2, reroll: boolean) => void;
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
  clickMapCell: (p, reroll) =>
    set((st) => {
      const hit = mapCellAt(st.scene, p);
      if (!hit) return {};
      // A tissue's cells are generated; storing them keeps each one's on/off and seed.
      const cells = mapCells(st.scene).map((c) =>
        c.id !== hit.id ? c : reroll ? { ...c, enabled: true, seed: randomSeed() } : { ...c, enabled: !c.enabled },
      );
      return put(st, { ...st.scene, cellMap: { ...st.scene.cellMap, cells } });
    }),
}));
