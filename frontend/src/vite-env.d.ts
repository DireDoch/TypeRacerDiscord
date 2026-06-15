/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Client ID Discord (public). Absent → MODE DEV : pas de handshake, token de test. */
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
