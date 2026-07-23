// =============================================================================
//  ws/mod.rs — état partagé des Rooms + boucle socket (Phase 2).
//
//  Câblé au routeur Axum via `/ws` (voir main.rs).
//   - Une Room est indexée par une CLÉ, sous deux formes (ADR 0008) : le salon vocal
//     (`channel_id`, créée à la volée — la clé vient du SDK, elle est authentique) ou
//     un Code de partie (créée seulement sur `CreateRoom`, jamais à la volée : un code
//     vient d'un clavier, une faute de frappe enfermerait le joueur seul dans une Room
//     fantôme). Une seule HashMap, aucune table de correspondance.
//   - Présence : JoinChannel/CreateRoom/JoinCode enregistrent le joueur, LeaveRoom /
//     déconnexion le retire. Chaque changement re-DIFFUSE RoomState (présence + owner
//     + code) à tous les sockets de la Room via un broadcast::Sender par Room.
//     Plafond de MAX_PLAYERS présents ; au-delà, RoomFull.
//   - Owner = premier joueur à rejoindre ; passe au suivant s'il part. Seul l'owner
//     peut lancer : StartRace → RaceStart{start_at_epoch_ms} diffusé à tous (t=0).
//     Les PARTANTS sont figés au RaceStart : arrivées/départs en cours de course ne
//     bloquent ni ne clôturent la fin (voir all_racers_done).
//   - Le serveur possède la vérité terrain : seed + texte cible générés à la création
//     de la Room (domain::text_gen), regénérés après chaque course (revanche).
//   - Progress relayé (barres live) ; Finish → recompute autoritaire → RaceOver.
// =============================================================================

#![allow(dead_code)]

pub mod protocol;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use sqlx::sqlite::SqlitePool;
use tokio::sync::broadcast;

use crate::domain::replay::{compute_scoreboard, ScoreInput};
use crate::domain::text_gen::{generate_text, GenSettings};
use crate::domain::types::{Keystroke, Mode, RunConfig};
use crate::quote::QuoteClient;
use protocol::{
    ClientEvent, Identity, PlayOfTheGame, PlayerEntry, PlayerId, RaceResult, RoomKey, ServerEvent,
    TextSource,
};

/// Longueur d'un texte `Words` en Race — les trois seules valeurs acceptées (ADR 0009).
/// Un `count` arbitraire venu du client imposerait une course de longueur quelconque aux
/// sept autres : c'est une frontière de confiance, pas une commodité d'affichage.
const WORDS_LENGTHS: [u32; 3] = [15, 30, 50];
/// Longueur par défaut et de repli (échec du proxy de citations).
const ROOM_WORD_COUNT: u32 = 30;
/// Profondeur du canal de diffusion par Room (messages en vol tolérés).
const BROADCAST_CAP: usize = 64;
/// Plafond de présents dans une Room. Porte sur `players`, donc un spectateur arrivé
/// en cours de course occupe une place comme un autre.
const MAX_PLAYERS: usize = 8;
/// Alphabet des Codes de partie : ni `0`/`O`, ni `1`/`I`/`L` — un code se dicte à
/// l'oral, l'ambiguïté visuelle y coûte cher. 31 caractères.
const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/// Longueur d'un Code de partie. 5 → ~28 M de combinaisons, et surtout AUCUN
/// recouvrement possible avec un snowflake Discord (18-19 chiffres) : les deux formes
/// de clé cohabitent dans la même map sans désambiguïsation.
const CODE_LEN: usize = 5;

/// État de course d'une Room (issue #18) — remplace trois champs mutés indépendamment
/// (`start_at_epoch_ms: Option`, `racers: Vec`, `finishers: Vec` : 8 combinaisons
/// représentables, 2 légales). Racers et finishers n'existent QU'ensemble, avec t=0 —
/// un état illégal (t=0 posé sans partants, par ex.) n'est plus représentable.
pub enum RaceState {
    /// Pas de course en cours : en attente de StartRace.
    Lobby,
    /// Course en cours. `racers` figés au départ (voir `all_racers_done`) ; `finishers`
    /// grandit jusqu'à `racers.len()` et retient le scoreboard COMPLET de chacun
    /// jusqu'à la clôture, pour que le podium n'ait rien à re-demander (ADR 0010).
    /// `logs` retient les Keystroke logs des finisseurs jusqu'à `end_race` (ADR 0011) :
    /// le Play of the Game rejoue les deux logs du duel. ~72 Ko à huit joueurs, libéré
    /// avec la variante (retour en `Lobby`). Même durée de vie que `finishers`.
    Racing {
        start_at_epoch_ms: i64,
        racers: Vec<PlayerId>,
        finishers: Vec<RaceResult>,
        logs: HashMap<PlayerId, Vec<Keystroke>>,
    },
}

impl RaceState {
    pub fn is_racing(&self) -> bool {
        matches!(self, RaceState::Racing { .. })
    }
}

/// Une Room : une Race en cours, identifiée par une clé (salon vocal ou Code de partie).
pub struct Room {
    pub key: RoomKey,
    /// Le Code de partie, si la Room en a un. `None` = Room de salon vocal. C'est aussi
    /// ce qui dit comment la Room a été créée, sans champ « kind » séparé.
    pub code: Option<String>,
    /// Présence ET ordre d'arrivée (l'owner se transfère à `players[0]`). Reste une liste
    /// d'ID : toute la logique de course raisonne là-dessus.
    pub players: Vec<PlayerId>,
    /// Display identity par présent — une projection d'affichage, à côté de `players`
    /// plutôt que dedans, pour que la logique de course n'ait pas à la connaître. Tenue
    /// à jour aux DEUX seuls endroits où la présence bouge : `add_player` et `leave_room`.
    pub identities: HashMap<PlayerId, Identity>,
    /// Owner = qui peut lancer la course (1er arrivé, transféré s'il part).
    pub owner: PlayerId,
    pub seed: u64,
    pub target_text: String,
    /// Source EFFECTIVE du `target_text` courant — pas celle qui a été demandée. Un repli
    /// après échec du proxy de citations bascule réellement ce champ (ADR 0009).
    pub text_source: TextSource,
    pub state: RaceState,
    /// Diffusion des ServerEvent vers tous les sockets du salon.
    pub tx: broadcast::Sender<ServerEvent>,
}

/// État global partagé des Rooms. Injecté dans l'AppState Axum.
pub type Rooms = Arc<Mutex<HashMap<RoomKey, Room>>>;

/// Pourquoi une jointure a échoué. `NotFound` n'est possible que par Code de partie :
/// une Room de salon est créée à la volée, elle ne peut pas manquer.
#[derive(Debug, PartialEq, Eq)]
pub enum JoinError {
    NotFound,
    Full,
}

pub fn new_rooms() -> Rooms {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Boucle d'une connexion WebSocket. `player_id` est résolu côté serveur (jamais
/// via le corps) AVANT l'upgrade, comme pour les endpoints HTTP.
pub async fn handle_socket(
    socket: WebSocket,
    rooms: Rooms,
    player_id: PlayerId,
    pool: SqlitePool,
    quotes: Arc<QuoteClient>,
) {
    // 1. Le premier message utile DOIT être une jointure : elle fixe la clé de Room et
    //    donne l'abonnement à la diffusion. Toute autre trame avant est ignorée.
    let (key, socket, mut rx) = match await_join(socket, &rooms, &player_id).await {
        Some(v) => v,
        None => return, // socket fermé avant toute jointure réussie
    };

    // 2. Diffusion → ce socket, en tâche dédiée (l'émetteur du socket lui appartient).
    let (mut sender, mut receiver) = socket.split();
    let forward = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let json = serde_json::to_string(&ev).expect("ServerEvent sérialisable");
                    if sender.send(Message::Text(json)).await.is_err() {
                        break; // socket fermé
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue, // on saute
                Err(broadcast::error::RecvError::Closed) => break,       // Room détruite
            }
        }
    });

    // 3. Lecture des messages du client jusqu'à fermeture / LeaveRoom.
    while let Some(Ok(msg)) = receiver.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };
        match serde_json::from_str::<ClientEvent>(&text) {
            Ok(ClientEvent::SetTextSource { source }) => {
                if set_text_source(&rooms, &key, &player_id, source) {
                    spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
                }
            }
            Ok(ClientEvent::StartRace) => start_race(&rooms, &key, &player_id),
            Ok(ClientEvent::Progress { chars_done }) => {
                relay_progress(&rooms, &key, &player_id, chars_done)
            }
            Ok(ClientEvent::Finish { keystrokes, ended_at_ms }) => {
                if finish_race(&rooms, &key, &player_id, keystrokes, ended_at_ms, &pool) {
                    // Course close : la revanche part sur un texte de la bonne Source.
                    spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
                }
            }
            Ok(ClientEvent::Forfeit) => {
                if forfeit_race(&rooms, &key, &player_id) {
                    // Abandon du dernier partant : la revanche part sur un texte neuf.
                    spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
                }
            }
            Ok(ClientEvent::LeaveRoom) => break,
            // Jointure en double : ignorée.
            Ok(_) | Err(_) => {}
        }
    }

    // 4. Déconnexion : retire la présence (re-diffuse RoomState) et coupe le forward.
    forward.abort();
    if leave_room(&rooms, &key, &player_id) {
        spawn_refresh_text(rooms.clone(), key.clone(), quotes.clone());
    }
}

