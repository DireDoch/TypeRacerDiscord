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

import type { DiscordSDK } from "@discord/embedded-app-sdk";
import type { TokenResponse } from "./core/types";

const DEV_TOKEN = "dev-player-1";

/** Identité résolue une fois : token (Bearer), player_id (= identité serveur) et
 *  channelId (salon Discord = l'une des deux formes de clé de Room, ADR 0008). */
export interface Identity {
  token: string;
  playerId: string;
  channelId: string;
  /** Display identity : annoncée à la Room, affichée le temps de la session, jamais
   *  persistée ni vérifiée (CONTEXT.md). Le serveur ne la résout pas lui-même. */
  displayName: string;
  /** Hash d'avatar Discord, jamais une URL — voir `avatarUrl`. */
  avatarHash: string | null;
}

/**
 * URL CDN d'un avatar, reconstruite LOCALEMENT : aucune URL ne voyage sur le fil, seul
 * le hash le fait (une URL fournie par un client serait chargée chez les sept autres).
 * Sans hash, on tombe sur l'avatar Discord par défaut, dérivé du snowflake.
 *
 * ponytail: le repli visuel est l'initiale rendue DERRIÈRE l'image (voir `.car` dans
 * style.css), pas un `onerror` en JS. Ça couvre aussi le cas où la CSP de l'iframe
 * bloquerait le CDN — si ça arrive en vrai, la correction est un URL Mapping Discord
 * vers cdn.discordapp.com et un préfixe `proxyBase()` ici, pas du code de repli.
 */
export function avatarUrl(playerId: string, avatarHash: string | null): string {
  if (avatarHash) {
    return `https://cdn.discordapp.com/avatars/${playerId}/${avatarHash}.png?size=64`;
  }
  // Discord : (snowflake >> 22) % 6 pour les comptes migrés. En mode dev le playerId
  // n'est pas numérique (`dev-player-1`) — on ne tente pas le BigInt.
  const i = /^\d+$/.test(playerId) ? Number((BigInt(playerId) >> 22n) % 6n) : 0;
  return `https://cdn.discordapp.com/embed/avatars/${i}.png`;
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

/** SDK courant, pour `updateActivity` — `null` hors Discord ou avant le handshake (issue #111). */
let activitySdk: DiscordSDK | null = null;

/**
 * Écran/état affiché au Player, pour la Rich Presence (issue #111). `lobby`/`race`/
 * `floorIsLava`/`spam` viennent de `Race` (le Mode de jeu et la phase de la Room) ;
 * `menu`/`practice` viennent de `main.ts` au changement d'écran.
 */
export type ActivityState = "menu" | "practice" | "lobby" | "race" | "floorIsLava" | "spam";

/**
 * Un couple (texte, clé d'asset) par état — POUR AJOUTER UN ÉTAT : une entrée ici, rien
 * ailleurs. `largeImageKey` doit correspondre à une clé uploadée sur le portail
 * développeur Discord (issues d'art) ; une clé absente n'y fait pas planter l'appel,
 * Discord retombe silencieusement sur l'image par défaut.
 */
const ACTIVITY_PRESETS: Record<ActivityState, { details: string; largeImageKey: string }> = {
  menu: { details: "Dans le menu", largeImageKey: "menu" },
  practice: { details: "S'entraîne", largeImageKey: "practice" },
  lobby: { details: "Dans un salon", largeImageKey: "lobby" },
  race: { details: "En course", largeImageKey: "race" },
  floorIsLava: { details: "Floor is lava", largeImageKey: "floor-is-lava" },
  spam: { details: "Mode Spam", largeImageKey: "spam" },
};

/**
 * Pousse l'état courant en Rich Presence. No-op hors Discord / avant le handshake, comme
 * `closeActivity`. Le petit visuel reste le logo de l'app (badge constant) ; seul le grand
 * visuel change avec l'état.
 */
export function updateActivity(activityState: ActivityState): void {
  if (!activitySdk) return;
  const preset = ACTIVITY_PRESETS[activityState];
  void activitySdk.commands
    .setActivity({
      activity: {
        type: 0,
        details: preset.details,
        assets: { large_image: preset.largeImageKey, large_text: preset.details, small_image: "app-icon" },
      },
    })
    .catch(() => {}); // décoratif : une Rich Presence en échec ne doit pas se voir ailleurs
}

async function resolveIdentity(): Promise<Identity> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;
  const params = new URLSearchParams(window.location.search);

  // Hors Discord ou non configuré → identité de dev. `?token=` distingue plusieurs
  // onglets (le backend en mode dev s'en sert directement comme player_id) ;
  // `?channel=` choisit la Room. On reste jouable au navigateur seul.
  if (!clientId || !isInsideDiscord()) {
    const token = params.get("token") || DEV_TOKEN;
    return {
      token,
      playerId: token,
      channelId: params.get("channel") || "dev-room",
      displayName: params.get("name") || token, // `?name=` pour distinguer deux onglets
      avatarHash: null,
    };
  }

  // Import dynamique : le SDK n'est chargé que lorsqu'on est réellement dans Discord.
  const { DiscordSDK, RPCCloseCodes } = await import("@discord/embedded-app-sdk");
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  closeSdk = () => void sdk.close(RPCCloseCodes.CLOSE_NORMAL, "Fermé depuis le menu");
  activitySdk = sdk;

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
  // `global_name` est le nom d'affichage moderne ; `username` reste le repli des vieux
  // comptes. Le SDK ne le type pas toujours, d'où la vue étroite.
  const user = auth.user as { id: string; username: string; global_name?: string | null; avatar?: string | null };
  return {
    token: access_token,
    playerId: user.id,
    channelId: sdk.channelId ?? "dm",
    displayName: user.global_name || user.username,
    avatarHash: user.avatar ?? null,
  };
}
