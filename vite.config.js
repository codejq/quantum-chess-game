import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
});
