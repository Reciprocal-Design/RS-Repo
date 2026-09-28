import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The built app is written one level up, so the tool folder itself
// (DeepLife/Pathway Animator/) serves as the static page on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '..',
    emptyOutDir: false,
  },
});
