import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useApp } from './ui/store';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev only: lets scripts drive the store (e.g. screenshot checks).
if (import.meta.env.DEV) (window as unknown as { __app: typeof useApp }).__app = useApp;
