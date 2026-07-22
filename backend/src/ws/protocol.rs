// =============================================================================
//  Protocole WebSocket de la Race (Room). Miroir de frontend/src/core/net.ts.
//
//  Le serveur possède la vérité terrain (seed/texte + t=0) : le client n'envoie
//  jamais le texte ni la durée de référence. Voir Docs/PHASE2.md.
//
//  Une Room a UNE clé, sous deux formes (ADR 0008) : un salon vocal ou un Code de
//  partie. D'où trois portes d'entrée distinctes plutôt qu'un `JoinRoom` générique —
//  elles n'ont pas les mêmes droits de création (voir `ws/mod.rs`).
// =============================================================================

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::domain::types::Keystroke;

/// Clé d'une Room : soit un `ChannelId`, soit un Code de partie. Les deux formes ne
/// peuvent pas se confondre — un snowflake fait 18-19 chiffres, un code en fait 5.
pub type RoomKey = String;
/// Identifiant de salon vocal Discord (snowflake).
pub type ChannelId = String;
/// Discord user ID (snowflake), toujours en string.
pub type PlayerId = String;

/// D'où vient le texte d'une Race (ADR 0009).
///
/// Ce n'est **pas** un Mode : la règle de fin d'une Race est toujours « le texte entier,
/// exactement ». Time signifierait une autre condition de fin et des voitures sans ligne
/// d'arrivée commune ; Zen n'a pas de fin du tout. Ce que le party leader choisit, c'est
/// la provenance du texte — le recompute autoritaire reste `Words` dans tous les cas.
///
/// Wire : `{"kind":"quote"}` ou `{"kind":"words","count":30}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TextSource {
    /// Citation via le proxy serveur. Sa longueur appartient à la citation, pas au lobby.
    Quote,
    /// Texte généré. `count` est le repli à durée maîtrisée : une citation de 400
    /// caractères imposerait une course longue à huit personnes sans échappatoire.
    Words { count: u32 },
}

impl Default for TextSource {
    /// Défaut = Quote, ce que demande le brief de la section D.
    fn default() -> Self {
        TextSource::Quote
    }
}

/// Longueur max d'un nom affiché. Ce n'est pas une règle Discord, c'est une protection
/// de mise en page : un nom de 4 000 caractères casserait la piste des SEPT autres.
const MAX_DISPLAY_NAME: usize = 32;
/// Longueur max d'un hash d'avatar Discord (32 hex, + le préfixe `a_` des animés).
const MAX_AVATAR_HASH: usize = 34;

/// La Display identity, **annoncée par le client** à la jointure.
///
/// Le serveur ne la résout PAS via `/users/@me` : le glossaire autorise un override de
/// pseudo qui appartient au device, et une résolution serveur l'écraserait. Elle n'est
/// donc ni vérifiée ni persistée — deux joueurs peuvent afficher le même nom, c'est assumé.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub display_name: String,
    /// Hash d'avatar Discord — **jamais une URL**. Chaque client reconstruit
    /// `cdn.discordapp.com/avatars/{id}/{hash}.png` lui-même : une URL fournie par un
    /// client serait une URL arbitraire chargée dans le navigateur des sept autres.
    pub avatar_hash: Option<String>,
}

impl Identity {
    /// Ramène une identité venue du réseau à quelque chose d'affichable sans danger.
    ///
    /// Le rendu client échappe déjà le HTML, donc le sujet ici n'est pas l'injection :
    /// c'est qu'un nom démesuré ou un hash fantaisiste dégradent l'écran des AUTRES.
    /// Un hash hors `[0-9a-f_]` est jeté plutôt que corrigé — il désignerait un chemin
    /// arbitraire sur le CDN, et l'avatar par défaut est une repli parfaitement valable.
    pub fn sanitized(self) -> Identity {
        let display_name: String = self
            .display_name
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_DISPLAY_NAME)
            .collect();
        let avatar_hash = self.avatar_hash.filter(|h| {
            !h.is_empty()
                && h.len() <= MAX_AVATAR_HASH
                && h.chars().all(|c| c.is_ascii_hexdigit() || c == '_')
        });
        Identity { display_name: display_name.trim().to_string(), avatar_hash }
    }
}

