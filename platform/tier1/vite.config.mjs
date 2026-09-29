import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/tier1-next/',
  plugins: [react(), {name:'font-license',generateBundle(){this.emitFile({type:'asset',fileName:'assets/geist-OFL.txt',source:readFileSync(new URL('./src/fonts/OFL.txt',import.meta.url),'utf8')});}}],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  css: {postcss: {plugins: [tailwind()]}},
  build: {outDir: '../public/tier1-next', emptyOutDir: true, sourcemap: false},
  // Scripts and styles find their siblings relative to themselves, so the bundle also works under /admin/ for support.
  experimental: {renderBuiltUrl: (_file, {hostType}) => hostType === 'html' ? undefined : {relative: true}},
});
