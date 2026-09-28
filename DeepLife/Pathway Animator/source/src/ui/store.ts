import { create } from 'zustand';
import { defaultScene } from '../core/defaults';
import { hash, randomSeed } from '../core/rng';
import type { LayerSpec, Pathway, Scene } from '../core/types';

interface AppState {
  scene: Scene;
  time: number;
  playing: boolean;
  setScene: (update: (s: Scene) => Scene) => void;
  /** Update one pathway. */
  setPathway: (index: number, update: (p: Pathway) => Pathway) => void;
  /** Edit layers of one pathway, or of every pathway when "Same layers for all" is on. */
  editLayers: (index: number, update: (layers: LayerSpec[]) => LayerSpec[]) => void;
  regenerateAll: () => void;
  regeneratePathway: (index: number) => void;
  setTime: (t: number) => void;
}

export const useApp = create<AppState>((set) => ({
  scene: defaultScene(),
  time: 0,
  playing: false,
  setScene: (update) => set((st) => ({ scene: update(st.scene) })),
  setPathway: (index, update) =>
    set((st) => ({
      scene: { ...st.scene, pathways: st.scene.pathways.map((p, i) => (i === index ? update(p) : p)) },
    })),
  editLayers: (index, update) =>
    set((st) => {
      const { scene } = st;
      const next = update(scene.pathways[index].layers);
      return {
        scene: {
          ...scene,
          pathways: scene.pathways.map((p, i) =>
            i === index || scene.sameLayersForAll ? { ...p, layers: next.map((l) => ({ ...l })) } : p,
          ),
        },
      };
    }),
  // New scene seed (outlines, decorative receptors) and new seeds for every unlocked pathway.
  regenerateAll: () =>
    set((st) => {
      const seed = randomSeed();
      return {
        scene: {
          ...st.scene,
          seed,
          pathways: st.scene.pathways.map((p, i) => (p.locked ? p : { ...p, seed: hash(seed, 'pathway', i) })),
        },
      };
    }),
  regeneratePathway: (index) =>
    set((st) => ({
      scene: {
        ...st.scene,
        pathways: st.scene.pathways.map((p, i) => (i === index ? { ...p, seed: randomSeed() } : p)),
      },
    })),
  setTime: (time) => set({ time }),
}));
