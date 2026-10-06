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
  // React and the UI kit change rarely, so they get their own files that browsers keep across releases;
  // each page is loaded on first use (React.lazy in app/page.tsx).
  build: {outDir: '../public/tier1-next', emptyOutDir: true, sourcemap: false, rolldownOptions: {output: {manualChunks(id) {
    if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
    if (/node_modules[\\/](@base-ui|@floating-ui|lucide-react|tailwind-merge|clsx|class-variance-authority)[\\/]/.test(id)) return 'ui';
  }}}},
  // Scripts and styles find their siblings relative to themselves, so the bundle also works under /admin/ for support.
  experimental: {renderBuiltUrl: (_file, {hostType}) => hostType === 'html' ? undefined : {relative: true}},
});
