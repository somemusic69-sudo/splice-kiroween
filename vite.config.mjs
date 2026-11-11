import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        cockpit: fileURLToPath(new URL('./index.html', import.meta.url)),
        setup: fileURLToPath(new URL('./setup.html', import.meta.url)),
      },
    },
  },
});
