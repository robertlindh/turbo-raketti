import { defineConfig } from "vite";
import { resolve } from "node:path";

// GitHub Pages serves the site under https://<user>.github.io/turbo-rakketti/
// so all built asset URLs must be prefixed with /turbo-rakketti/. During dev
// (`npm run dev`) base stays "/" so localhost links don't break.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/turbo-rakketti/" : "/",
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html"),
      },
    },
  },
}));
