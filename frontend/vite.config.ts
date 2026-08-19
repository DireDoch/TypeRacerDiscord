import { defineConfig } from "vite";

// Config Vite minimale. L'origine UNIQUE (livrable #3) : en prod, ce build statique
// est servi par le backend Rust, qui expose aussi /api et /token sur le même hôte.
// En dev, `server.proxy` renvoie ces routes vers le backend local (port 8080) pour
// que `fetch("/api/...")` fonctionne sans CORS.
export default defineConfig({
  // Le dépôt n'a QU'UN fichier d'environnement, à sa racine. Vite ne remonte pas
  // les dossiers parents tout seul (contrairement à `dotenvy` côté backend) :
  // sans `envDir`, il faudrait un second `.env` ici, avec la même variable
  // recopiée — et deux copies d'une même valeur finissent par diverger.
  //
  // Seules les variables préfixées `VITE_` sont injectées dans le bundle
  // (`envPrefix` par défaut). Pointer `envDir` sur la racine n'expose donc PAS
  // `DISCORD_CLIENT_SECRET` au client, même s'il vit dans le même fichier.
  envDir: "..",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8080",
      "/token": "http://localhost:8080",
      "/ws": { target: "http://localhost:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
