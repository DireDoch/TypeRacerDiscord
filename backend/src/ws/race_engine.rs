// =============================================================================
//  ws/race_engine.rs — le déroulé d'une course, du StartRace au RaceOver (issue #205).
//
//  Machine d'état PURE : aucun socket, aucune DB — sauf `finish_race`, qui reçoit le pool
//  pour persister le Run hors verrou. C'était déjà vrai avant #205 (le commentaire de
//  `record_finish` le disait) ; le fichier le dit maintenant aussi.
//
//  Ce que ce module possède : le départ et le gel des partants, le relais de progression,
//  les arrivées (arrivée, Abandon, Échec Master), la clôture et le classement, le Play of
//  the Game, le watchdog et les tics des Modes de jeu.
//
//  Ce qu'il ne possède pas : la présence et le texte d'une Room (`ws/room.rs`), le fil et
//  le dispatch (`ws/mod.rs`). Les règles PROPRES à un Mode de jeu vivent dans
//  `ws/game_mode.rs` (ADR 0017) — ce module les lit, il ne les contient pas.
// =============================================================================

use super::*;

/// Clôt une course en cours, déclarant abandon (0 WPM, pas de recompute sur un log vide —
/// l'accuracy y vaudrait 100, pas 0, piège de l'issue #23) tout partant pas encore fini.
/// Aucun Run n'est persisté pour un abandon : rien à exclure des PB, rien à polluer.
///
/// `require_absent` : si vrai, ne clôt QUE si aucun partant en attente n'est encore
/// connecté — abandon "tout le monde est parti" (#23, appelé depuis `leave_room`). Si
/// faux, clôt sans condition de présence — watchdog de durée expirée (#24, quelqu'un
/// peut très bien être encore connecté sans avoir rien envoyé depuis 10 minutes).
pub(crate) fn close_race(room: &mut Room, require_absent: bool) {
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
    if let RaceState::Racing { finishers, burned, .. } = &mut room.state {
        for r in &pending {
            // Un Brûlé dont le log n'est jamais revenu (client figé) est clos ici comme un
            // abandon. Il garde quand même son `burned_at_ms` : le podium dira « brûlé à
            // 32 s » plutôt que « abandon », ce qui est la vérité. Son RANG, lui, retombe
            // en queue avec les abandons — sans log il n'a ni score ni série, et le sortir
            // de la queue le ferait entrer dans le choix du duel avec un WPM fantôme à 0.
            // Chemin rare (10 min de silence) : on préfère l'étiquette juste au rang juste.
            let at = burned.iter().find(|(id, _)| id == r).map(|(_, at)| *at);
            finishers.push(RaceResult { burned_at_ms: at, ..RaceResult::forfeited(r) });
        }
    }
    for r in &pending {
        let _ = room.tx.send(ServerEvent::PlayerFinished {
            player_id: r.clone(),
            wpm: 0.0,
            forfeit: true,
            failed_percent: None,
        });
    }
    end_race(room);
}

/// Seuil au-delà duquel une course est jugée anormalement longue (issue #24) : un
/// client peut disparaître sans jamais envoyer LeaveRoom (perte réseau, crash) — un
/// watchdog client ne couvrirait pas ce cas, la fermeture doit venir du serveur. Zen et
/// Time infini n'existent pas en Race : 10 min est un plafond sûr pour le seul Mode
/// actuel (Words) — à revoir si la Race gagne un Mode à durée libre.
pub(crate) const RACE_MAX_DURATION_MS: i64 = 10 * 60 * 1000;
/// Fréquence de la boucle watchdog. Une seconde, pas trente : elle porte aussi le tic
/// d'élimination de floor is lava (ADR 0015), dont l'intervalle descend à 5 s. Une boucle
/// globale qui scanne les Rooms sans DB ni recompute coûte moins qu'un minuteur par Room —
/// dont il faudrait gérer l'annulation à `end_race` ET à la destruction de la Room, et
/// c'est là que vivent les bugs. Le seuil des 10 minutes ne souffre pas d'être vérifié
/// trente fois plus souvent.
pub(crate) const WATCHDOG_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

/// Le sursis accordé au log d'un joueur arrêté par le serveur, au-delà de l'instant d'arrêt
/// lui-même (issue #164, ADR 0018). Il ne pardonne pas une triche, il paie un retard réel :
/// sous Floor is lava l'instant retenu est le tic LOGIQUE alors que `PlayerBurned` part au
/// scan du watchdog (jusqu'à `WATCHDOG_CHECK_INTERVAL` plus tard), et dans les deux modes il
/// reste l'aller-retour réseau avant que le client ne s'arrête vraiment. Sans ce sursis, la
/// troncature mangeait la dernière seconde de frappe HONNÊTE de chaque brûlé — l'inverse
/// exact de ce que « tronquer plutôt que rejeter » avait décidé.
///
/// Il borne les FRAPPES retenues, jamais la durée : le dénominateur du WPM reste l'instant
/// d'arrêt exact, donc ce sursis n'ouvre aucune fenêtre à gonfler.
pub(crate) const STOP_GRACE_MS: f64 = 1500.0;

