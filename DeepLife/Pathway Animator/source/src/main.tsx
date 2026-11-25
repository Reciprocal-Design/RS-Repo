import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { setSequenceSources } from './core/sequence';
import { startAutosave } from './ui/persist';
import { useApp } from './ui/store';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startAutosave(useApp);
// The sequence tab plays the other tabs as they are set up.
setSequenceSources(useApp.getState().tabs);
useApp.subscribe((s, prev) => s.tabs !== prev.tabs && setSequenceSources(s.tabs));

// Dev only: lets scripts drive the store (e.g. screenshot checks).
if (import.meta.env.DEV) (window as unknown as { __app: typeof useApp }).__app = useApp;
