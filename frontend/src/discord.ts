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

/** Le handshake n'a lieu qu'une fois : on mémorise la promesse du token. */
let tokenPromise: Promise<string> | null = null;

/**
 * Retourne le Bearer token à joindre aux appels `/api/*`.
 * Idempotent : le handshake Discord (ou le repli dev) ne s'exécute qu'une fois.
 */
export function getAuthToken(): Promise<string> {
  if (!tokenPromise) {
    // En cas d'échec, on oublie la promesse pour autoriser une nouvelle tentative.
    tokenPromise = resolveToken().catch((e) => {
      tokenPromise = null;
      throw e;
    });
  }
  return tokenPromise;
}

/** true si la page tourne dans l'iframe d'une Activity Discord (param `frame_id` injecté). */
function isInsideDiscord(): boolean {
  return new URLSearchParams(window.location.search).has("frame_id");
}

async function resolveToken(): Promise<string> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;

  // Hors Discord ou non configuré → token de dev (le backend en mode dev s'en sert
  // directement comme player_id ; on reste jouable au navigateur seul).
  if (!clientId || !isInsideDiscord()) {
    return DEV_TOKEN;
  }

  // Import dynamique : le SDK n'est chargé que lorsqu'on est réellement dans Discord.
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });

  const res = await fetch("/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`POST /token → ${res.status}`);
  const { access_token }: TokenResponse = await res.json();

  await sdk.commands.authenticate({ access_token });
  return access_token;
}
