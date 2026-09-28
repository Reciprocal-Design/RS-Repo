import { create } from 'zustand';
import { defaultScene } from '../core/defaults';
import { hash, randomSeed } from '../core/rng';
import type { Scene } from '../core/types';

interface AppState {
  scene: Scene;
  time: number;
  playing: boolean;
  setScene: (update: (s: Scene) => Scene) => void;
  regenerateAll: () => void;
  setTime: (t: number) => void;
}

export const useApp = create<AppState>((set) => ({
  scene: defaultScene(),
  time: 0,
  playing: false,
  setScene: (update) => set((st) => ({ scene: update(st.scene) })),
  // New scene seed (outlines, decorative receptors) and new seeds for every unlocked pathway.
  regenerateAll: () =>
    set((st) => {
      const seed = randomSeed();
      return {
        scene: {
          ...st.scene,
          seed,
          pathways: st.scene.pathways.map((p, i) =>
            p.locked ? p : { ...p, seed: hash(seed, 'pathway', i) },
          ),
        },
      };
    }),
  setTime: (time) => set({ time }),
}));