/// Clôt les Rooms dont la course dépasse RACE_MAX_DURATION_MS. Horloge injectée (`now`)
/// pour rester testable sans attendre 10 minutes en vrai (issue #24). Renvoie les clés
/// des Rooms closes, pour que l'appelant y regénère le texte hors verrou.
pub(crate) fn close_overlong_races(rooms: &Rooms, now: i64) -> Vec<RoomKey> {
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
            let now = now_epoch_ms();
            game_mode_tick(&rooms, now);
            for key in close_overlong_races(&rooms, now) {
                spawn_refresh_text(rooms.clone(), key, quotes.clone());
            }
        }
    });
}

/// Le tic du watchdog pour toutes les Rooms, quel que soit leur Mode de jeu — délègue à
/// `GameModeRules::tick` (#128), no-op sous `Normal`. Remplace les deux boucles
/// séparées (`lava_tick`/`spam_tick`) qui filtraient chacune `room.game_mode` elles-mêmes.
pub(crate) fn game_mode_tick(rooms: &Rooms, now: i64) {
    let mut rooms = rooms.lock().unwrap();
    for room in rooms.values_mut() {
        rules(room.game_mode).tick(room, now);
    }
}

/// Vivant sous floor is lava = partant qui n'est ni sorti (`finishers`) ni déjà condamné
/// (`burned`). Un abandon, un échec Master ou une déconnexion sortent donc des vivants sans
/// règle supplémentaire — ils passent tous par `finishers`.
///
/// Lu par DEUX endroits, d'où l'extraction (#163) : le tic d'élimination, qui décide qui
/// brûle, et `GameModeRules::finish_allowed`, qui reconnaît le dernier vivant — le seul
/// partant non brûlé qu'un `Finish` légitime puisse avoir pour auteur.
pub(crate) fn alive_racers(
    racers: &[PlayerId],
    finishers: &[RaceResult],
    burned: &[(PlayerId, f64)],
) -> Vec<PlayerId> {
    racers
        .iter()
        .filter(|r| {
            !finishers.iter().any(|f| f.player_id == **r)
                && !burned.iter().any(|(id, _)| id == *r)
        })
        .cloned()
        .collect()
}

/// Le tic d'élimination de floor is lava (ADR 0015) : brûle le partant le moins avancé,
/// une fois par intervalle écoulé. Horloge injectée (`now`) pour rester testable sans
/// attendre en vrai, comme `close_overlong_races`. Référencé depuis `game_mode::FLOOR_IS_LAVA`
/// (#128) — jamais appelé pour une Room qui n'est pas sous ce mode.
///
/// Rattrape les tics manqués (boucle `while`) : la boucle peut avoir pris du retard, et
/// un tic sauté ferait durer la course plus longtemps que le réglage annoncé. L'instant
/// enregistré est l'instant LOGIQUE (`n × intervalle`), jamais celui du scan — le
/// classement et l'affichage restent exacts même si l'annonce arrive avec du retard.
///
/// Ne clôt jamais la course lui-même : chaque brûlé renvoie son log via `Finish` et c'est
/// l'arrivée du dernier log attendu qui déclenche `end_race`, exactement comme une Race
/// normale. Le survivant fait pareil dès qu'il se voit seul.
pub(crate) fn lava_tick_room(room: &mut Room, now: i64) {
    // `max(1)` : une division par zéro paniquerait tout le watchdog. La valeur est
    // validée à l'entrée, mais la garde coûte moins cher que la confiance.
    let interval_ms = (room.lava_interval_s as i64).max(1) * 1000;
    let mut announce: Vec<(PlayerId, f64)> = Vec::new();
    if let RaceState::Racing {
        start_at_epoch_ms, racers, finishers, progress, burned, lava_ticks, ..
    } = &mut room.state
    {
        let due = ((now - *start_at_epoch_ms) / interval_ms).max(0) as u32;
        while *lava_ticks < due {
            *lava_ticks += 1;
            let alive = alive_racers(racers, finishers, burned);
            // « au plus un vivant » : plus rien à brûler. Zéro est atteignable — une
            // égalité entre les deux derniers les emporte tous les deux et la course
            // n'a pas de vainqueur (ADR 0015), un cas spécial de moins.
            if alive.len() <= 1 {
                break;
            }
            let least = alive
                .iter()
                .map(|r| progress.get(r).copied().unwrap_or(0))
                .min()
                .unwrap_or(0);
            let at_ms = (*lava_ticks as i64 * interval_ms) as f64;
            // Égalité : TOUS les ex æquo brûlent. Départager sur l'ordre d'arrivée des
            // paquets serait un tirage au sort invisible ; deux flammes d'un coup se
            // voient et s'expliquent.
            for id in alive.into_iter().filter(|r| progress.get(r).copied().unwrap_or(0) == least)
            {
                burned.push((id.clone(), at_ms));
                announce.push((id, at_ms));
            }
        }
    }
    // Diffusé hors de l'emprunt mutable de `state`. C'est ce message qui dit au brûlé
    // d'arrêter de taper et de renvoyer son log ; les autres y lisent qui est mort.
    for (player_id, at_ms) in announce {
        let _ = room.tx.send(ServerEvent::PlayerBurned { player_id, at_ms });
    }
}

