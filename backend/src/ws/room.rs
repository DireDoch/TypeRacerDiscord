// =============================================================================
//  ws/room.rs — la Room comme LIEU (issue #205).
//
//  Ce que ce module possède : entrer et sortir d'une Room (par salon vocal ou par Code
//  de partie, ADR 0008), la présence et l'owner, le tirage d'un Code, et le TEXTE d'une
//  Room — sa génération, sa Source, et l'aller-retour réseau d'une citation.
//
//  Ce qu'il ne possède pas : le déroulé d'une course (`ws/race_engine.rs`), le fil et le
//  dispatch (`ws/mod.rs`), la garde des Réglages (`ws/room_setting.rs`), les règles d'un
//  Mode de jeu (`ws/game_mode.rs`).
//
//  `close_race` est appelée d'ici — un départ peut clore une course — mais vit dans le
//  moteur : c'est lui qui sait ce que clore veut dire.
// =============================================================================

use super::*;

/// Room du salon vocal : CRÉÉE à la volée si absente. La clé vient du SDK Discord, elle
/// est authentique — il n'y a pas de faute de frappe possible à protéger.
pub(crate) fn join_channel(
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
pub(crate) fn create_room(
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
pub(crate) fn join_code(
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
pub(crate) fn new_room(key: RoomKey, code: Option<String>, owner: &str) -> Room {
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
        max_players: MAX_PLAYERS,
        countdown_s: DEFAULT_COUNTDOWN_S,
        ready_check: false,
        ready: HashSet::new(),
        difficulty: Difficulty::Normal,
        game_mode: GameMode::default(),
        lava_interval_s: LAVA_INTERVAL_DEFAULT,
        spam_word: None,
        spam_threshold: SPAM_THRESHOLD_DEFAULT,
        spam_time_cap_s: SPAM_TIME_CAP_DEFAULT,
        state: RaceState::Lobby,
        tx,
    }
}

/// Texte généré : renvoie (seed, texte). Le serveur possède les deux (vérité terrain).
pub(crate) fn words_text(count: u32) -> (u64, String) {
    let seed = fresh_seed();
    let text =
        generate_text(&GenSettings { punctuation: false, numbers: false }, count as usize, seed)
            .join(" ");
    (seed as u64, text)
}

/// Le mot répété, séparé par UN espace — exactement la forme qu'attendent déjà
/// `FreeInput` et `replay_target`. C'est tout ce que « texte de Spam » veut dire, et c'est
/// pourquoi le mode n'apporte aucun code de saisie : le curseur libre existant s'y
/// applique tel quel (ADR 0016).
pub(crate) fn spam_text(word: &str, count: usize) -> String {
    vec![word; count].join(" ")
}

/// Repose le `target_text` d'une Room sous Spam : son mot, posé assez loin devant pour
/// remplir les lignes visibles au départ. Le client allonge ensuite tout seul.
///
/// SYNCHRONE, sous le verrou — contrairement à une Source de texte, Spam ne demande aucun
/// aller-retour réseau. C'est pourquoi `pending_source` renvoie `None` sous ce mode :
/// `spawn_refresh_text` n'aurait rien à faire, et surtout rien à aller chercher.
pub(crate) fn refresh_spam_text(room: &mut Room) {
    let seed = fresh_seed();
    let word = match &room.spam_word {
        Some(w) => w.clone(),
        // Mot par défaut : un tirage dans la liste de mots de la Source `Mots`, seedé
        // pareil (ADR 0016). `generate_text(.., 1, seed)` EST ce tirage — la liste reste
        // privée à `text_gen`, et il n'y a aucun second chemin de génération à tenir.
        None => generate_text(&GenSettings { punctuation: false, numbers: false }, 1, seed)
            .pop()
            .unwrap_or_else(|| "spam".to_string()),
    };
    room.seed = seed as u64;
    room.target_text = spam_text(&word, SPAM_LEAD_WORDS);
}

/// Le mot en jeu d'une Room sous Spam, relu du texte : il en EST la répétition. Évite de
/// promener `spam_word` en parallèle du texte, et donc de pouvoir les désaccorder.
pub(crate) fn spam_word_of(target_text: &str) -> &str {
    target_text.split(' ').next().unwrap_or("")
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
pub(crate) fn spawn_refresh_text(rooms: Rooms, key: RoomKey, quotes: Arc<QuoteClient>) {
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
        // Le mode courant peut avoir changé pendant l'aller-retour : on relit sa règle
        // maintenant, pas celle lue au début de la tâche (#145). Seul un mode dont
        // `persists_source` est vrai (Normal) voit son texte résolu écrit dans
        // `room.text_source` — Floor is lava y écrirait le `Words{LAVA_WORD_COUNT}` qu'il
        // impose, effaçant la Source choisie par l'owner.
        if rules(room.game_mode).persists_source() {
            room.text_source = effective;
        }
        let _ = room.tx.send(room_state(room));
    });
}

/// Source d'une Room qui attend un texte, ou `None` s'il n'y a rien à regénérer : Room
/// disparue, course déjà lancée (on ne change pas le texte sous les doigts des joueurs),
/// ou Mode de jeu qui produit son propre texte sans réseau (#128 : `GameModeRules`).
pub(crate) fn pending_source(rooms: &Rooms, key: &str) -> Option<TextSource> {
    let guard = rooms.lock().unwrap();
    let room = guard.get(key)?;
    if room.state.is_racing() {
        return None;
    }
    rules(room.game_mode).pending_source(room)
}

/// Ramène une citation à la forme que le reste du moteur attend : des mots séparés par
/// UN espace. Une citation arrive avec des retours à la ligne et des espaces doubles,
/// or `target_text.split(' ')` compte les mots et le client découpe pareil.
pub(crate) fn normalize_quote(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// SetReady : n'importe quel présent se marque prêt/pas prêt, hors course. Un absent
/// (parti entre-temps) ne peut pas se déclarer prêt sur une Room qu'il a quittée.
pub(crate) fn set_ready(rooms: &Rooms, key: &str, player_id: &str, ready: bool) -> bool {
    let mut rooms = rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(key) else { return false };
    if !room.players.iter().any(|p| p == player_id) || room.state.is_racing() {
        return false;
    }
    if ready {
        room.ready.insert(player_id.to_string());
    } else {
        room.ready.remove(player_id);
    }
    let _ = room.tx.send(room_state(room));
    true
}

/// Tous les présents sont prêts, ou le ready-check est désactivé (issue #63) — la garde
/// que `start_race` ajoute à ses conditions habituelles (owner, hors course). Ready-check
/// OFF (défaut) : toujours vrai, comportement de départ inchangé.
pub(crate) fn all_present_ready(room: &Room) -> bool {
    !room.ready_check || room.players.iter().all(|p| room.ready.contains(p))
}

/// Inscrit la présence, s'abonne à la diffusion, puis re-diffuse RoomState à tous. Le
/// lock std n'est jamais tenu à travers un await (broadcast::send/subscribe sont
/// synchrones). Rejoindre deux fois est idempotent et ne consomme pas de place.
pub(crate) fn add_player(
    room: &mut Room,
    player_id: &str,
    identity: Identity,
) -> Result<broadcast::Receiver<ServerEvent>, JoinError> {
    let already_in = room.players.iter().any(|p| p == player_id);
    if !already_in && room.players.len() >= room.max_players {
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
pub(crate) fn generate_code(rooms: &HashMap<RoomKey, Room>) -> String {
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
pub(crate) fn leave_room(rooms: &Rooms, key: &str, player_id: &str) -> bool {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(key) {
        room.players.retain(|p| p != player_id);
        room.identities.remove(player_id); // jamais persistée, oubliée en partant
        room.ready.remove(player_id); // un absent ne reste pas "prêt" sans le savoir
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