/// Lit les messages jusqu'à une jointure RÉUSSIE, enregistre le joueur et renvoie
/// (clé de Room, socket, receiver de diffusion). `None` si le socket ferme avant.
///
/// Un échec (`RoomNotFound`, `RoomFull`) répond sur le socket et **continue la boucle** :
/// le joueur corrige son code et retente sans se reconnecter. C'est aussi pourquoi ces
/// deux événements ne sont pas diffusés — il n'y a aucune Room à qui les diffuser.
async fn await_join(
    mut socket: WebSocket,
    rooms: &Rooms,
    player_id: &str,
) -> Option<(RoomKey, WebSocket, broadcast::Receiver<ServerEvent>)> {
    while let Some(Ok(msg)) = socket.recv().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => return None,
            _ => continue,
        };
        let attempt = match serde_json::from_str::<ClientEvent>(&text) {
            Ok(ClientEvent::JoinChannel { channel_id, identity }) => {
                join_channel(rooms, &channel_id, player_id, identity).map(|rx| (channel_id, rx))
            }
            Ok(ClientEvent::CreateRoom { identity }) => {
                Ok(create_room(rooms, player_id, identity))
            }
            Ok(ClientEvent::JoinCode { code, identity }) => {
                join_code(rooms, &code, player_id, identity).map(|rx| (code, rx))
            }
            _ => continue, // toute autre trame avant une jointure : ignorée
        };
        match attempt {
            Ok((key, rx)) => return Some((key, socket, rx)),
            Err(e) => {
                let ev = match e {
                    JoinError::NotFound => ServerEvent::RoomNotFound,
                    JoinError::Full => ServerEvent::RoomFull,
                };
                let json = serde_json::to_string(&ev).expect("ServerEvent sérialisable");
                if socket.send(Message::Text(json)).await.is_err() {
                    return None;
                }
            }
        }
    }
    None
}

/// Room du salon vocal : CRÉÉE à la volée si absente. La clé vient du SDK Discord, elle
/// est authentique — il n'y a pas de faute de frappe possible à protéger.
fn join_channel(
    rooms: &Rooms,
    channel_id: &str,
    player_id: &str,
    identity: Identity,
) -> Result<broadcast::Receiver<ServerEvent>, JoinError> {
    let mut rooms = rooms.lock().unwrap();
    let room = rooms
        .entry(channel_id.to_string())
        .or_insert_with(|| new_room(channel_id.to_string(), None, player_id));
    add_player(room, player_id, identity)
}

/// Room à Code de partie : le serveur tire le code, crée la Room et y met son créateur —
/// qui devient donc l'owner par la règle habituelle du 1er arrivé.
fn create_room(
    rooms: &Rooms,
    player_id: &str,
    identity: Identity,
) -> (RoomKey, broadcast::Receiver<ServerEvent>) {
    let mut rooms = rooms.lock().unwrap();
    let code = generate_code(&rooms);
    let room = rooms
        .entry(code.clone())
        .or_insert_with(|| new_room(code.clone(), Some(code.clone()), player_id));
    let rx = add_player(room, player_id, identity).expect("Room neuve : jamais pleine");
    (code, rx)
}

/// Room à Code de partie : NE CRÉE JAMAIS. Un code inconnu répond `NotFound` plutôt que
/// d'enfermer le joueur seul dans une Room fantôme (ADR 0008).
fn join_code(
    rooms: &Rooms,
    code: &str,
    player_id: &str,
    identity: Identity,
) -> Result<broadcast::Receiver<ServerEvent>, JoinError> {
    let mut rooms = rooms.lock().unwrap();
    let room = rooms.get_mut(code).ok_or(JoinError::NotFound)?;
    add_player(room, player_id, identity)
}

/// Room neuve : seed + texte cible générés par le SERVEUR (vérité terrain).
///
/// Le texte de départ est TOUJOURS des mots, même si la Source par défaut est `Quote` :
/// une Room doit avoir un texte valide dès l'instant où elle existe, et aller chercher
/// une citation demande un aller-retour réseau qu'on ne peut pas faire sous le verrou.
/// La citation remplace ce texte dès qu'elle arrive (`spawn_refresh_text`).
fn new_room(key: RoomKey, code: Option<String>, owner: &str) -> Room {
    let (seed, target_text) = words_text(ROOM_WORD_COUNT);
    let (tx, _) = broadcast::channel(BROADCAST_CAP);
    Room {
        key,
        code,
        players: Vec::new(),
        identities: HashMap::new(),
        owner: owner.to_string(), // 1er arrivé = owner
        seed,
        target_text,
        text_source: TextSource::default(),
        state: RaceState::Lobby,
        tx,
    }
}

/// Texte généré : renvoie (seed, texte). Le serveur possède les deux (vérité terrain).
fn words_text(count: u32) -> (u64, String) {
    let seed = fresh_seed();
    let text =
        generate_text(&GenSettings { punctuation: false, numbers: false }, count as usize, seed)
            .join(" ");
    (seed as u64, text)
}

/// Regénère le texte cible d'une Room depuis sa Source, puis re-diffuse `RoomState`.
///
/// Toujours dans une tâche détachée, parce que `Quote` exige un appel réseau et que le
/// `Mutex` std des Rooms n'est JAMAIS tenu à travers un `await`. D'où la forme en trois
/// temps : lire la Source sous verrou, relâcher, aller chercher le texte, reposer le
/// résultat sous verrou. Le lobby affiche l'ancien texte pendant l'aller-retour puis le
/// nouveau — c'est exactement ce que `RoomState` sait déjà exprimer.
///
/// Un échec du proxy de citations (clé absente → 502, réseau, quota) **ne bloque pas le
/// lobby** : la Room bascule pour de vrai sur `Words(ROOM_WORD_COUNT)`, ce qui est aussi
/// la façon dont le repli est signalé aux joueurs.
fn spawn_refresh_text(rooms: Rooms, key: RoomKey, quotes: Arc<QuoteClient>) {
    tokio::spawn(async move {
        // Lecture dans une fonction À PART, pas dans un bloc : le `MutexGuard` ne peut
        // alors PAS traverser le `await` qui suit, ni par accident ni par refactoring.
        let Some(source) = pending_source(&rooms, &key) else { return };

        let (seed, text, effective) = match source {
            TextSource::Words { count } => {
                let (seed, text) = words_text(count);
                (seed, text, source)
            }
            TextSource::Quote => match quotes.fetch().await {
                Ok(q) => (fresh_seed() as u64, normalize_quote(&q.text), TextSource::Quote),
                Err(_) => {
                    let (seed, text) = words_text(ROOM_WORD_COUNT);
                    (seed, text, TextSource::Words { count: ROOM_WORD_COUNT })
                }
            },
        };

        let mut guard = rooms.lock().unwrap();
        let Some(room) = guard.get_mut(&key) else { return }; // Room disparue entre-temps
        if room.state.is_racing() {
            return; // course lancée pendant l'aller-retour : le texte en vol est périmé
        }
        room.seed = seed;
        room.target_text = text;
        room.text_source = effective;
        let _ = room.tx.send(room_state(room));
    });
}

/// Source d'une Room qui attend un texte, ou `None` s'il n'y a rien à regénérer : Room
/// disparue, ou course déjà lancée (on ne change pas le texte sous les doigts des joueurs).
fn pending_source(rooms: &Rooms, key: &str) -> Option<TextSource> {
    let guard = rooms.lock().unwrap();
    let room = guard.get(key)?;
    (!room.state.is_racing()).then_some(room.text_source)
}