/// Arrête une Race sous Spam (ADR 0016). Les deux façons de gagner y mènent — un Player
/// qui verrouille le seuil (`relay_progress`) ou le plafond de temps qui expire
/// (`spam_tick`) — et le mode ne les distingue pas, donc un seul chemin ici.
///
/// Ne clôt PAS la course lui-même : chaque partant renvoie son log via `Finish` et c'est
/// l'arrivée du dernier log attendu qui déclenche `end_race`, exactement comme une Race
/// normale et comme floor is lava. Ne désigne aucun vainqueur non plus : le classement
/// vient du recompute serveur au `Finish`, jamais du compte déclaré qui a claqué l'arrêt.
///
/// Horloge injectée (`now`), comme partout ailleurs dans ce module : c'est de `now` que
/// sort l'instant retenu, et cet instant borne ensuite les logs (#164).
///
/// Renvoie `true` si c'est CET appel qui a arrêté la course (une seule diffusion).
pub(crate) fn stop_spam(room: &mut Room, now: i64) -> bool {
    // La marque se pose SOUS l'emprunt de `state`, la diffusion se fait dehors — même
    // découpage que `lava_tick` et `close_race`, pour ne jamais tenir `&mut room.state`
    // et `room.tx` en même temps.
    let fresh = match &mut room.state {
        RaceState::Racing { start_at_epoch_ms, spam_stopped_at_ms, .. }
            if spam_stopped_at_ms.is_none() =>
        {
            // `max(0)` : un arrêt AVANT le GO date de t=0, ce qui est exact — pendant le
            // décompte personne n'a encore pu taper, donc borner les logs à zéro est la
            // bonne réponse et pas une dégradation.
            //
            // ponytail: si l'horloge système reculait EN COURS de course, ce même `max(0)`
            // rendrait 0 et mettrait toute la Room à 0 wpm. Plafond assumé : tout ce module
            // suppose déjà `now_epoch_ms()` à peu près monotone (`lava_tick_room` raterait
            // ses tics, `spam_tick_room` son plafond). Le durcir voudrait dire une horloge
            // monotone (`Instant`) par Room, à faire pour tout le module ou pas du tout.
            *spam_stopped_at_ms = Some((now - *start_at_epoch_ms).max(0) as f64);
            true
        }
        _ => false,
    };
    if fresh {
        let _ = room.tx.send(ServerEvent::SpamStop);
    }
    fresh
}

/// Le plafond de temps de Spam (ADR 0016) : si personne n'a atteint le seuil quand il
/// expire, la Race s'arrête et c'est le plus de répétitions qui gagne. Le SEUIL, lui, est
/// vérifié à chaud dans `relay_progress` — l'attendre ici le ferait traîner jusqu'à une
/// seconde après la répétition gagnante, alors que le mode promet une victoire immédiate.
///
/// Horloge injectée (`now`), comme `lava_tick_room` et `close_overlong_races` : testable
/// sans attendre le plafond en vrai. Référencé depuis `game_mode::SPAM` (#128) — jamais
/// appelé pour une Room qui n'est pas sous ce mode.
pub(crate) fn spam_tick_room(room: &mut Room, now: i64) {
    // Le plafond court depuis GO. Plus rien à compenser ici : `start_at_epoch_ms` EST le
    // GO (`start_race`). Ce mode ajoutait autrefois le décompte de son côté — une
    // correction locale que Floor is lava n'avait pas, et c'est exactement ce qui l'a tué.
    let cap_ms = (room.spam_time_cap_s as i64) * 1000;
    let expired = match &room.state {
        RaceState::Racing { start_at_epoch_ms, .. } => now - start_at_epoch_ms >= cap_ms,
        RaceState::Lobby => false,
    };
    if expired {
        stop_spam(room, now);
    }
}

