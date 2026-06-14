import { defineConfig } from "vite";

// Config Vite minimale. L'origine UNIQUE (livrable #3) : en prod, ce build statique
// est servi par le backend Rust, qui expose aussi /api et /token sur le même hôte.
// En dev, `server.proxy` renvoie ces routes vers le backend local (port 8080) pour
// que `fetch("/api/...")` fonctionne sans CORS.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/token": "http://localhost:8080",
    },
  },
  build: {
    outDir: "dist",
  },
});