/// Ramène une citation à la forme que le reste du moteur attend : des mots séparés par
/// UN espace. Une citation arrive avec des retours à la ligne et des espaces doubles,
/// or `target_text.split(' ')` compte les mots et le client découpe pareil.
fn normalize_quote(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// SetTextSource : accepté du seul owner, hors course, et seulement pour une longueur
/// autorisée. Renvoie `true` si le texte doit être regénéré.
fn set_text_source(rooms: &Rooms, key: &str, player_id: &str, source: TextSource) -> bool {
    if let TextSource::Words { count } = source {
        if !WORDS_LENGTHS.contains(&count) {
            return false; // longueur arbitraire : refusée (elle s'impose aux 7 autres)
        }
    }
    let mut rooms = rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(key) else { return false };
    if room.owner != player_id || room.state.is_racing() {
        return false; // non-owner, ou course en cours : ignoré
    }
    room.text_source = source;
    true
}

/// Inscrit la présence, s'abonne à la diffusion, puis re-diffuse RoomState à tous. Le
/// lock std n'est jamais tenu à travers un await (broadcast::send/subscribe sont
/// synchrones). Rejoindre deux fois est idempotent et ne consomme pas de place.
fn add_player(
    room: &mut Room,
    player_id: &str,
    identity: Identity,
) -> Result<broadcast::Receiver<ServerEvent>, JoinError> {
    let already_in = room.players.iter().any(|p| p == player_id);
    if !already_in && room.players.len() >= MAX_PLAYERS {
        return Err(JoinError::Full);
    }
    // S'abonner AVANT de diffuser → ce socket reçoit aussi le RoomState.
    let rx = room.tx.subscribe();
    if !already_in {
        room.players.push(player_id.to_string());
    }
    // Toujours réécrite, même sur une reconnexion : le joueur a pu changer de pseudo.
    room.identities.insert(player_id.to_string(), identity.sanitized());
    let _ = room.tx.send(room_state(room));
    Ok(rx)
}

/// Tire un Code de partie libre.
///
/// Dérivé de l'horloge nanoseconde, comme `fresh_seed` — cinq caractères ne justifient
/// pas d'ajouter la crate `rand`. Le sel change à chaque tentative pour que deux appels
/// dans la même nanoseconde ne bouclent pas sur le même code.
///
/// ponytail: boucle non bornée. Elle ne peut tourner indéfiniment que si les ~28 M de
/// codes sont TOUS pris, soit ~225 M de joueurs connectés. Si ça arrive : allonger
/// CODE_LEN.
fn generate_code(rooms: &HashMap<RoomKey, Room>) -> String {
    let base = CODE_ALPHABET.len() as u128;
    for salt in 0u128.. {
        // Mélange multiplicatif : sans lui, deux appels rapprochés partageraient tous
        // leurs caractères de poids fort (les nanos ne bougent que dans les poids faibles).
        let mut n = now_epoch_nanos().wrapping_mul(6364136223846793005).wrapping_add(salt);
        let code: String = (0..CODE_LEN)
            .map(|_| {
                let c = CODE_ALPHABET[(n % base) as usize] as char;
                n /= base;
                c
            })
            .collect();
        if !rooms.contains_key(&code) {
            return code;
        }
    }
    unreachable!("0u128.. ne se termine pas")
}

/// Renvoie `true` si le départ a CLOS une course encore vivante — l'appelant regénère
/// alors le texte depuis la Source (hors verrou), comme après une fin normale.
fn leave_room(rooms: &Rooms, key: &str, player_id: &str) -> bool {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(key) {
        room.players.retain(|p| p != player_id);
        room.identities.remove(player_id); // jamais persistée, oubliée en partant
        // Abandon total (y compris juste après le départ, sans état "décompte" dédié
        // côté serveur — voir CONTEXT.md) : clôt la course AVANT de retirer une Room
        // désormais vide, sinon elle reste gelée en RaceState::Racing (issue #23).
        let was_racing = room.state.is_racing();
        close_race(room, true);
        let closed = was_racing && !room.state.is_racing();
        if room.players.is_empty() {
            // tx droppé → forwards des sockets se terminent. Un Code de partie meurt
            // ici avec sa Room : jamais persisté, jamais réservé (ADR 0008).
            rooms.remove(key);
            return false; // Room disparue : rien à regénérer
        }
        if room.owner == player_id {
            room.owner = room.players[0].clone(); // transfert au suivant dans la pile
        }
        let _ = room.tx.send(room_state(room));
        return closed;
    }
    false
}

/// Clôt une course en cours, déclarant abandon (0 WPM, pas de recompute sur un log vide —
/// l'accuracy y vaudrait 100, pas 0, piège de l'issue #23) tout partant pas encore fini.
/// Aucun Run n'est persisté pour un abandon : rien à exclure des PB, rien à polluer.
///
/// `require_absent` : si vrai, ne clôt QUE si aucun partant en attente n'est encore
/// connecté — abandon "tout le monde est parti" (#23, appelé depuis `leave_room`). Si
/// faux, clôt sans condition de présence — watchdog de durée expirée (#24, quelqu'un
/// peut très bien être encore connecté sans avoir rien envoyé depuis 10 minutes).
fn close_race(room: &mut Room, require_absent: bool) {
    let pending: Vec<PlayerId> = match &room.state {
        RaceState::Racing { racers, finishers, .. } => racers
            .iter()
            .filter(|r| !finishers.iter().any(|f| f.player_id == **r))
            .cloned()
            .collect(),
        RaceState::Lobby => return,
    };
    if require_absent && pending.iter().any(|r| room.players.contains(r)) {
        return; // au moins un partant présent n'a pas fini : la course continue
    }
    if let RaceState::Racing { finishers, .. } = &mut room.state {
        for r in &pending {
            finishers.push(RaceResult::forfeited(r));
        }
    }
    for r in &pending {
        let _ =
            room.tx.send(ServerEvent::PlayerFinished { player_id: r.clone(), wpm: 0.0, forfeit: true });
    }
    end_race(room);
}

/// Seuil au-delà duquel une course est jugée anormalement longue (issue #24) : un
/// client peut disparaître sans jamais envoyer LeaveRoom (perte réseau, crash) — un
/// watchdog client ne couvrirait pas ce cas, la fermeture doit venir du serveur. Zen et
/// Time infini n'existent pas en Race : 10 min est un plafond sûr pour le seul Mode
/// actuel (Words) — à revoir si la Race gagne un Mode à durée libre.
const RACE_MAX_DURATION_MS: i64 = 10 * 60 * 1000;
/// Fréquence de la vérification watchdog — pas besoin d'être plus précis que ça pour
/// un seuil de 10 minutes.
const WATCHDOG_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

/// Clôt les Rooms dont la course dépasse RACE_MAX_DURATION_MS. Horloge injectée (`now`)
/// pour rester testable sans attendre 10 minutes en vrai (issue #24). Renvoie les clés
/// des Rooms closes, pour que l'appelant y regénère le texte hors verrou.
fn close_overlong_races(rooms: &Rooms, now: i64) -> Vec<RoomKey> {
    let mut rooms = rooms.lock().unwrap();
    let mut closed = Vec::new();
    for room in rooms.values_mut() {
        let overlong = match &room.state {
            RaceState::Racing { start_at_epoch_ms, .. } => now - start_at_epoch_ms > RACE_MAX_DURATION_MS,
            RaceState::Lobby => false,
        };
        if overlong {
            close_race(room, false);
            closed.push(room.key.clone());
        }
    }
    closed
}

/// Boucle watchdog : vérifie toutes les Rooms à intervalle régulier (issue #24). À
/// spawn une fois au démarrage (voir main.rs). Chaque tick ne fait que scanner + fermer
/// les Rooms trop longues — aucun recompute, aucune DB, le Mutex global n'est jamais
/// tenu au-delà de cette opération O(nombre de Rooms).
pub fn spawn_watchdog(rooms: Rooms, quotes: Arc<QuoteClient>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(WATCHDOG_CHECK_INTERVAL);
        loop {
            interval.tick().await;
            for key in close_overlong_races(&rooms, now_epoch_ms()) {
                spawn_refresh_text(rooms.clone(), key, quotes.clone());
            }
        }
    });
}

/// StartRace : accepté du seul owner, hors course en cours. Fige les partants,
/// fixe t=0 (horloge murale serveur) et le diffuse.
fn start_race(rooms: &Rooms, key: &str, player_id: &str) {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(key) {
        if room.owner != player_id || room.state.is_racing() {
            return; // non-owner ou course déjà lancée : ignoré
        }
        let start = now_epoch_ms();
        room.state = RaceState::Racing {
            start_at_epoch_ms: start,
            racers: room.players.clone(),
            finishers: Vec::new(),
            logs: HashMap::new(),
        };
        let _ = room.tx.send(ServerEvent::RaceStart { start_at_epoch_ms: start });
    }
}

/// Relaie la progression d'un joueur aux autres (rendu des barres). Non autoritaire.
fn relay_progress(rooms: &Rooms, key: &str, player_id: &str, chars_done: u32) {
    let rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get(key) {
        let _ = room.tx.send(ServerEvent::PlayerProgress {
            player_id: player_id.to_string(),
            chars_done,
        });
    }
}

