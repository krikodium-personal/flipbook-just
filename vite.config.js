import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // En desarrollo, la API la sirve `npm run dev:api` (wrangler pages dev) en el puerto 8788
  server: { proxy: { '/api': 'http://localhost:8788' } },
  build: {
    rollupOptions: {
      input: {
        root: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'catalogo.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
        editor: resolve(import.meta.dirname, 'admin/editor.html'),
      },
    },
  },
});
