import { describe, expect, it } from 'vitest';
import { MODULES, moduleScene } from '../core/modules';
import { clearSaved, loadSaved, startAutosave } from './persist';
import type { Scene } from '../core/types';

const mem = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  },
  addEventListener: () => {},
});

/** A minimal store: state plus subscribers, like zustand's. */
function fakeStore(tabs: Scene[]) {
  let state = { tabs, active: 0 };
  const subs: ((s: typeof state, p: typeof state) => void)[] = [];
  return {
    getState: () => state,
    subscribe: (fn: (s: typeof state, p: typeof state) => void) => (subs.push(fn), () => {}),
    set: (next: Partial<typeof state>) => {
      const prev = state;
      state = { ...state, ...next };
      subs.forEach((f) => f(state, prev));
    },
  };
}

describe('saved settings', () => {
  it('saves every tab after a change and loads them back on the next start', async () => {
    const tabs = MODULES.map((m) => moduleScene(m.kind, 1234));
    const store = fakeStore(tabs);
    startAutosave(store);
    expect(loadSaved()).toBeNull();
    const edited = tabs.map((s, i) => (i === 2 ? { ...s, canvas: { ...s.canvas, background: '#123456' }, seed: 99 } : s));
    store.set({ tabs: edited, active: 2 });
    await new Promise((r) => setTimeout(r, 450));
    const saved = loadSaved();
    expect(saved?.active).toBe(2);
    expect(saved?.tabs).toHaveLength(MODULES.length);
    expect(saved?.tabs[2]).toMatchObject({ seed: 99, canvas: { background: '#123456' } });
    expect(saved?.tabs.map((s) => s?.module.kind)).toEqual(MODULES.map((m) => m.kind));
  });

  it('matches saved tabs by module (a tab added since starts fresh), and forgets them on reset', () => {
    mem.set('pathway-animator:settings:v1', JSON.stringify({ tabs: [moduleScene('moa', 5), moduleScene('body', 6)], active: 0 }));
    const saved = loadSaved();
    expect(saved?.tabs[MODULES.findIndex((m) => m.kind === 'moa')]?.seed).toBe(5);
    expect(saved?.tabs[MODULES.findIndex((m) => m.kind === 'body')]?.seed).toBe(6);
    expect(saved?.tabs.filter(Boolean)).toHaveLength(2);
    // A sequence saved with its first default list (ending on the body) drops the body; any other list is kept.
    const seq = (seqTabs: string[]) => {
      const s = moduleScene('sequence', 1);
      mem.set('pathway-animator:settings:v1', JSON.stringify({ tabs: [{ ...s, module: { ...s.module, seqTabs } }], active: 0 }));
      return loadSaved()?.tabs.find((t) => t?.module.kind === 'sequence')?.module.seqTabs;
    };
    expect(seq(['moa', 'combination', 'toxicity', 'tissue', 'crossTissue', 'body'])).toEqual(['moa', 'combination', 'toxicity', 'tissue', 'crossTissue']);
    expect(seq(['body', 'moa'])).toEqual(['body', 'moa']);
    // Tabs 4 and 5 saved when they spread the signal out from one cell: every cell active now; own settings kept.
    const tissue = (cellMap: object) => {
      const s = moduleScene('tissue', 1);
      mem.set('pathway-animator:settings:v1', JSON.stringify({ tabs: [{ ...s, cellMap: { ...s.cellMap, ...cellMap } }], active: 0 }));
      return loadSaved()?.tabs.find((t) => t?.module.kind === 'tissue')?.cellMap;
    };
    expect(tissue({ startShare: 0, relayHops: 4, stagger: 3 })).toMatchObject({ startShare: 1, relayHops: 0, stagger: 1 });
    expect(tissue({ startShare: 0.5, relayHops: 2 })).toMatchObject({ startShare: 0.5, relayHops: 2 });
    // Tabs 1–5 saved at the old pulse speed get the slower one; a speed of their own is kept.
    const speed = (kind: 'moa' | 'body', layerDuration: number) => {
      const s = moduleScene(kind, 1);
      mem.set('pathway-animator:settings:v1', JSON.stringify({ tabs: [{ ...s, animation: { ...s.animation, layerDuration } }], active: 0 }));
      return loadSaved()?.tabs.find((t) => t?.module.kind === kind)?.animation.layerDuration;
    };
    expect(speed('moa', 0.5)).toBe(0.8);
    expect(speed('moa', 0.6)).toBe(0.6);
    expect(speed('body', 0.5)).toBe(0.5);
    mem.set('pathway-animator:settings:v1', JSON.stringify({ tabs: [], active: 0 }));
    expect(loadSaved()).toBeNull();
    mem.set('pathway-animator:settings:v1', 'not json');
    expect(loadSaved()).toBeNull();
    clearSaved();
    expect(mem.size).toBe(0);
  });
});