/// Résultat d'une tentative d'enregistrer une arrivée.
#[derive(Debug, PartialEq, Eq)]
enum FinishOutcome {
    /// Pas un partant de cette course, ou déjà fini : ignoré (doublon ou état périmé).
    Rejected,
    Recorded,
    /// Enregistré, et c'était le dernier partant attendu : la course est close.
    RaceOver,
}

/// Enregistre l'arrivée d'un partant (rejette les non-partants et les doublons),
/// diffuse PlayerFinished, et clôt la course si c'était la dernière arrivée attendue.
/// Machine d'état PURE : aucun socket, aucune DB — un seul paramètre (`pool`, dans
/// `finish_race`) séparait ça d'une couverture complète (issue #18).
///
/// `log` est retenu dans l'état de course (ADR 0011) pour le Play of the Game. Il entre
/// ICI, sous le MÊME verrou que le `push` du finisher et que `end_race` : un abandon passe
/// un log vide (jamais choisi pour un duel). Le stasher dans un verrou séparé ouvrirait
/// une fenêtre où `end_race` clôturerait sans ce log.
fn record_finish(rooms: &Rooms, key: &str, result: RaceResult, log: Vec<Keystroke>) -> FinishOutcome {
    let mut rooms = rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(key) else { return FinishOutcome::Rejected };
    let player_id = result.player_id.clone();

    let eligible = match &room.state {
        RaceState::Racing { racers, finishers, .. } => {
            racers.contains(&player_id)
                && !finishers.iter().any(|f| f.player_id == player_id)
        }
        RaceState::Lobby => false,
    };
    if !eligible {
        return FinishOutcome::Rejected;
    }

    let wpm = result.wpm;
    let forfeit = result.forfeit;
    let RaceState::Racing { finishers, logs, .. } = &mut room.state else { unreachable!("vérifié ci-dessus") };
    logs.insert(player_id.clone(), log);
    finishers.push(result);
    // PlayerFinished reste le signal LIVE « untel a fini » : le podium ne s'en nourrit
    // plus, il lit RaceOver (ADR 0010). `forfeit` fait afficher « abandon » sur la piste.
    let _ = room.tx.send(ServerEvent::PlayerFinished { player_id, wpm, forfeit });

    let done = match &room.state {
        RaceState::Racing { racers, finishers, .. } => all_racers_done(racers, &room.players, finishers),
        RaceState::Lobby => false,
    };
    if done {
        end_race(room);
        FinishOutcome::RaceOver
    } else {
        FinishOutcome::Recorded
    }
}

/// Abandon VOLONTAIRE : enregistre une arrivée en abandon (0 WPM, flag explicite, aucun
/// recompute ni persistance) SANS retirer le joueur de la Room — il reste au lobby pour la
/// prochaine course. Réutilise `record_finish`, donc le doublon (déjà fini/abandonné) et le
/// non-partant sont rejetés comme une arrivée normale. Renvoie `true` si cet abandon a CLOS
/// la course (dernier partant attendu) — l'appelant regénère alors le texte, hors verrou.
fn forfeit_race(rooms: &Rooms, key: &str, player_id: &str) -> bool {
    // Log vide : un abandon n'est jamais choisi pour un Play of the Game (ADR 0011).
    record_finish(rooms, key, RaceResult::forfeited(player_id), Vec::new()) == FinishOutcome::RaceOver
}

/// Finish : recompute AUTORITAIRE contre le texte du serveur, puis enregistre l'arrivée
/// (`record_finish`). Le Run est aussi persisté dans `runs` (kind "race") — historique
/// seulement, jamais PB : la fin stricte (texte 100 % exact) le rend incomparable aux
/// buckets Practice.
/// Renvoie `true` si cette arrivée a CLOS la course (dernier partant attendu) — l'appelant
/// regénère alors le texte depuis la Source, hors verrou.
fn finish_race(
    rooms: &Rooms,
    key: &str,
    player_id: &str,
    keystrokes: Vec<Keystroke>,
    _ended_at_ms: f64, // wire uniquement : la durée vient du log, jamais du client (issue #11)
    pool: &SqlitePool,
) -> bool {
    // Vérif préliminaire, bref verrou : évite le recompute (coûteux) pour un partant déjà
    // rejeté d'office. `record_finish` refait l'authoritative check plus bas, verrou séparé.
    let target_text = {
        let rooms = rooms.lock().unwrap();
        let Some(room) = rooms.get(key) else { return false };
        let eligible = match &room.state {
            RaceState::Racing { racers, finishers, .. } => {
                racers.iter().any(|p| p == player_id)
                    && !finishers.iter().any(|f| f.player_id == player_id)
            }
            RaceState::Lobby => false,
        };
        if !eligible {
            return false;
        }
        room.target_text.clone()
    };

    // Sérialisé avant le recompute (qui prend possession des keystrokes).
    let keystroke_log = serde_json::to_string(&keystrokes).unwrap_or_else(|_| "[]".to_string());
    // CLONÉ pour la rétention en mémoire (ADR 0011, Play of the Game) : même motif que la
    // série `per_second` clonée plus bas — un consommateur d'après-course a besoin du log,
    // la persistance aussi. Le recompute juste après prend possession de `keystrokes`.
    let retained_log = keystrokes.clone();

    // Race = Words sur le texte du salon (le serveur possède seed/texte/config).
    // Hors verrou : le recompute (O(n) sur le log) ne doit pas bloquer les autres Rooms.
    let mode_value = target_text.split(' ').count() as i64;
    let mut sb = compute_scoreboard(&ScoreInput {
        mode: Mode::Words,
        mode_value,
        target_text: target_text.clone(),
        keystrokes,
    });

    // Verrou séparé, bref : enregistrement authoritative (l'état a pu changer entretemps).
    // La série est CLONÉE : le podium en a besoin (ADR 0010) et la persistance aussi.
    let outcome = record_finish(
        rooms,
        key,
        RaceResult {
            player_id: player_id.to_string(),
            wpm: sb.wpm,
            accuracy: sb.accuracy,
            duration_ms: sb.duration_ms,
            forfeit: false,
            per_second: sb.per_second.clone(),
        },
        retained_log,
    );
    if outcome == FinishOutcome::Rejected {
        return false;
    }

    // Persistance hors verrou (spawn) : l'échec ne casse pas la course, il se logue.
    sb.pb_eligible = false;
    let config = RunConfig {
        mode: Mode::Words,
        mode_value,
        language: "english".to_string(),
        punctuation: false,
        numbers: false,
    };
    let pool = pool.clone();
    let pid = player_id.to_string();
    tokio::spawn(async move {
        let run_id = format!("r_{}", now_epoch_nanos());
        if let Err(e) = crate::store::insert_run(
            &pool, &run_id, &pid, now_epoch_ms(), "race", &config, &sb, &keystroke_log, &target_text,
        )
        .await
        {
            eprintln!("persistance du Run de Race ({pid}) : {e}");
        }
    });

    outcome == FinishOutcome::RaceOver
}

/// Course finie quand chaque partant ENCORE PRÉSENT a fini. Les partants sont figés
/// au RaceStart : un joueur qui rejoint en cours ne bloque pas la fin, un partant
/// qui quitte n'est plus attendu. Vide = pas de course en cours.
fn all_racers_done(
    racers: &[PlayerId],
    players: &[PlayerId],
    finishers: &[RaceResult],
) -> bool {
    !racers.is_empty()
        && racers
            .iter()
            .filter(|r| players.contains(r))
            .all(|r| finishers.iter().any(|f| f.player_id == *r))
}