/// Un présent, tel que la piste et le podium le dessinent. `player_id` reste la vérité
/// durable (il possède les Runs) ; le reste n'est que la façon de le dessiner.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerEntry {
    pub player_id: PlayerId,
    pub display_name: String,
    pub avatar_hash: Option<String>,
}

/// Messages Client → Serveur.
/// Wire : JSON internally-tagged, ex. `{ "type": "JoinChannel", "channelId": "123" }`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ClientEvent {
    /// Rejoindre la Room du salon vocal courant, en la CRÉANT si elle n'existe pas.
    /// La clé vient du SDK Discord : elle est authentique, elle ne peut pas être
    /// mal tapée — d'où la création à la volée.
    JoinChannel { channel_id: ChannelId, identity: Identity },
    /// Créer une Room à Code de partie. Le serveur tire le code et le renvoie dans
    /// le `RoomState` qui suit.
    CreateRoom { identity: Identity },
    /// Rejoindre une Room par son Code de partie. Ne crée JAMAIS : un code vient du
    /// clavier d'un joueur, et créer sur une faute de frappe l'enfermerait seul dans
    /// une Room fantôme. Code inconnu → `RoomNotFound`.
    JoinCode { code: String, identity: Identity },
    /// Régler la Source de texte de la prochaine course — accepté du seul owner, et
    /// seulement hors course (ignoré sinon). Déclenche la regénération du texte.
    SetTextSource { source: TextSource },
    /// Lancer la course — accepté du seul owner de la Room (ignoré sinon).
    StartRace,
    /// Progression de frappe (diffusée pour le rendu des "voitures"). Pas autoritaire.
    Progress { chars_done: u32 },
    /// Soumission finale : log brut + durée. Le serveur recompute contre SON texte
    /// (seed/texte/config lui appartiennent — jamais renvoyés par le client).
    Finish { keystrokes: Vec<Keystroke>, ended_at_ms: f64 },
    LeaveRoom,
}

/// Messages Serveur → Client. `Clone` : diffusé via broadcast à tous les sockets.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all_fields = "camelCase")]
pub enum ServerEvent {
    /// État de la Room (présence + owner + config), re-diffusé à chaque join/leave.
    /// `code` porte le Code de partie quand la Room en a un — c'est ce qui permet à
    /// N'IMPORTE quel membre du lobby de le lire pour inviter, pas seulement au
    /// créateur. `None` pour une Room de salon vocal.
    RoomState {
        /// Les présents AVEC leur Display identity — c'est ce que la piste dessine.
        players: Vec<PlayerEntry>,
        owner: PlayerId,
        seed: u64,
        target_text: String,
        code: Option<String>,
        /// Source EFFECTIVE du texte affiché. Un repli après échec du proxy de citations
        /// se lit donc ici : la Room bascule réellement sur `Words`, il n'y a pas de
        /// « Quote demandée mais pas obtenue » à représenter en plus.
        text_source: TextSource,
    },
    /// Top de départ partagé : t=0 pour TOUS les clients (cale les horloges locales).
    RaceStart { start_at_epoch_ms: i64 },
    /// Position d'un adversaire (rendu temps réel).
    PlayerProgress { player_id: PlayerId, chars_done: u32 },
    /// Scoreboard autoritaire d'un joueur ayant fini (recompute serveur).
    PlayerFinished { player_id: PlayerId, wpm: f64 },
    /// Classement final.
    RaceOver { ranking: Vec<PlayerId> },
    /// Code de partie inconnu. Envoyé au SEUL socket demandeur (pas de diffusion :
    /// il n'y a aucune Room à qui le diffuser). Le socket reste ouvert — le joueur
    /// corrige son code et retente sans se reconnecter.
    RoomNotFound,
    /// Room déjà à `MAX_PLAYERS`. Même traitement : réponse directe, socket gardé.
    RoomFull,
}
