import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html', // SPA mode — every route resolves to index.html and the client router takes over.
    }),
    paths: {
      base: '/portal',
    },
    typescript: {
      config: (c) => ({
        ...c,
        compilerOptions: { ...c.compilerOptions, verbatimModuleSyntax: false },
      }),
    },
  },
};

export default config;