/// Clôt la course : diffuse le classement (par WPM décroissant), puis prépare la
/// revanche — nouveau seed + nouveau texte (l'ancien est mémorisé par les joueurs)
/// re-diffusés via RoomState. L'owner peut relancer StartRace depuis l'écran RaceOver.
fn end_race(room: &mut Room) {
    let RaceState::Racing { finishers, logs, .. } = &room.state else { return }; // rien à clore
    // L'ORDRE DU TABLEAU EST LE CLASSEMENT (ADR 0010) : abandons repoussés derrière tous
    // les finisseurs, puis WPM décroissant. Classer au WPM et classer au temps donnent
    // le même ordre en Race — même texte pour tous, et on ne finit qu'à 100 % exact,
    // donc les caractères corrects sont identiques entre finisseurs.
    let mut results = finishers.clone();
    results.sort_by(|a, b| {
        a.forfeit
            .cmp(&b.forfeit)
            .then(b.wpm.partial_cmp(&a.wpm).unwrap_or(std::cmp::Ordering::Equal))
    });
    // Play of the Game (ADR 0011) : le serveur choisit le duel et n'expédie QUE ses deux
    // logs, jamais les huit. `None` = pas de duel → le bouton est absent du podium.
    let play_of_the_game = duel(&results).map(|(i, j)| {
        let a = results[i].player_id.clone();
        let b = results[j].player_id.clone();
        PlayOfTheGame {
            log_a: logs.get(&a).cloned().unwrap_or_default(),
            log_b: logs.get(&b).cloned().unwrap_or_default(),
            a,
            b,
        }
    });
    let _ = room.tx.send(ServerEvent::RaceOver { results, play_of_the_game });

    room.state = RaceState::Lobby;
    // Texte neuf IMMÉDIAT, et toujours des mots : la Room doit rester jouable sans
    // aller-retour réseau (l'owner peut relancer dès l'écran RaceOver). Si la Source est
    // Quote, `spawn_refresh_text` remplace ce texte dès que la citation arrive — c'est
    // l'appelant qui le déclenche, une fois le verrou relâché.
    let count = match room.text_source {
        TextSource::Words { count } => count,
        TextSource::Quote => ROOM_WORD_COUNT,
    };
    let (seed, text) = words_text(count);
    room.seed = seed;
    room.target_text = text;
    let _ = room.tx.send(room_state(room));
}

/// Écart maximal (ms) entre deux finisseurs pour qu'ils forment un duel (ADR 0011).
/// Au-delà, il n'y a pas eu de duel : un « Play of the Game » à 8 s d'écart détruirait la
/// promesse de la fonctionnalité. Inclusif — exactement 2,0 s reste un duel.
const DUEL_MAX_GAP_MS: f64 = 2000.0;

/// Le duel le plus serré (ADR 0011) : la paire de finisseurs CONSÉCUTIFS au classement
/// dont l'écart de durée est le plus faible — littéralement « les deux autos qui ont
/// terminé le plus proche ». `results` est déjà trié (abandons en queue, puis WPM
/// décroissant = durée croissante), donc consécutif au classement = consécutif à
/// l'arrivée. Renvoie les indices dans `results`.
///
/// `None` s'il y a moins de deux finisseurs, ou si même le meilleur écart dépasse le
/// seuil. Les abandons sont exclus (durée 0, pas de log). Égalité d'écart : la première
/// paire rencontrée gagne — la plus haute au classement, le duel le plus prestigieux.
/// Fonction pure : c'est le test qui garde la décision honnête.
fn duel(results: &[RaceResult]) -> Option<(usize, usize)> {
    let finishers: Vec<usize> = results
        .iter()
        .enumerate()
        .filter(|(_, r)| !r.forfeit)
        .map(|(i, _)| i)
        .collect();
    let mut best: Option<(usize, usize, f64)> = None;
    for pair in finishers.windows(2) {
        let (i, j) = (pair[0], pair[1]);
        let gap = (results[j].duration_ms - results[i].duration_ms).abs();
        // `<` strict : une égalité ne remplace pas → la première paire (la mieux classée) gagne.
        if best.is_none_or(|(_, _, g)| gap < g) {
            best = Some((i, j, gap));
        }
    }
    best.filter(|(_, _, gap)| *gap <= DUEL_MAX_GAP_MS).map(|(i, j, _)| (i, j))
}

/// Projette la présence en entrées dessinables. Un présent sans identité connue retombe
/// sur son snowflake : jamais joli, mais jamais vide non plus.
fn room_state(room: &Room) -> ServerEvent {
    let players = room
        .players
        .iter()
        .map(|id| {
            let ident = room.identities.get(id);
            PlayerEntry {
                player_id: id.clone(),
                display_name: ident
                    .map(|i| i.display_name.clone())
                    .filter(|n| !n.is_empty())
                    .unwrap_or_else(|| id.clone()),
                avatar_hash: ident.and_then(|i| i.avatar_hash.clone()),
            }
        })
        .collect();
    ServerEvent::RoomState {
        players,
        owner: room.owner.clone(),
        seed: room.seed,
        target_text: room.target_text.clone(),
        code: room.code.clone(),
        text_source: room.text_source,
    }
}

