import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Portal dev server runs on :5174 to avoid colliding with admin on :5173.
// Proxy /api/* to the Worker (wrangler dev on :8787) so the browser sees a
// single origin and the HttpOnly bb_portal_session cookie set by the Worker
// is sent on every API request without CORS gymnastics.
export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
