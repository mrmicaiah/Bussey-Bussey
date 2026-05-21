import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Proxy /api/* to the Worker (wrangler dev on :8787) so the browser sees a
// single origin and HttpOnly cookies set by the Worker are sent on every API
// request without CORS gymnastics.
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
