// =============================================================================
//  discord.ts — handshake d'identité côté client (Embedded App SDK).
//
//  Fournit le Bearer token envoyé à POST /api/runs. Le serveur résout le player_id
//  depuis ce token (scope `identify`) — il n'est JAMAIS dans le corps (voir CONTEXT.md
//  « Identité »). Le secret client reste serveur : on n'échange ici que le `code`.
//
//  Flux (dans Discord) :
//    1. DiscordSDK.ready()
//    2. commands.authorize({ scope: ['identify'] })            → { code }
//    3. POST /token { code }                                    → { access_token }
//    4. commands.authenticate({ access_token })                 → session liée
//    5. on renvoie l'access_token (= Bearer des appels /api/*)
//
//  MODE DEV (hors Discord, ou VITE_DISCORD_CLIENT_ID absent) : pas de handshake. On
//  renvoie un token de test que le backend en mode dev accepte tel quel comme player_id.
// =============================================================================

import type { TokenResponse } from "./core/types";

const DEV_TOKEN = "dev-player-1";

/** Identité résolue une fois : token (Bearer), player_id (= identité serveur) et
 *  channelId (salon Discord = clé de Room pour la Race). */
export interface Identity {
  token: string;
  playerId: string;
  channelId: string;
}

/** Le handshake n'a lieu qu'une fois : on mémorise la promesse d'identité. */
let identityPromise: Promise<Identity> | null = null;

/** Identité complète (Race incluse). Idempotent : handshake une seule fois. */
export function getIdentity(): Promise<Identity> {
  if (!identityPromise) {
    identityPromise = resolveIdentity().catch((e) => {
      identityPromise = null; // échec : on autorise une nouvelle tentative
      throw e;
    });
  }
  return identityPromise;
}

/** Bearer token pour les appels `/api/*` (rétro-compat Practice). */
export async function getAuthToken(): Promise<string> {
  return (await getIdentity()).token;
}

/** true si la page tourne dans l'iframe d'une Activity Discord (param `frame_id` injecté). */
export function isInsideDiscord(): boolean {
  return new URLSearchParams(window.location.search).has("frame_id");
}

/**
 * Préfixe réseau OBLIGATOIRE dans l'iframe Discord : la CSP de discordsays.com
 * bloque toute requête (fetch, WebSocket) qui ne passe pas par `/.proxy/…` —
 * le proxy Discord retire le préfixe avant d'appliquer les URL Mappings, le
 * backend voit donc les chemins inchangés. Hors Discord : préfixe vide.
 */
export function proxyBase(): string {
  return isInsideDiscord() ? "/.proxy" : "";
}

/** Ferme l'Activity (bouton Quitter du menu). No-op hors Discord ou avant le handshake. */
let closeSdk: (() => void) | null = null;
export function closeActivity(): void {
  closeSdk?.();
}

async function resolveIdentity(): Promise<Identity> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const params = new URLSearchParams(window.location.search);

  // Hors Discord ou non configuré → identité de dev. `?token=` distingue plusieurs
  // onglets (le backend en mode dev s'en sert directement comme player_id) ;
  // `?channel=` choisit la Room. On reste jouable au navigateur seul.
  if (!clientId || !isInsideDiscord()) {
    const token = params.get("token") || DEV_TOKEN;
    return { token, playerId: token, channelId: params.get("channel") || "dev-room" };
  }

  // Import dynamique : le SDK n'est chargé que lorsqu'on est réellement dans Discord.
  const { DiscordSDK, RPCCloseCodes } = await import("@discord/embedded-app-sdk");
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  closeSdk = () => void sdk.close(RPCCloseCodes.CLOSE_NORMAL, "Fermé depuis le menu");

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  const res = await fetch(`${proxyBase()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`POST /token → ${res.status}`);
  const { access_token }: TokenResponse = await res.json();

  const auth = await sdk.commands.authenticate({ access_token });
  return {
    token: access_token,
    playerId: auth.user.id,
    channelId: sdk.channelId ?? "dm",
  };
}
