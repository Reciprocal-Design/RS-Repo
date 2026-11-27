import { defaultModule } from '../core/defaults';
import { MODULES, TAB_LAYER_DURATION, TISSUE_ALL_ACTIVE } from '../core/modules';
import { normalizeScene } from '../core/sceneIO';
import type { ModuleKind, Scene } from '../core/types';

// The app's last settings, kept in this browser: every tab's scene and the
// open tab, saved a moment after each change and restored on the next load.

const KEY = 'pathway-animator:settings:v1';
const OLD_SEQUENCE_TABS = 'moa,combination,toxicity,tissue,crossTissue,body';
const SLOW: ModuleKind[] = ['moa', 'combination', 'toxicity', 'tissue', 'crossTissue'];
const OLD_TAB_SPEEDS = [0.5, 0.8, 1];
let stopped = false;

/**
 * The saved tabs, matched to the app's tabs by module: a tab added since they
 * were saved has none (null), and starts from its defaults.
 */
export function loadSaved(): { tabs: (Scene | null)[]; active: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { tabs?: unknown[]; active?: unknown };
    if (!Array.isArray(data.tabs)) return null;
    const saved: Scene[] = [];
    for (const t of data.tabs) {
      try {
        saved.push(normalizeScene(t));
      } catch {
        /* skip a tab that no longer reads */
      }
    }
    const tabs = MODULES.map((m) => saved.find((s) => s.module.kind === m.kind) ?? null);
    for (const s of tabs) {
      // The sequence's first default played the body last; it no longer does.
      if (s?.module.kind === 'sequence' && s.module.seqTabs.join() === OLD_SEQUENCE_TABS) {
        s.module = { ...s.module, seqTabs: defaultModule('sequence').seqTabs };
      }
      // Tabs 1–5 saved at an earlier default pulse speed (0.5, 0.8, then 1 s a layer) get the current one.
      if (s && SLOW.includes(s.module.kind) && OLD_TAB_SPEEDS.includes(s.animation.layerDuration)) {
        s.animation = { ...s.animation, layerDuration: TAB_LAYER_DURATION };
      }
      // Tabs 4 and 5 used to spread the signal out from the selected cell (a long loop); now every cell is active.
      const cm = s?.cellMap;
      if (s && cm && (s.module.kind === 'tissue' || s.module.kind === 'crossTissue') && cm.startShare === 0 && cm.relayHops === 4) {
        s.cellMap = { ...cm, ...TISSUE_ALL_ACTIVE };
      }
    }
    if (!tabs.some(Boolean)) return null;
    const active = typeof data.active === 'number' && data.active >= 0 && data.active < tabs.length ? Math.floor(data.active) : 0;
    return { tabs, active };
  } catch {
    return null;
  }
}

function write(tabs: Scene[], active: number) {
  if (stopped) return;
  // `frame` is derived on the fly; never store it.
  const plain = tabs.map(({ cellMap: { frame: _f, ...cellMap }, ...s }) => ({ ...s, cellMap }));
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs: plain, active }));
  } catch {
    // Too big for the browser's storage (a large body image): keep everything else.
    try {
      const lean = plain.map((s) => ({ ...s, module: { ...s.module, bodyImage: '' } }));
      localStorage.setItem(KEY, JSON.stringify({ tabs: lean, active }));
    } catch {
      /* storage unavailable: nothing to do */
    }
  }
}

interface Store {
  getState: () => { tabs: Scene[]; active: number };
  subscribe: (fn: (s: { tabs: Scene[]; active: number }, prev: { tabs: Scene[]; active: number }) => void) => () => void;
}

/** Save the tabs a moment after each change, and when the page is left. */
export function startAutosave(store: Store) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const { tabs, active } = store.getState();
    write(tabs, active);
  };
  store.subscribe((s, prev) => {
    if (s.tabs === prev.tabs && s.active === prev.active) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 400);
  });
  addEventListener('pagehide', () => timer && flush());
}

/** Forget the saved settings (and stop saving), so the next load starts from the defaults. */
export function clearSaved() {
  stopped = true;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing saved */
  }
}