/// StartRace : accepté du seul owner, hors course en cours, et seulement si le
/// ready-check (s'il est activé) est satisfait par tous les présents (issue #63). Fige
/// les partants, fixe t=0 — **le GO, décompte inclus** — et le diffuse.
pub(crate) fn start_race(rooms: &Rooms, key: &str, player_id: &str) {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(key) {
        if room.owner != player_id || room.state.is_racing() || !all_present_ready(room) {
            return; // non-owner, course déjà lancée, ou ready-check pas encore satisfait
        }
        // Effectif minimum du Mode de jeu (`GameModeRules::min_players_to_start`, #128) :
        // Floor is lava exige deux partants (ADR 0015, seul on est DÉJÀ le dernier vivant,
        // la course serait finie à t=0) ; Normal et Spam n'exigent rien de plus qu'un seul
        // présent (ADR 0016 : courir seul contre un seuil ou une horloge reste un jeu).
        if room.players.len() < rules(room.game_mode).min_players_to_start {
            return;
        }
        // t=0 est le GO — la fin du décompte —, PAS l'instant du clic. Le client cale son
        // `RunClock` sur le GO et date ses frappes depuis là ; le serveur doit compter sur
        // la même origine, sinon toutes ses règles temporelles s'appliquent pendant que
        // personne ne peut encore taper. Floor is lava en mourait littéralement : avec le
        // décompte par défaut (7 s à l'époque) et un intervalle de 5 s, la première élimination
        // tombait 2 s AVANT le GO, tous les partants à 0 caractère — égalité, donc TOUT LE
        // MONDE brûlait, et la Room restait figée jusqu'au watchdog de 10 minutes.
        let start = now_epoch_ms() + (room.countdown_s as i64) * 1000;
        room.state = RaceState::Racing {
            start_at_epoch_ms: start,
            racers: room.players.clone(),
            finishers: Vec::new(),
            logs: HashMap::new(),
            progress: HashMap::new(),
            burned: Vec::new(),
            lava_ticks: 0,
            spam_stopped_at_ms: None,
        };
        let _ = room.tx.send(ServerEvent::RaceStart { start_at_epoch_ms: start });
    }
}

/// Relaie la progression d'un joueur aux autres (rendu des barres). Non autoritaire.
/// Horloge injectée (`now`), comme `lava_tick_room`/`spam_tick_room`/`close_overlong_races`
/// : c'est ici que le seuil de Spam coupe la course, donc ici que naît l'instant d'arrêt qui
/// borne ensuite tous les logs (#164). Le lire en interne rendait ce chemin — le principal
/// des deux — impossible à asserter.
pub(crate) fn relay_progress(rooms: &Rooms, key: &str, player_id: &str, chars_done: u32, reps: u32, now: i64) {
    let mut rooms = rooms.lock().unwrap();
    if let Some(room) = rooms.get_mut(key) {
        // Retenu pour le tic d'élimination (ADR 0015). Monotone : on ne garde que la
        // valeur la plus haute reçue, sinon un `Progress` en retard remis dans le désordre
        // ferait reculer un joueur juste avant un tic et le tuerait pour un artefact
        // d'ordonnancement. La progression d'une Race ne recule jamais de toute façon.
        //
        // `reps` n'est PAS retenu, lui : la seule question qu'on lui pose est « celui-ci
        // vient-il d'atteindre le seuil ? », et elle se répond sur la valeur qui arrive.
        // Un compte de répétitions, contrairement à une progression, peut légitimement
        // reculer (Backspace rouvre un mot verrouillé) — le mémoriser au maximum vu
        // arrêterait la course sur un pic annulé depuis.
        if let RaceState::Racing { progress, .. } = &mut room.state {
            let seen = progress.entry(player_id.to_string()).or_insert(0);
            *seen = (*seen).max(chars_done);
        }
        let _ = room.tx.send(ServerEvent::PlayerProgress {
            player_id: player_id.to_string(),
            chars_done,
            reps,
        });
        // Seuil atteint (ADR 0016) : la Race s'arrête pour tout le monde, sur-le-champ.
        // Vérifié ICI et pas au tic du watchdog, parce que `Progress` part exactement au
        // verrouillage d'un mot (#94) — c'est-à-dire à l'instant même où une répétition se
        // termine, à la milliseconde près plutôt qu'à la seconde.
        //
        // Réservé aux PARTANTS, figés au RaceStart : `relay_progress` accepte le `Progress`
        // de n'importe quel présent (les barres ne s'en portent pas plus mal), mais arrêter
        // la course est une autre affaire — sans ce filtre, un spectateur arrivé en cours
        // de course couperait la manche des autres avec un seul message. Même raison que
        // `lava_tick`, qui ne regarde lui aussi que `racers`.
        //
        // ponytail: `reps` reste déclaratif, comme `chars_done` l'est pour floor is lava
        // (ADR 0015). Le plafond assumé est donc un grief entre partants : un client qui
        // ment arrête la course trop tôt, il ne la gagne pas — le classement de `end_race`
        // vient du recompute serveur sur son log. Le durcir voudrait dire recompter le log
        // à chaque mot verrouillé, pour huit joueurs, à chaque seconde.
        let is_racer = match &room.state {
            RaceState::Racing { racers, .. } => racers.iter().any(|r| r == player_id),
            RaceState::Lobby => false,
        };
        // `GameModeRules::on_progress` (#128) : no-op hors Spam, vérifie le seuil sous Spam.
        if is_racer {
            rules(room.game_mode).on_progress(room, reps, now);
        }
    }
}

