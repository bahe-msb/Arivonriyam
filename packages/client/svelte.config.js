import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
  },
  kit: {
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: "index.html",
      precompress: false,
      strict: true,
    }),
    // Barrel-only aliases. Each alias resolves to a folder whose `index.ts`
    // is the single public surface. Subpath imports (e.g. "@shadcn/button")
    // are intentionally not configured — everything flows through the barrel.
    alias: {
      "@components": "./src/lib/components",
      "@mocks": "./src/lib/mocks",
      "@lib": "./src/lib",
      "@features": "./src/features",
      "@stores": "./src/stores",
      "@utils": "./src/utils",
      "@shadcn": "./src/shadcn",
      "@assets": "./src/assets",
    },
  },
};

export default config;