/// Seed 32 bits dérivée de l'horloge (le serveur possède la vérité terrain).
fn fresh_seed() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u32)
        .unwrap_or(0)
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Identifiant de Run (même forme `r_<nanos>` que POST /api/runs).
fn now_epoch_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    /// Identité de test : le nom affiché reprend l'ID, ça suffit à ce que la projection
    /// soit exercée sans polluer les assertions de présence.
    fn ident(player_id: &str) -> Identity {
        Identity { display_name: player_id.to_string(), avatar_hash: None }
    }

    /// Une arrivée réussie. La durée est dérivée du WPM pour que Gap et WPM restent
    /// cohérents dans les tests, comme ils le sont en vrai.
    fn done(player_id: &str, wpm: f64) -> RaceResult {
        RaceResult {
            player_id: player_id.to_string(),
            wpm,
            accuracy: 97.0,
            duration_ms: if wpm > 0.0 { 60_000.0 / wpm } else { 0.0 },
            forfeit: false,
            per_second: Vec::new(),
        }
    }

    /// Enregistre une arrivée SANS log retenu — le duel n'est pas le sujet de ces tests.
    /// Les tests qui exercent le Play of the Game passent un vrai log via `duel` directement.
    fn record(rooms: &Rooms, key: &str, result: RaceResult) -> FinishOutcome {
        record_finish(rooms, key, result, Vec::new())
    }

    /// Les player_id de RaceOver, dans l'ordre du classement.
    fn ranking_of(rx: &mut broadcast::Receiver<ServerEvent>) -> Option<Vec<PlayerId>> {
        let mut out = None;
        while let Ok(ev) = rx.try_recv() {
            if let ServerEvent::RaceOver { results, .. } = ev {
                out = Some(results.into_iter().map(|r| r.player_id).collect());
            }
        }
        out
    }

    /// Jointure par salon vocal — le cas par défaut de la quasi-totalité des tests.
    fn join(rooms: &Rooms, channel_id: &str, player_id: &str) {
        join_channel(rooms, channel_id, player_id, ident(player_id))
            .expect("salon : jointure toujours possible");
    }

    fn players_of(rooms: &Rooms, key: &str) -> Vec<PlayerId> {
        rooms.lock().unwrap().get(key).unwrap().players.clone()
    }

    fn racers_of(rooms: &Rooms, channel_id: &str) -> Vec<PlayerId> {
        match &rooms.lock().unwrap().get(channel_id).unwrap().state {
            RaceState::Racing { racers, .. } => racers.clone(),
            RaceState::Lobby => panic!("pas en course"),
        }
    }

    #[test]
    fn partants_figes_au_depart() {
        let racers = s(&["a", "b"]);
        let fin_a = vec![done("a", 80.0)];
        let fin_ab = vec![done("a", 80.0), done("b", 60.0)];

        // Pas de course en cours (partants vides) : jamais "fini".
        assert!(!all_racers_done(&[], &racers, &fin_ab));
        // Il manque b : pas fini.
        assert!(!all_racers_done(&racers, &racers, &fin_a));
        // Tous les partants ont fini.
        assert!(all_racers_done(&racers, &racers, &fin_ab));
        // Un joueur qui REJOINT en cours de course ne bloque pas la fin.
        assert!(all_racers_done(&racers, &s(&["a", "b", "spectateur"]), &fin_ab));
        // Un partant qui QUITTE n'est plus attendu : a fini + b parti → fini.
        assert!(all_racers_done(&racers, &s(&["a"]), &fin_a));
    }

    #[test]
    fn actions_sans_joinroom_prealable_sont_des_no_op() {
        // issue #18 : StartRace/Progress/Finish sur un salon jamais rejoint (aucune Room
        // créée) sont ignorés — pas de panique, pas de Room créée par effet de bord.
        let rooms = new_rooms();
        start_race(&rooms, "c1", "p1");
        relay_progress(&rooms, "c1", "p1", 5);
        assert_eq!(record(&rooms, "c1", done("p1", 80.0)), FinishOutcome::Rejected);
        assert!(rooms.lock().unwrap().is_empty());
    }

    #[test]
    fn owner_premier_arrive_et_transfert_au_depart() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        assert_eq!(rooms.lock().unwrap().get("c1").unwrap().owner, "p1");

        leave_room(&rooms, "c1", "p1");
        assert_eq!(rooms.lock().unwrap().get("c1").unwrap().owner, "p2");
    }

    #[test]
    fn start_race_reserve_a_lowner_et_refuse_pendant_une_course() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1"); // owner
        join(&rooms, "c1", "p2");

        start_race(&rooms, "c1", "p2"); // pas l'owner : ignoré
        assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

        start_race(&rooms, "c1", "p1"); // owner : accepté
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

        let start_at = |rooms: &Rooms| match &rooms.lock().unwrap().get("c1").unwrap().state {
            RaceState::Racing { start_at_epoch_ms, .. } => *start_at_epoch_ms,
            RaceState::Lobby => panic!("pas en course"),
        };
        let avant = start_at(&rooms);
        start_race(&rooms, "c1", "p1"); // déjà en course : ignoré, t=0 inchangé
        assert_eq!(start_at(&rooms), avant);
    }

    #[test]
    fn gel_des_partants() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");

        join(&rooms, "c1", "p3"); // rejoint APRÈS le départ
        assert_eq!(racers_of(&rooms, "c1"), s(&["p1", "p2"])); // p3 absent : pas un partant
        assert_eq!(rooms.lock().unwrap().get("c1").unwrap().players, s(&["p1", "p2", "p3"])); // mais présent
    }

    #[test]
    fn rejet_des_arrivees_en_double_et_des_non_partants() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        join(&rooms, "c1", "spectateur"); // rejoint après le départ : pas un partant

        assert_eq!(record(&rooms, "c1", done("spectateur", 999.0)), FinishOutcome::Rejected);
        assert_eq!(record(&rooms, "c1", done("p1", 80.0)), FinishOutcome::Recorded);
        assert_eq!(record(&rooms, "c1", done("p1", 999.0)), FinishOutcome::Rejected); // doublon
    }

    #[test]
    fn classement_par_wpm_decroissant() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        assert_eq!(record(&rooms, "c1", done("p1", 60.0)), FinishOutcome::Recorded);
        assert_eq!(record(&rooms, "c1", done("p2", 90.0)), FinishOutcome::RaceOver);

        assert_eq!(ranking_of(&mut rx), Some(s(&["p2", "p1"]))); // p2 (90) devant p1 (60)
    }

    #[test]
    fn revanche_sur_texte_neuf() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        let texte_avant = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();

        start_race(&rooms, "c1", "p1");
        assert_eq!(record(&rooms, "c1", done("p1", 60.0)), FinishOutcome::RaceOver);

        {
            let guard = rooms.lock().unwrap();
            let room = guard.get("c1").unwrap();
            assert!(!room.state.is_racing()); // retour au Lobby
            assert_ne!(room.target_text, texte_avant); // nouveau texte pour la revanche
        }

        // L'owner peut relancer une course sur ce texte neuf.
        start_race(&rooms, "c1", "p1");
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
    }

    #[test]
    fn abandon_total_pendant_le_decompte_clot_immediatement() {
        // issue #23 : personne n'a encore fini (voire tapé) — "pendant le décompte" côté
        // serveur, puisqu'il n'y a pas d'état dédié pour ça (voir CONTEXT.md). Un
        // spectateur qui reste EMPÊCHE la Room d'être retirée par le garde "vide" — sans
        // le fix, elle resterait gelée en RaceState::Racing pour toujours (le bug décrit).
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        join(&rooms, "c1", "spectateur"); // rejoint après le départ, ne part jamais

        leave_room(&rooms, "c1", "p1");
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing()); // p2 encore là

        leave_room(&rooms, "c1", "p2"); // dernier PARTANT : clôture immédiate malgré le spectateur
        assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

        // Utilisable de nouveau : l'owner (transféré au spectateur) peut relancer.
        start_race(&rooms, "c1", "spectateur");
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
    }

    #[test]
    fn abandon_partiel_classement_a_zero_pour_les_partants_jamais_finis() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        join(&rooms, "c1", "p3");
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        assert_eq!(record(&rooms, "c1", done("p1", 80.0)), FinishOutcome::Recorded);
        leave_room(&rooms, "c1", "p2"); // abandonne sans finir
        leave_room(&rooms, "c1", "p3"); // dernier partant restant : clôture

        let mut finished_wpm = std::collections::HashMap::new();
        let mut results = None;
        while let Ok(ev) = rx.try_recv() {
            match ev {
                ServerEvent::PlayerFinished { player_id, wpm, .. } => {
                    finished_wpm.insert(player_id, wpm);
                }
                ServerEvent::RaceOver { results: r, .. } => results = Some(r),
                _ => {}
            }
        }
        // p2 et p3 apparaissent à 0 WPM (pas de recompute sur log vide, valeur explicite).
        assert_eq!(finished_wpm.get("p2"), Some(&0.0));
        assert_eq!(finished_wpm.get("p3"), Some(&0.0));

        let results = results.expect("RaceOver diffusé");
        let ids: Vec<PlayerId> = results.iter().map(|r| r.player_id.clone()).collect();
        assert_eq!(ids, s(&["p1", "p2", "p3"])); // p1 (80) devant les abandons
        // Les abandons se lisent au flag, jamais à un WPM nul déduit.
        assert!(!results[0].forfeit);
        assert!(results[1].forfeit && results[2].forfeit);
        assert!(results[1].per_second.is_empty()); // pas de recompute → pas de graphe
    }

    #[test]
    fn un_abandon_passe_derriere_tous_les_finisseurs() {
        // Même à 0 WPM un abandon trierait déjà en dernier ; le tri l'exprime quand même
        // explicitement, pour ne pas dépendre d'une valeur sentinelle.
        let rooms = new_rooms();
        for p in ["p1", "p2"] {
            join(&rooms, "c1", p);
        }
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        record(&rooms, "c1", RaceResult::forfeited("p1"));
        assert_eq!(record(&rooms, "c1", done("p2", 10.0)), FinishOutcome::RaceOver);
        assert_eq!(ranking_of(&mut rx), Some(s(&["p2", "p1"])));
    }

    #[test]
    fn raceover_porte_les_resultats_complets() {
        // ADR 0010 : le podium lit RaceOver et ne re-demande RIEN — ni endpoint HTTP, ni
        // second événement. Il lui faut donc durée, accuracy et série dans le message.
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        let mut r = done("p1", 60.0);
        r.per_second = vec![crate::domain::types::PerSecondPoint {
            t: 1.0,
            wpm: 60.0,
            raw: 62.0,
            errors: 0,
            burst: 70.0,
        }];
        assert_eq!(record(&rooms, "c1", r), FinishOutcome::RaceOver);

        let mut results = None;
        while let Ok(ev) = rx.try_recv() {
            if let ServerEvent::RaceOver { results: v, .. } = ev {
                results = Some(v);
            }
        }
        let results = results.expect("RaceOver diffusé");
        assert_eq!(results[0].accuracy, 97.0);
        assert_eq!(results[0].duration_ms, 1000.0); // 60 wpm ⇒ 1 s dans le helper
        assert_eq!(results[0].per_second.len(), 1); // la série voyage : graphe sans requête
    }

    #[test]
    fn abandon_ne_bloque_pas_une_revanche() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        leave_room(&rooms, "c1", "p1");
        leave_room(&rooms, "c1", "p2");

        // La Room a été retirée (vide), mais rejoindre en recrée une aussitôt utilisable.
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
    }

    #[test]
    fn abandon_volontaire_reste_au_lobby_et_debloque_la_fin() {
        // issue #52 : abandonner enregistre une arrivée en abandon SANS retirer le joueur
        // de la Room (contrairement à leave_room). p1 abandonne → il reste présent, débloque
        // la fin quand p2 finit, et peut rejouer la course suivante.
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        assert!(!forfeit_race(&rooms, "c1", "p1")); // p2 court encore : pas la fin
        assert!(players_of(&rooms, "c1").contains(&"p1".to_string())); // reste au lobby
        // Doublon rejeté comme une arrivée normale : abandonner deux fois ne fait rien.
        assert!(!forfeit_race(&rooms, "c1", "p1"));

        assert_eq!(record(&rooms, "c1", done("p2", 80.0)), FinishOutcome::RaceOver);

        // p1 apparaît en abandon (flag explicite, jamais un 0 wpm déduit) et passe DERRIÈRE p2.
        let mut forfeited = std::collections::HashMap::new();
        let mut results = None;
        while let Ok(ev) = rx.try_recv() {
            match ev {
                ServerEvent::PlayerFinished { player_id, forfeit, .. } => {
                    forfeited.insert(player_id, forfeit);
                }
                ServerEvent::RaceOver { results: r, .. } => results = Some(r),
                _ => {}
            }
        }
        assert_eq!(forfeited.get("p1"), Some(&true));
        assert_eq!(forfeited.get("p2"), Some(&false));
        let ids: Vec<PlayerId> = results.unwrap().iter().map(|r| r.player_id.clone()).collect();
        assert_eq!(ids, s(&["p2", "p1"]));

        // La Room est de retour au lobby, jouable : p1 (toujours présent) peut relancer.
        assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
        start_race(&rooms, "c1", "p1"); // p1 est devenu owner ? non, p1 était déjà owner
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
    }

    #[test]
    fn abandon_du_dernier_partant_clot_la_course() {
        // issue #52 : quand c'est le SEUL partant restant qui abandonne, sa course se clôt
        // immédiatement (elle n'attend pas le watchdog).
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");

        assert_eq!(record(&rooms, "c1", done("p1", 80.0)), FinishOutcome::Recorded);
        assert!(forfeit_race(&rooms, "c1", "p2")); // dernier partant : clôt (true)
        assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
        // Les deux restent au lobby : personne n'a quitté la Room en abandonnant.
        assert_eq!(players_of(&rooms, "c1"), s(&["p1", "p2"]));
    }

    // --- Play of the Game : choix du duel (ADR 0011) ------------------------------

    /// Un finisseur de durée fixée (le WPM n'entre pas dans le choix du duel).
    fn fin(id: &str, duration_ms: f64) -> RaceResult {
        RaceResult {
            player_id: id.to_string(),
            wpm: 0.0,
            accuracy: 0.0,
            duration_ms,
            forfeit: false,
            per_second: Vec::new(),
        }
    }

    #[test]
    fn duel_choisit_la_paire_la_plus_serree_ou_qu_elle_soit_au_classement() {
        // L'exemple de l'ADR : 0,0 / +8,1 / +8,4 / +19,0 → l'écart mini (0,3 s) est
        // entre les 2e et 3e, pas en tête.
        let results = vec![
            fin("alice", 10_000.0),
            fin("bob", 18_100.0),
            fin("carol", 18_400.0),
            fin("dave", 29_000.0),
        ];
        assert_eq!(duel(&results), Some((1, 2)));
    }

    #[test]
    fn duel_aucun_si_le_meilleur_ecart_depasse_deux_secondes() {
        let results = vec![fin("a", 10_000.0), fin("b", 13_000.0)]; // 3 s
        assert_eq!(duel(&results), None);
    }

    #[test]
    fn duel_le_seuil_de_deux_secondes_est_inclusif() {
        let results = vec![fin("a", 10_000.0), fin("b", 12_000.0)]; // exactement 2,0 s
        assert_eq!(duel(&results), Some((0, 1)));
    }

    #[test]
    fn duel_ignore_les_abandons() {
        // Deux finisseurs serrés + deux abandons (toujours en queue de classement) :
        // le duel ne voit que les finisseurs.
        let results = vec![
            fin("a", 10_000.0),
            fin("b", 10_500.0),
            RaceResult::forfeited("c"),
            RaceResult::forfeited("d"),
        ];
        assert_eq!(duel(&results), Some((0, 1)));
    }

    #[test]
    fn duel_aucun_si_moins_de_deux_finisseurs() {
        // Un seul finisseur, le reste en abandon → pas de duel possible.
        let un = vec![fin("a", 10_000.0), RaceResult::forfeited("b")];
        assert_eq!(duel(&un), None);
        // Zéro finisseur (tout le monde a abandonné) → pas de duel non plus.
        let zero = vec![RaceResult::forfeited("a"), RaceResult::forfeited("b")];
        assert_eq!(duel(&zero), None);
    }

    #[test]
    fn duel_en_cas_d_egalite_prend_la_paire_la_mieux_classee() {
        // Deux écarts de 0,5 s : la première paire (la plus haute) gagne, déterministe.
        let results = vec![fin("a", 10_000.0), fin("b", 10_500.0), fin("c", 11_000.0)];
        assert_eq!(duel(&results), Some((0, 1)));
    }

    #[test]
    fn end_race_transporte_les_deux_logs_du_duel() {
        // Bout à bout : deux arrivées serrées → RaceOver porte le Play of the Game avec
        // les DEUX logs concernés (dérivés du chemin d'arrivée réel via record_finish).
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        let log = |t: f64| vec![Keystroke { t, k: "a".into(), ctrl: None }];
        record_finish(&rooms, "c1", fin("p1", 10_000.0), log(10_000.0));
        record_finish(&rooms, "c1", fin("p2", 10_500.0), log(10_500.0));

        let mut potg = None;
        while let Ok(ev) = rx.try_recv() {
            if let ServerEvent::RaceOver { play_of_the_game, .. } = ev {
                potg = play_of_the_game;
            }
        }
        let potg = potg.expect("un duel serré donne un Play of the Game");
        assert_eq!(potg.a, "p1");
        assert_eq!(potg.b, "p2");
        assert_eq!(potg.log_a.len(), 1); // le vrai log retenu, pas un placeholder
        assert_eq!(potg.log_b.len(), 1);
    }

    #[test]
    fn end_race_sans_duel_ne_transporte_pas_de_play_of_the_game() {
        // Un seul finisseur → pas de duel → play_of_the_game absent (bouton absent au podium).
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        start_race(&rooms, "c1", "p1");
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        record_finish(&rooms, "c1", fin("p1", 10_000.0), vec![Keystroke { t: 10_000.0, k: "a".into(), ctrl: None }]);

        let mut seen = false;
        while let Ok(ev) = rx.try_recv() {
            if let ServerEvent::RaceOver { play_of_the_game, .. } = ev {
                seen = true;
                assert!(play_of_the_game.is_none());
            }
        }
        assert!(seen, "RaceOver diffusé");
    }

    #[test]
    fn watchdog_clot_une_course_trop_longue_meme_si_tout_le_monde_est_encore_la() {
        // issue #24 : contrairement à l'abandon "tout le monde est parti" (#23), le
        // watchdog ferme même si des joueurs sont TOUJOURS connectés (silencieux depuis
        // 10 min : perte réseau, crash — pas de LeaveRoom envoyé).
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        start_race(&rooms, "c1", "p1");
        let start = match &rooms.lock().unwrap().get("c1").unwrap().state {
            RaceState::Racing { start_at_epoch_ms, .. } => *start_at_epoch_ms,
            RaceState::Lobby => panic!("pas en course"),
        };
        let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

        close_overlong_races(&rooms, start + RACE_MAX_DURATION_MS - 1); // pas encore expiré
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

        close_overlong_races(&rooms, start + RACE_MAX_DURATION_MS + 1); // expiré
        assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

        // p1 et p2 (jamais finis, toujours "connectés") apparaissent à 0 WPM.
        let mut finished_wpm = std::collections::HashMap::new();
        while let Ok(ev) = rx.try_recv() {
            if let ServerEvent::PlayerFinished { player_id, wpm, .. } = ev {
                finished_wpm.insert(player_id, wpm);
            }
        }
        assert_eq!(finished_wpm.get("p1"), Some(&0.0));
        assert_eq!(finished_wpm.get("p2"), Some(&0.0));

        // Room utilisable de nouveau (revanche).
        start_race(&rooms, "c1", "p1");
        assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
    }

    // --- Display identity (piste, podium) -----------------------------------------

    fn entries(rooms: &Rooms, key: &str) -> Vec<PlayerEntry> {
        let guard = rooms.lock().unwrap();
        match room_state(guard.get(key).unwrap()) {
            ServerEvent::RoomState { players, .. } => players,
            _ => panic!("room_state renvoie un RoomState"),
        }
    }

    #[test]
    fn la_display_identity_voyage_jusqu_a_la_piste() {
        let rooms = new_rooms();
        join_channel(
            &rooms,
            "c1",
            "111",
            Identity { display_name: "Alice".into(), avatar_hash: Some("abc123".into()) },
        )
        .unwrap();
        let e = entries(&rooms, "c1");
        assert_eq!(e[0].player_id, "111"); // le snowflake reste la vérité durable
        assert_eq!(e[0].display_name, "Alice");
        assert_eq!(e[0].avatar_hash.as_deref(), Some("abc123"));
    }

    #[test]
    fn un_present_sans_nom_retombe_sur_son_snowflake() {
        // Jamais joli, mais jamais une carte vide non plus.
        let rooms = new_rooms();
        join_channel(&rooms, "c1", "111", Identity { display_name: "".into(), avatar_hash: None })
            .unwrap();
        assert_eq!(entries(&rooms, "c1")[0].display_name, "111");
    }

    #[test]
    fn une_identite_est_oubliee_en_partant() {
        // Le glossaire l'exige : annoncée à l'arrivée, affichée, puis oubliée.
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        join(&rooms, "c1", "p2");
        leave_room(&rooms, "c1", "p2");
        assert!(!rooms.lock().unwrap().get("c1").unwrap().identities.contains_key("p2"));
    }

    #[test]
    fn un_nom_demesure_ou_un_hash_fantaisiste_ne_degradent_pas_l_ecran_des_autres() {
        // Le rendu client échappe déjà le HTML : le sujet ici, c'est la mise en page des
        // SEPT autres joueurs, et un hash qui désignerait un chemin arbitraire du CDN.
        let s = Identity {
            display_name: format!("A\u{0}li\nce{}", "x".repeat(500)),
            avatar_hash: Some("../../evil".into()),
        }
        .sanitized();
        assert!(s.display_name.chars().count() <= 32);
        assert!(!s.display_name.contains('\n') && !s.display_name.contains('\u{0}'));
        assert_eq!(s.avatar_hash, None); // jeté : l'avatar par défaut est un repli valable
    }

    #[test]
    fn un_avatar_anime_garde_son_prefixe() {
        let s = Identity { display_name: "Bob".into(), avatar_hash: Some("a_1234abcd".into()) }
            .sanitized();
        assert_eq!(s.avatar_hash.as_deref(), Some("a_1234abcd"));
    }

    // --- Source de texte (ADR 0009) -----------------------------------------------

    fn source_of(rooms: &Rooms, key: &str) -> TextSource {
        rooms.lock().unwrap().get(key).unwrap().text_source
    }

    fn word_count_of(rooms: &Rooms, key: &str) -> usize {
        rooms.lock().unwrap().get(key).unwrap().target_text.split(' ').count()
    }

    #[test]
    fn une_room_neuve_demande_une_quote_mais_a_deja_un_texte() {
        // La Source par défaut est Quote, or aller chercher une citation demande un
        // aller-retour réseau impossible sous le verrou : la Room naît donc avec des mots.
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        assert_eq!(source_of(&rooms, "c1"), TextSource::Quote);
        assert_eq!(word_count_of(&rooms, "c1"), ROOM_WORD_COUNT as usize);
    }

    #[test]
    fn seul_l_owner_regle_la_source() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1"); // owner
        join(&rooms, "c1", "p2");

        assert!(!set_text_source(&rooms, "c1", "p2", TextSource::Words { count: 15 }));
        assert_eq!(source_of(&rooms, "c1"), TextSource::Quote); // inchangé

        assert!(set_text_source(&rooms, "c1", "p1", TextSource::Words { count: 15 }));
        assert_eq!(source_of(&rooms, "c1"), TextSource::Words { count: 15 });
    }

    #[test]
    fn la_source_ne_change_pas_pendant_une_course() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        start_race(&rooms, "c1", "p1");
        assert!(!set_text_source(&rooms, "c1", "p1", TextSource::Words { count: 50 }));
        assert_eq!(source_of(&rooms, "c1"), TextSource::Quote);
    }

    #[test]
    fn une_longueur_arbitraire_est_refusee() {
        // Frontière de confiance : le count vient du client et s'impose aux 7 autres.
        // Une course de 100 000 mots ne doit pas être demandable.
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        for count in [1, 31, 100_000] {
            assert!(!set_text_source(&rooms, "c1", "p1", TextSource::Words { count }));
        }
        for count in WORDS_LENGTHS {
            assert!(set_text_source(&rooms, "c1", "p1", TextSource::Words { count }));
        }
    }

    #[test]
    fn la_revanche_respecte_la_longueur_choisie() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        set_text_source(&rooms, "c1", "p1", TextSource::Words { count: 15 });

        start_race(&rooms, "c1", "p1");
        assert_eq!(record(&rooms, "c1", done("p1", 60.0)), FinishOutcome::RaceOver);
        // end_race regénère immédiatement : le texte de la revanche fait bien 15 mots.
        assert_eq!(word_count_of(&rooms, "c1"), 15);
    }

    #[test]
    fn une_citation_est_ramenee_a_des_mots_separes_par_un_espace() {
        // Une citation arrive avec des retours à la ligne et des espaces doubles, or
        // target_text.split(' ') compte les mots et le client découpe pareil.
        assert_eq!(normalize_quote("  Be\n\nyourself;   everyone else\tis taken. "), "Be yourself; everyone else is taken.");
        assert_eq!(normalize_quote("mot").split(' ').count(), 1);
    }

    // --- Clé de Room : salon vocal ou Code de partie (ADR 0008) --------------------

    #[test]
    fn un_code_de_partie_est_lisible_a_l_oral() {
        let rooms = new_rooms();
        let (code, _rx) = create_room(&rooms, "p1", ident("p1"));
        assert_eq!(code.len(), CODE_LEN);
        // Aucun caractère visuellement ambigu : c'est un code qu'on dicte.
        assert!(code.chars().all(|c| CODE_ALPHABET.contains(&(c as u8))));
        assert!(!code.contains(&['0', 'O', '1', 'I', 'L'][..]));
        // Et jamais confondable avec un snowflake Discord (18-19 chiffres).
        assert!(code.len() < 18);
    }

    #[test]
    fn create_room_met_son_createur_dedans_comme_owner() {
        let rooms = new_rooms();
        let (code, _rx) = create_room(&rooms, "p1", ident("p1"));
        let guard = rooms.lock().unwrap();
        let room = guard.get(&code).unwrap();
        assert_eq!(room.players, s(&["p1"])); // le créateur est le 1er arrivé…
        assert_eq!(room.owner, "p1"); // …donc l'owner, par la règle habituelle
        assert_eq!(room.code, Some(code.clone())); // le lobby peut afficher le code
    }

    #[test]
    fn un_code_inconnu_ne_cree_rien() {
        // Le cœur de l'ADR 0008 : sans ça, une faute de frappe enfermerait le joueur
        // seul dans une Room fantôme où il attendrait sans jamais comprendre.
        let rooms = new_rooms();
        assert_eq!(join_code(&rooms, "ZZZZZ", "p1", ident("p1")).err(), Some(JoinError::NotFound));
        assert!(rooms.lock().unwrap().is_empty());
    }

    #[test]
    fn deux_codes_tires_de_suite_ne_collisionnent_pas() {
        // Les nanos ne bougent que dans les poids faibles : sans le mélange
        // multiplicatif + sel, deux créations rapprochées tomberaient sur le même code.
        let rooms = new_rooms();
        let (a, _ra) = create_room(&rooms, "p1", ident("p1"));
        let (b, _rb) = create_room(&rooms, "p2", ident("p2"));
        assert_ne!(a, b);
        assert_eq!(rooms.lock().unwrap().len(), 2);
    }

    #[test]
    fn un_code_meurt_avec_sa_room() {
        let rooms = new_rooms();
        let (code, _rx) = create_room(&rooms, "p1", ident("p1"));
        leave_room(&rooms, &code, "p1"); // dernier présent : Room retirée
        assert!(rooms.lock().unwrap().is_empty());
        // Le code n'est ni persisté ni réservé : le rejoindre échoue comme n'importe quel inconnu.
        assert_eq!(join_code(&rooms, &code, "p2", ident("p2")).err(), Some(JoinError::NotFound));
    }

    #[test]
    fn salon_et_code_cohabitent_dans_la_meme_map() {
        let rooms = new_rooms();
        join(&rooms, "123456789012345678", "p1"); // snowflake : créé à la volée
        let (code, _rx) = create_room(&rooms, "p2", ident("p2"));
        assert_eq!(rooms.lock().unwrap().len(), 2);
        // La Room de salon n'a pas de code, celle du code en a un.
        assert!(rooms.lock().unwrap().get("123456789012345678").unwrap().code.is_none());
        assert!(rooms.lock().unwrap().get(&code).unwrap().code.is_some());
    }

    #[test]
    fn le_neuvieme_joueur_est_refuse() {
        let rooms = new_rooms();
        for i in 0..MAX_PLAYERS {
            join(&rooms, "c1", &format!("p{i}"));
        }
        assert_eq!(players_of(&rooms, "c1").len(), MAX_PLAYERS);

        assert_eq!(join_channel(&rooms, "c1", "p8", ident("p8")).err(), Some(JoinError::Full));
        assert_eq!(players_of(&rooms, "c1").len(), MAX_PLAYERS); // les 8 premiers intacts
        assert!(!players_of(&rooms, "c1").contains(&"p8".to_string()));
    }

    #[test]
    fn rejoindre_deux_fois_ne_consomme_pas_de_place() {
        // Une reconnexion ne doit pas remplir la Room avec le même joueur.
        let rooms = new_rooms();
        for i in 0..MAX_PLAYERS {
            join(&rooms, "c1", &format!("p{i}"));
        }
        join(&rooms, "c1", "p0"); // déjà là : accepté, sans nouvelle place
        assert_eq!(players_of(&rooms, "c1").len(), MAX_PLAYERS);
    }

    #[test]
    fn watchdog_ignore_les_rooms_en_lobby() {
        let rooms = new_rooms();
        join(&rooms, "c1", "p1");
        close_overlong_races(&rooms, now_epoch_ms() + 100 * RACE_MAX_DURATION_MS);
        assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing()); // toujours Lobby, intact
    }
}