/// Résultat d'une tentative d'enregistrer une arrivée.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum FinishOutcome {
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
pub(crate) fn record_finish(rooms: &Rooms, key: &str, mut result: RaceResult, log: Vec<Keystroke>) -> FinishOutcome {
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
    let failed_percent = result.failed_percent;
    let RaceState::Racing { finishers, logs, burned, .. } = &mut room.state else { unreachable!("vérifié ci-dessus") };
    // Brûlé (ADR 0015) : le serveur SAIT qui il a condamné — c'est lui qui a décidé au
    // tic — il ne le demande donc pas au client. Le log, lui, arrive par le `Finish`
    // existant : « voici mon log, j'ai fini » veut déjà dire exactement ça. Le survivant
    // envoie le sien pareil, et repart d'ici avec `burned_at_ms: None`.
    //
    // Réservé à une VRAIE arrivée (`forfeit: false`, `failed_percent: None`) : un
    // Abandon/Échec Master passe aussi par ici (`forfeit_race`/`fail_race`), et peut
    // perdre la course du lock contre `lava_tick` — le partant est alors déjà dans
    // `burned` au moment où son Abandon/Échec s'enregistre. Sans cette garde, la vraie
    // cause (abandon volontaire, faute) serait maquillée en brûlure sur le podium.
    if !result.forfeit && result.failed_percent.is_none() {
        if let Some((_, at)) = burned.iter().find(|(id, _)| *id == player_id) {
            result.burned_at_ms = Some(*at);
        }
    }
    logs.insert(player_id.clone(), log);
    finishers.push(result);
    // PlayerFinished reste le signal LIVE « untel a fini » : le podium ne s'en nourrit
    // plus, il lit RaceOver (ADR 0010). `forfeit` fait afficher « abandon » sur la piste,
    // `failed_percent` fait afficher « échec (X%) » (ADR 0013) — jamais les deux ensemble.
    let _ = room.tx.send(ServerEvent::PlayerFinished { player_id, wpm, forfeit, failed_percent });

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
pub(crate) fn forfeit_race(rooms: &Rooms, key: &str, player_id: &str) -> bool {
    // Log vide : un abandon n'est jamais choisi pour un Play of the Game (ADR 0011).
    record_finish(rooms, key, RaceResult::forfeited(player_id), Vec::new()) == FinishOutcome::RaceOver
}

/// Échec Difficulté Master (issue #71, ADR 0013) : le client a détecté localement sa 1re
/// frappe incorrecte, mais le serveur REJOUE le log contre SON texte avant d'y croire —
/// même frontière de confiance que Finish. Rejette si la Room n'est pas sous Master, si
/// le partant n'est pas éligible, ou si le recompute ne confirme PAS d'échec (le client
/// s'est trompé, ou a triché). Renvoie `true` si cet échec a CLOS la course, comme
/// `forfeit_race`/`finish_race`.
pub(crate) fn fail_race(rooms: &Rooms, key: &str, player_id: &str, keystrokes: Vec<Keystroke>) -> bool {
    let (target_text, difficulty) = {
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
        (room.target_text.clone(), room.difficulty)
    };
    if difficulty != Difficulty::Master {
        return false; // Room pas sous Master : rien à confirmer, requête ignorée
    }
    let target_words: Vec<String> = target_text.split(' ').map(str::to_string).collect();
    let Some(fail) = detect_difficulty_failure(Difficulty::Master, &target_words, &keystrokes) else {
        return false; // le recompute NE confirme PAS d'échec : rejeté
    };
    // Log vide : un échec n'est, comme un abandon, jamais choisi pour un Play of the Game.
    record_finish(rooms, key, RaceResult::failed(player_id, fail.percent), Vec::new())
        == FinishOutcome::RaceOver
}

/// Finish : recompute AUTORITAIRE contre le texte du serveur, puis enregistre l'arrivée
/// (`record_finish`). Le Run est aussi persisté dans `runs` (kind "race") — historique
/// seulement, jamais PB : la fin stricte (texte 100 % exact) le rend incomparable aux
/// buckets Practice.
/// Renvoie `true` si cette arrivée a CLOS la course (dernier partant attendu) — l'appelant
/// regénère alors le texte depuis la Source, hors verrou.
pub(crate) fn finish_race(
    rooms: &Rooms,
    key: &str,
    player_id: &str,
    mut keystrokes: Vec<Keystroke>,
    _ended_at_ms: f64, // wire uniquement : la durée vient du log, jamais du client (issue #11)
    pool: &SqlitePool,
) -> bool {
    // Vérif préliminaire, bref verrou : évite le recompute (coûteux) pour un partant déjà
    // rejeté d'office. `record_finish` refait l'authoritative check plus bas, verrou séparé.
    let (target_text, game_mode, allowed, stopped_at_ms) = {
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
        // Lus SOUS CE VERROU, pas un deuxième : la garde (#163) comme la borne (#164)
        // interrogent l'état de la Room — brûlés, arrêt du Spam — et il est déjà là,
        // ouvert, pour l'éligibilité.
        let allowed = rules(room.game_mode).finish_allowed(room, player_id);
        let stopped_at_ms = rules(room.game_mode).stopped_at_ms(room, player_id, now_epoch_ms());
        (room.target_text.clone(), room.game_mode, allowed, stopped_at_ms)
    };

    // Un `Finish` que le Mode de jeu n'a jamais réclamé (issue #163) : sous Floor is lava
    // et sous Spam, c'est le SERVEUR qui décide qu'un joueur a fini, et le client ne fait
    // que livrer le log qu'on lui demande. Envoyé spontanément, il n'annonce rien — il
    // sort son auteur de la course à l'instant de son choix. Enregistré comme un abandon,
    // exactement comme la garde de #160 juste en dessous : ça débloque la fin pour les
    // autres au lieu de laisser la Room pendue jusqu'au watchdog.
    if !allowed {
        eprintln!("Finish spontané ({player_id}, {game_mode:?}) : enregistré en abandon");
        return forfeit_race(rooms, key, player_id);
    }

    // La borne temporelle du log (issue #164, ADR 0018). #163 garde QUI a le droit d'envoyer
    // un `Finish` sous un Mode de jeu ; il ne garde pas ce que ce log a le droit de DIRE —
    // un brûlé parfaitement légitime pouvait livrer 200 caractères parfaits horodatés sur
    // 2 s, faux WPM au podium et Play of the Game raflé (ADR 0011).
    //
    // TRONQUÉ (au sursis près, `STOP_GRACE_MS`) et pas rejeté : entre l'annonce
    // (`PlayerBurned`, `SpamStop`) et l'arrêt effectif du client il y a un aller-retour
    // réseau, une frappe en vol est donc la norme et pas une triche. La moitié qui ferme
    // vraiment le trou est plus bas, `duration_override_ms` sur le recompute : le log gonflé
    // de l'exemple est COMPRESSÉ, il tient tout entier sous la borne et survivrait à cette
    // seule troncature.
    //
    // `None` sous Normal, et c'est voulu : le joueur s'y arrête lui-même en franchissant la
    // ligne, aucun instant serveur à lui opposer — `requires_full_text` (#160) y suffit.
    if let Some(at) = stopped_at_ms {
        keystrokes.retain(|k| k.t <= at + STOP_GRACE_MS);
    }

    // Sous Spam le texte cible est INFINI (ADR 0016) : plutôt que de deviner une longueur
    // d'avance, le recompute reconstruit exactement ce qu'il faut de mot répété pour
    // couvrir CE log. Un espace journalisé verrouille au plus un mot, donc leur nombre
    // borne la pile ; le +1 couvre la répétition en cours, jamais verrouillée. Identité
    // pour les autres modes (`GameModeRules::recompute_target_text`, #128).
    //
    // Surprovisionner est sans effet sur les chiffres : `replay_target` ne compte Extra et
    // Missed que sur les mots ATTEINTS, et un mot cible jamais atteint n'entre ni dans le
    // WPM ni dans l'accuracy. Le plafond, lui, n'est pas cosmétique — le log vient du
    // client, et sans borne un log gonflé d'espaces ferait allouer un texte arbitraire.
    let target_text = rules(game_mode).recompute_target_text(&target_text, &keystrokes);

    // Une arrivée se PROUVE. Sous Normal, la course « ne se termine qu'une fois tout le
    // texte tapé exactement » (CONTEXT.md) : un `Finish` que le recompute ne voit pas aller
    // au bout n'est pas une arrivée, c'est un renoncement — enregistré comme un abandon,
    // ce qui débloque la fin pour les autres exactement pareil.
    //
    // Sans cette garde, trois caractères justes annoncés en 50 ms valaient 800 wpm et la
    // première place, sans avoir tapé la course (constaté en test à 8 joueurs). Le
    // recompute disait déjà la vérité sur CE QUI avait été tapé ; personne ne demandait si
    // ça allait jusqu'au bout.
    if rules(game_mode).requires_full_text
        && !crate::domain::replay::covers_whole_target(&target_text, &keystrokes)
    {
        return forfeit_race(rooms, key, player_id);
    }

    // Compté AVANT le recompute, qui prend possession des keystrokes. `(None, 0)` hors
    // Spam : c'est aussi à ça que le podium reconnaît le mode (ADR 0016 ; `score_extra`,
    // #128).
    let (reps, spam_partial) = rules(game_mode).score_extra(&target_text, &keystrokes);

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
        // Le dénominateur du WPM est l'instant où le serveur a arrêté ce joueur, jamais sa
        // dernière frappe déclarée (#164) : « la portion qu'il a eu le TEMPS de taper »
        // (ADR 0015) se mesure sur le temps qu'il a eu, pas sur celui qu'il annonce.
        duration_override_ms: stopped_at_ms,
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
            failed_percent: None,
            // Renseigné par `record_finish`, qui est le seul à savoir qui a brûlé.
            burned_at_ms: None,
            reps,
            spam_partial,
            per_second: sb.per_second.clone(),
        },
        retained_log,
    );
    if outcome == FinishOutcome::Rejected {
        return false;
    }

    // AUCUN Mode de jeu ne persiste (ADR 0015 puis 0016) : les deux imposent leur texte,
    // aucun des deux n'a de ligne d'arrivée, et la règle existante se lit « un Run est
    // sauvegardé pour qui est arrivé » — ici personne n'arrive. Le recompute a bien eu
    // lieu, mais il reste en mémoire, pour le podium et le duel. C'est le seul `if` que la
    // décision coûte : le log passant par `Finish`, ce chemin serait sinon emprunté par
    // tout le monde. `GameModeRules::persists_run` (#128) porte ce défaut, un quatrième
    // Mode de jeu en hérite sans qu'on ait à y penser.
    if !rules(game_mode).persists_run {
        return outcome == FinishOutcome::RaceOver;
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
pub(crate) fn all_racers_done(
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

/// Un Abandon ou un Échec Master (ADR 0013) : même rang de queue, jamais un finisseur —
/// ni l'un ni l'autre n'a de temps à classer.
pub(crate) fn is_tail(r: &RaceResult) -> bool {
    r.forfeit || r.failed_percent.is_some()
}

/// Clôt la course : diffuse le classement (par WPM décroissant), puis prépare la
/// revanche — nouveau seed + nouveau texte (l'ancien est mémorisé par les joueurs)
/// re-diffusés via RoomState. L'owner peut relancer StartRace depuis l'écran RaceOver.
pub(crate) fn end_race(room: &mut Room) {
    let RaceState::Racing { finishers, logs, .. } = &room.state else { return }; // rien à clore
    // L'ORDRE DU TABLEAU EST LE CLASSEMENT (ADR 0010) : abandons ET échecs Master repoussés
    // derrière tous les finisseurs (ADR 0013 : même rang de queue), puis WPM décroissant.
    // Classer au WPM et classer au temps donnent le même ordre en Race — même texte pour
    // tous, et on ne finit qu'à 100 % exact, donc les caractères corrects sont identiques
    // entre finisseurs. Le tri est STABLE : deux entrées de queue gardent leur ordre
    // d'arrivée relatif, jamais départagées par le pourcentage d'échec.
    // Le classement propre à chaque mode (WPM décroissant / ordre des décès inversé /
    // répétitions décroissantes) vit dans `GameModeRules::rank_cmp` (#128) — `is_tail`
    // reste appliqué ICI, une seule fois pour les trois, plutôt que recopié dans chacun.
    let mut results = finishers.clone();
    let mode = room.game_mode;
    results.sort_by(|a, b| is_tail(a).cmp(&is_tail(b)).then(rules(mode).rank_cmp(a, b)));
    // Play of the Game (ADR 0011) : le serveur choisit le duel et n'expédie QUE ses deux
    // logs, jamais les huit. `None` = pas de duel → le bouton est absent du podium. Quelle
    // grandeur mesure la proximité (`GameModeRules::duel`, #128) : en floor is lava et
    // Spam les décès/arrêts tombent sur un métronome ou un signal partagé, l'écart de
    // durée n'y dit rien — WPM sert de proximité dans les deux cas.
    let pick = rules(mode).duel(&results);
    let play_of_the_game = pick.map(|(i, j)| {
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
    // Nouvelle manche = nouvelle confirmation (issue #63) : les prêts de la manche
    // précédente ne valent pas pour celle-ci, même pour un présent qui n'a pas bougé.
    room.ready.clear();
    // Texte neuf IMMÉDIAT, et toujours jouable sans aller-retour réseau (l'owner peut
    // relancer dès l'écran RaceOver). Si la Source est Quote, `spawn_refresh_text`
    // remplace ce texte dès que la citation arrive — c'est l'appelant qui le déclenche,
    // une fois le verrou relâché. `GameModeRules::rematch_text` (#128) : sous floor is
    // lava la revanche repart sur 200 mots, pas sur la Source du lobby — sinon la manche
    // suivante retrouverait une ligne d'arrivée. Sous Spam elle repart sur le mot répété,
    // et sur un mot par défaut RETIRÉ (ADR 0016) : deux manches d'affilée ne doivent pas
    // tomber sur le même mot.
    rules(mode).rematch_text(room);
    let _ = room.tx.send(room_state(room));
}

/// Écart maximal (ms) entre deux finisseurs pour qu'ils forment un duel (ADR 0011).
/// Au-delà, il n'y a pas eu de duel : un « Play of the Game » à 8 s d'écart détruirait la
/// promesse de la fonctionnalité. Inclusif — exactement 2,0 s reste un duel.
pub(crate) const DUEL_MAX_GAP_MS: f64 = 2000.0;

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
pub(crate) fn duel(results: &[RaceResult]) -> Option<(usize, usize)> {
    let finishers: Vec<usize> = results
        .iter()
        .enumerate()
        .filter(|(_, r)| !is_tail(r))
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

/// Écart maximal de WPM entre deux joueurs pour qu'ils forment un duel en floor is lava
/// (ADR 0015). Même rôle que les 2 s d'ADR 0011 : on ne fabrique pas un duel qui n'a pas
/// eu lieu. Réglage produit, ajustable sans ADR.
pub(crate) const LAVA_DUEL_MAX_GAP_WPM: f64 = 2.0;

/// Le duel de floor is lava (ADR 0015) : la paire au plus petit écart de **WPM**.
///
/// Porter `duel()` tel quel ne marcherait pas. Les décès tombent toutes les X secondes
/// exactement : tous les écarts entre décès consécutifs valent X, il n'existe pas de paire
/// « la plus serrée ». Et le survivant sort à l'instant du dernier décès — écart nul,
/// systématiquement, le duel serait toujours le vainqueur contre sa dernière victime. Le
/// WPM est la seule grandeur du mode qui ait de la variance.
///
/// Même forme que `duel()`, autre clé : trier, prendre la paire consécutive la plus
/// serrée. `results` étant trié par ordre des décès et non par WPM, le tri est refait ici
/// sur des indices. Le vainqueur est éligible. Abandons et échecs Master sont exclus (pas
/// de log, pas de score). Égalité d'écart : la paire au plus haut WPM gagne.
pub(crate) fn duel_by_wpm(results: &[RaceResult]) -> Option<(usize, usize)> {
    let mut candidates: Vec<usize> = results
        .iter()
        .enumerate()
        .filter(|(_, r)| !is_tail(r))
        .map(|(i, _)| i)
        .collect();
    candidates.sort_by(|&i, &j| {
        results[j].wpm.partial_cmp(&results[i].wpm).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut best: Option<(usize, usize, f64)> = None;
    for pair in candidates.windows(2) {
        let (i, j) = (pair[0], pair[1]);
        let gap = (results[i].wpm - results[j].wpm).abs();
        // `<` strict : une égalité ne remplace pas → la première paire (le plus haut WPM).
        if best.is_none_or(|(_, _, g)| gap < g) {
            best = Some((i, j, gap));
        }
    }
    best.filter(|(_, _, gap)| *gap <= LAVA_DUEL_MAX_GAP_WPM).map(|(i, j, _)| (i, j))
}
