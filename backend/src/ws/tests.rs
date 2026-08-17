// =============================================================================
//  ws/tests.rs — les tests du fil, de la Room et du moteur de course (issue #205).
//
//  Sortis de `ws/mod.rs`, où ils occupaient 1 751 des 3 324 lignes du fichier. Ils
//  restent ENSEMBLE plutôt qu'éclatés par module : leurs helpers (`join`, `record`,
//  `lava_race`, `spam_race`…) traversent les trois sujets, et les dupliquer coûterait
//  plus cher que l'éclatement ne rapporte — c'est la même Room qu'on rejoint, qu'on
//  règle et dont on court la course.
// =============================================================================

use super::*;

/// Applique un Réglage de salon (#204) : `apply_setting` + son verdict en `bool`.
/// Échafaudage de test — le dispatch, lui, lit `SettingOutcome` en entier.
fn set(rooms: &Rooms, key: &str, player_id: &str, setting: RoomSetting) -> bool {
    apply_setting(rooms, key, player_id, setting).accepted()
}

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
        failed_percent: None,
        burned_at_ms: None,
        reps: None,
        spam_partial: 0,
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
    relay_progress(&rooms, "c1", "p1", 5, 0, now_epoch_ms());
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
        failed_percent: None,
        burned_at_ms: None,
        reps: None,
        spam_partial: 0,
        per_second: Vec::new(),
    }
}

/// Un Échec Master (issue #71, ADR 0013) : même forme qu'un abandon (0 WPM, durée
/// nulle) mais `forfeit: false`, distinction que l'ADR veut.
fn fail_res(id: &str, percent: i64) -> RaceResult {
    RaceResult::failed(id, percent)
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
fn duel_exclut_les_echecs_master() {
    // Un Échec (ADR 0013) a duration_ms=0 comme un abandon : sans l'exclusion, il
    // serait pris pour le meilleur "finisseur" et faussement apparié en duel.
    let results = vec![fin("a", 30_000.0), fail_res("b", 50), fin("c", 30_500.0)];
    assert_eq!(duel(&results), Some((0, 2))); // a et c, jamais b (l'échec)
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

// --- Floor is lava (ADR 0015) --------------------------------------------------

/// Room en floor is lava, course lancée, avec la progression déclarée de chacun.
/// Renvoie la clé et le t=0 réel, pour piloter le tic à l'horloge injectée.
fn lava_race(rooms: &Rooms, players: &[&str], interval_s: u32, progress: &[(&str, u32)]) -> i64 {
    for p in players {
        join(rooms, "c1", p);
    }
    assert!(set(rooms, "c1", players[0], RoomSetting::GameMode(GameMode::FloorIsLava)));
    assert!(set(rooms, "c1", players[0], RoomSetting::LavaInterval(interval_s)));
    // Décompte au tier MAXIMUM, jamais celui par défaut : `LAVA_INTERVAL_VALUES`
    // commence à 5 s, or le défaut vaut 5 s lui aussi (#185) — un test qui veut un
    // intervalle plus court que le décompte n'aurait donc plus aucune marge. Le
    // fixer ici rend toute la suite lava indépendante de ce défaut ; les autres
    // tests s'ancrent sur le `go` renvoyé, la longueur du décompte leur est neutre.
    assert!(set(rooms, "c1", players[0], RoomSetting::Countdown(10)));
    start_race(rooms, "c1", players[0]);
    for (p, chars) in progress {
        relay_progress(rooms, "c1", p, *chars, 0, now_epoch_ms());
    }
    match &rooms.lock().unwrap().get("c1").unwrap().state {
        RaceState::Racing { start_at_epoch_ms, .. } => *start_at_epoch_ms,
        RaceState::Lobby => panic!("pas en course"),
    }
}

/// Régression : le métronome d'élimination ne bat PAS pendant le décompte.
///
/// Avec l'ancien t=0 (l'instant du clic « Démarrer »), un intervalle de 5 s derrière le
/// décompte par défaut de 7 s éliminait AVANT que quiconque puisse taper : tous les
/// partants à 0 caractère, égalité, donc tout le monde brûlé d'un coup — plus de
/// survivant, plus de `Finish` attendu, Room figée jusqu'au watchdog de 10 minutes.
#[test]
fn aucune_elimination_avant_le_go_meme_si_lintervalle_est_plus_court_que_le_decompte() {
    let rooms = new_rooms();
    // L'intervalle doit être STRICTEMENT plus court que le décompte : c'est tout le
    // sujet du test. Il se compare donc au décompte réel plutôt qu'à une constante
    // recopiée — le défaut a déjà bougé une fois (7 → 5 s, #185) et la garde doit
    // crier plutôt que de laisser le test passer à vide.
    let interval = 5;
    let go = lava_race(&rooms, &["p1", "p2"], interval, &[("p1", 0), ("p2", 0)]);
    let countdown = rooms.lock().unwrap().get("c1").unwrap().countdown_s as i64;
    assert!(
        countdown > interval as i64,
        "le test ne prouve rien si le décompte n'est pas plus long que l'intervalle",
    );

    // Pendant le décompte, y compris passé un intervalle entier : personne ne brûle.
    game_mode_tick(&rooms, go - countdown * 1000 + (interval as i64) * 1000);
    assert!(burned_of(&rooms, "c1").is_empty(), "brûlé avant d'avoir pu taper");

    // Le premier tic tombe un intervalle APRÈS le GO, et n'emporte que le dernier.
    relay_progress(&rooms, "c1", "p1", 42, 0, now_epoch_ms());
    game_mode_tick(&rooms, go + (interval as i64) * 1000);
    assert_eq!(
        burned_of(&rooms, "c1").iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(),
        vec!["p2".to_string()],
    );
}

fn burned_of(rooms: &Rooms, key: &str) -> Vec<(PlayerId, f64)> {
    match &rooms.lock().unwrap().get(key).unwrap().state {
        RaceState::Racing { burned, .. } => burned.clone(),
        RaceState::Lobby => Vec::new(),
    }
}

#[test]
fn le_tic_brule_le_moins_avance_et_pas_avant_l_intervalle() {
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2", "p3"], 10, &[("p1", 100), ("p2", 20), ("p3", 60)]);

    // Avant le premier intervalle plein : personne. La première élimination tombe à
    // t = intervalle, pas plus tôt (ADR 0015 : le classement doit avoir le temps de
    // se former, la mesure est mauvaise dans les toutes premières secondes).
    game_mode_tick(&rooms, t0 + 9_999);
    assert!(burned_of(&rooms, "c1").is_empty());

    game_mode_tick(&rooms, t0 + 10_000);
    let burned = burned_of(&rooms, "c1");
    assert_eq!(burned.len(), 1);
    assert_eq!(burned[0].0, "p2"); // le moins avancé
    assert_eq!(burned[0].1, 10_000.0); // instant LOGIQUE, pas celui du scan
}

#[test]
fn l_instant_de_deces_est_logique_meme_si_le_scan_est_en_retard() {
    // La boucle watchdog peut prendre du retard : l'instant enregistré reste
    // `n × intervalle`, sinon le classement et l'affichage dériveraient.
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2"], 5, &[("p1", 100), ("p2", 10)]);
    game_mode_tick(&rooms, t0 + 5_900); // scan 900 ms en retard
    assert_eq!(burned_of(&rooms, "c1")[0].1, 5_000.0);
}

#[test]
fn les_tics_manques_sont_rattrapes() {
    // Une boucle en retard ne doit pas allonger la course : les tics sautés se
    // rattrapent d'un coup.
    let rooms = new_rooms();
    let t0 = lava_race(
        &rooms,
        &["p1", "p2", "p3", "p4"],
        5,
        &[("p1", 100), ("p2", 10), ("p3", 20), ("p4", 30)],
    );
    game_mode_tick(&rooms, t0 + 15_500); // 3 intervalles écoulés, aucun scan avant
    let burned = burned_of(&rooms, "c1");
    // Les trois tics dus sont joués d'affilée, du moins avancé au plus avancé, et
    // chacun garde SON instant logique — pas celui du scan qui les a rattrapés.
    assert_eq!(
        burned.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
        vec!["p2", "p3", "p4"]
    );
    assert_eq!(burned.iter().map(|(_, at)| *at).collect::<Vec<_>>(), vec![5_000.0, 10_000.0, 15_000.0]);
}

#[test]
fn egalite_au_tic_les_deux_brulent() {
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2", "p3"], 10, &[("p1", 100), ("p2", 20), ("p3", 20)]);
    game_mode_tick(&rooms, t0 + 10_000);
    let burned = burned_of(&rooms, "c1");
    assert_eq!(burned.len(), 2); // aucun départage honnête n'existe
    assert_eq!(burned[0].1, burned[1].1); // même instant
}

#[test]
fn les_deux_derniers_ex_aequo_brulent_ensemble_et_personne_ne_gagne() {
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2"], 10, &[("p1", 40), ("p2", 40)]);
    game_mode_tick(&rooms, t0 + 10_000);
    // « au plus un vivant », pas « exactement un » : zéro survivant est une fin légale.
    assert_eq!(burned_of(&rooms, "c1").len(), 2);
}

#[test]
fn un_seul_vivant_arrete_les_eliminations() {
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2"], 10, &[("p1", 100), ("p2", 20)]);
    game_mode_tick(&rooms, t0 + 10_000);
    game_mode_tick(&rooms, t0 + 60_000); // bien après cinq intervalles
    assert_eq!(burned_of(&rooms, "c1").len(), 1); // le survivant n'est jamais brûlé
}

#[test]
fn la_progression_retenue_ne_recule_jamais() {
    // Un `Progress` remis dans le désordre ferait reculer un joueur juste avant un tic
    // et le tuerait pour un artefact d'ordonnancement.
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2"], 10, &[("p1", 10), ("p2", 50)]);
    relay_progress(&rooms, "c1", "p2", 5, 0, now_epoch_ms()); // paquet en retard
    game_mode_tick(&rooms, t0 + 10_000);
    assert_eq!(burned_of(&rooms, "c1")[0].0, "p1");
}

#[test]
fn un_abandon_sort_des_vivants_sans_regle_supplementaire() {
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2", "p3"], 10, &[("p1", 100), ("p2", 10), ("p3", 60)]);
    forfeit_race(&rooms, "c1", "p2"); // le moins avancé s'en va de lui-même
    game_mode_tick(&rooms, t0 + 10_000);
    let burned = burned_of(&rooms, "c1");
    assert_eq!(burned.len(), 1);
    assert_eq!(burned[0].0, "p3"); // p2 n'est plus un vivant : il n'est pas re-tué
}

#[test]
fn floor_is_lava_refuse_de_partir_seul() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    assert!(set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::FloorIsLava)));
    start_race(&rooms, "c1", "p1");
    // Seul = déjà dernier vivant = course finie à t=0.
    assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
    join(&rooms, "c1", "p2");
    start_race(&rooms, "c1", "p1");
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn le_mode_impose_son_texte_et_rend_la_source_inerte() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::TextSource(TextSource::Words { count: 15 }));
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::FloorIsLava));
    assert_eq!(
        pending_source(&rooms, "c1"),
        Some(TextSource::Words { count: LAVA_WORD_COUNT })
    );
    // La Source du lobby est gardée, pas écrasée : elle reprend effet au retour.
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::Normal));
    assert_eq!(pending_source(&rooms, "c1"), Some(TextSource::Words { count: 15 }));
}

#[tokio::test]
async fn passer_en_floor_is_lava_n_ecrase_pas_la_source_choisie() {
    // Exerce le chemin RÉEL de #145 — l'écriture async de `spawn_refresh_text`, que
    // `handle_socket` déclenche systématiquement après un `SetGameMode` accepté — pas
    // seulement `pending_source` synchrone (déjà vérifié ci-dessus), qui avait laissé
    // passer la régression.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::TextSource(TextSource::Words { count: 15 }));
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::FloorIsLava));

    let quotes = Arc::new(QuoteClient::from_env());
    spawn_refresh_text(rooms.clone(), "c1".to_string(), quotes);
    // Aucune E/S sur ce chemin (Floor is lava ne demande jamais de Quote) : la tâche
    // se termine dès qu'elle est repolled une fois.
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;

    assert_eq!(source_of(&rooms, "c1"), TextSource::Words { count: 15 });
}

/// Un Brûlé : ce que `record_finish` produit une fois le log recompté.
fn burnt(id: &str, wpm: f64, at_ms: f64) -> RaceResult {
    RaceResult { burned_at_ms: Some(at_ms), ..done(id, wpm) }
}

#[test]
fn le_classement_suit_l_ordre_des_deces_inverse_pas_le_wpm() {
    // Le scénario de l'ADR : Alice brûle tôt en tapant vite, Bob brûle tard en tapant
    // lentement. Classer au WPM remettrait Alice devant Bob — donc annulerait
    // l'élimination qu'on vient de jouer.
    let rooms = new_rooms();
    join(&rooms, "c1", "alice");
    join(&rooms, "c1", "bob");
    join(&rooms, "c1", "carol");
    set(&rooms, "c1", "alice", RoomSetting::GameMode(GameMode::FloorIsLava));
    start_race(&rooms, "c1", "alice");
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

    record(&rooms, "c1", burnt("alice", 40.0, 10_000.0));
    record(&rooms, "c1", burnt("bob", 30.0, 20_000.0));
    record(&rooms, "c1", done("carol", 35.0)); // survivante : jamais brûlée

    assert_eq!(ranking_of(&mut rx), Some(s(&["carol", "bob", "alice"])));
}

#[test]
fn un_abandon_reste_derriere_les_brules() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    join(&rooms, "c1", "p2");
    join(&rooms, "c1", "p3");
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::FloorIsLava));
    start_race(&rooms, "c1", "p1");
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

    record(&rooms, "c1", RaceResult::forfeited("p3"));
    record(&rooms, "c1", burnt("p2", 30.0, 10_000.0));
    record(&rooms, "c1", done("p1", 50.0));

    assert_eq!(ranking_of(&mut rx), Some(s(&["p1", "p2", "p3"])));
}

#[test]
fn record_finish_estampille_le_brule_depuis_l_etat_serveur() {
    // Le client ne DIT jamais qu'il a brûlé : le serveur sait qui il a condamné, et il
    // le pose lui-même sur le résultat qui revient par `Finish`.
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2"], 10, &[("p1", 100), ("p2", 10)]);
    game_mode_tick(&rooms, t0 + 10_000);
    record(&rooms, "c1", done("p2", 25.0)); // le client renvoie juste son log
    let burned_at = match &rooms.lock().unwrap().get("c1").unwrap().state {
        RaceState::Racing { finishers, .. } => finishers[0].burned_at_ms,
        RaceState::Lobby => panic!("course close trop tôt"),
    };
    assert_eq!(burned_at, Some(10_000.0));
}

#[test]
fn un_abandon_qui_perd_la_course_du_lock_contre_le_tic_reste_un_abandon() {
    // p2 est brûlé par le tic, mais son Abandon (envoyé avant qu'il n'apprenne sa
    // mort, ou en vol au même instant) arrive après : record_finish ne doit PAS
    // repeindre cet Abandon en Brûlé.
    let rooms = new_rooms();
    let t0 = lava_race(&rooms, &["p1", "p2"], 10, &[("p1", 100), ("p2", 10)]);
    game_mode_tick(&rooms, t0 + 10_000);
    assert_eq!(burned_of(&rooms, "c1"), vec![("p2".to_string(), 10_000.0)]);

    record(&rooms, "c1", RaceResult::forfeited("p2"));
    let finishers = match &rooms.lock().unwrap().get("c1").unwrap().state {
        RaceState::Racing { finishers, .. } => finishers.clone(),
        RaceState::Lobby => panic!("course close trop tôt"),
    };
    assert_eq!(finishers[0].burned_at_ms, None);
    assert!(finishers[0].forfeit);
}

// --- Spam (ADR 0016) -----------------------------------------------------------

/// Room en Spam, course lancée. Renvoie le t=0 réel, pour piloter le plafond de temps
/// à l'horloge injectée — même patron que `lava_race`.
fn spam_race(rooms: &Rooms, players: &[&str], threshold: u32, cap_s: u32) -> i64 {
    for p in players {
        join(rooms, "c1", p);
    }
    assert!(set(rooms, "c1", players[0], RoomSetting::GameMode(GameMode::Spam)));
    assert!(set(rooms, "c1", players[0], RoomSetting::SpamThreshold(threshold)));
    assert!(set(rooms, "c1", players[0], RoomSetting::SpamTimeCap(cap_s)));
    start_race(rooms, "c1", players[0]);
    match &rooms.lock().unwrap().get("c1").unwrap().state {
        RaceState::Racing { start_at_epoch_ms, .. } => *start_at_epoch_ms,
        RaceState::Lobby => panic!("pas en course"),
    }
}

/// La course a-t-elle été arrêtée (`spam_stopped_at_ms` posé) ?
fn stopped(rooms: &Rooms, key: &str) -> bool {
    match &rooms.lock().unwrap().get(key).unwrap().state {
        RaceState::Racing { spam_stopped_at_ms, .. } => spam_stopped_at_ms.is_some(),
        RaceState::Lobby => panic!("pas en course"),
    }
}

fn stops_seen(rx: &mut broadcast::Receiver<ServerEvent>) -> usize {
    let mut n = 0;
    while let Ok(ev) = rx.try_recv() {
        if matches!(ev, ServerEvent::SpamStop) {
            n += 1;
        }
    }
    n
}

/// Un résultat de Spam : ce que `record_finish` produit une fois le log recompté.
fn spammed(id: &str, wpm: f64, reps: u32, partial: u32) -> RaceResult {
    RaceResult { reps: Some(reps), spam_partial: partial, ..done(id, wpm) }
}

#[test]
fn le_texte_est_le_mot_repete_et_la_source_devient_inerte() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    assert!(set(&rooms, "c1", "p1", RoomSetting::TextSource(TextSource::Quote)));
    assert!(set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::Spam)));
    assert!(set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some("wow".to_string()))));

    let text = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    let words: Vec<&str> = text.split(' ').collect();
    assert_eq!(words.len(), SPAM_LEAD_WORDS);
    assert!(words.iter().all(|w| *w == "wow"));
    // La Source du lobby est GARDÉE (elle reprend effet en revenant à Normal) mais
    // n'est plus effective : aucune citation n'est demandée sous ce mode.
    assert_eq!(source_of(&rooms, "c1"), TextSource::Quote);
    assert!(pending_source(&rooms, "c1").is_none());
}

#[test]
fn le_mot_par_defaut_vient_de_la_liste_de_la_source_mots() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    assert!(set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::Spam)));
    let text = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    let word = spam_word_of(&text);
    assert!(!word.is_empty());
    assert!(word.chars().all(|c| c.is_ascii_alphabetic()));
    assert!(text.split(' ').all(|w| w == word));
}

#[test]
fn un_mot_personnalise_invalide_est_refuse() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::Spam));
    // Un espace ferait silencieusement DEUX mots cibles et casserait le comptage.
    assert!(!set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some("deux mots".to_string()))));
    assert!(!set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some(String::new()))));
    assert!(!set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some("a".repeat(21)))));
    assert!(!set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some("saut\nligne".to_string()))));
    // Chiffres et ponctuation À L'INTÉRIEUR du mot : acceptés, seule la forme compte.
    assert!(set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some("l33t!".to_string()))));
    assert!(set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some("a".repeat(20)))));
}

#[test]
fn atteindre_le_seuil_arrete_la_course_tout_de_suite() {
    let rooms = new_rooms();
    let t0 = spam_race(&rooms, &["p1", "p2"], 10, 60);
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

    relay_progress(&rooms, "c1", "p1", 27, 9, t0 + 7_000); // encore une
    assert!(!stopped(&rooms, "c1"));
    relay_progress(&rooms, "c1", "p1", 30, 10, t0 + 8_000); // seuil atteint
    assert!(stopped(&rooms, "c1"));
    assert_eq!(stops_seen(&mut rx), 1);
    // L'arrêt par le SEUIL est daté comme celui par le plafond : c'est cet instant qui
    // borne ensuite le log de chacun (#164), et c'est le chemin principal des deux.
    assert_eq!(stop_ms(&rooms, "c1", "p1"), Some(8_000.0));
    assert_eq!(stop_ms(&rooms, "c1", "p2"), Some(8_000.0));
}

#[test]
fn un_spectateur_ne_peut_pas_couper_la_course_des_autres() {
    // Un rejoignant en cours de course entre dans `players` mais jamais dans `racers`.
    // Sans le filtre, un seul `Progress` gonflé suffirait à clore la manche des autres.
    let rooms = new_rooms();
    let t0 = spam_race(&rooms, &["p1"], 10, 60);
    join(&rooms, "c1", "intrus");
    relay_progress(&rooms, "c1", "intrus", 9_999, 9_999, t0 + 5_000);
    assert!(!stopped(&rooms, "c1"));
    // Le vrai partant, lui, arrête bien la course.
    relay_progress(&rooms, "c1", "p1", 30, 10, t0 + 6_000);
    assert!(stopped(&rooms, "c1"));
}

#[test]
fn l_arret_n_est_diffuse_qu_une_fois() {
    // Un partant figé laisserait la Room en course : sans le drapeau, chaque seconde
    // de watchdog re-diffuserait l'arrêt jusqu'aux 10 minutes du close_overlong.
    let rooms = new_rooms();
    let t0 = spam_race(&rooms, &["p1", "p2"], 10, 15);
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();
    game_mode_tick(&rooms, t0 + 15_000);
    game_mode_tick(&rooms, t0 + 16_000);
    game_mode_tick(&rooms, t0 + 17_000);
    relay_progress(&rooms, "c1", "p1", 90, 30, t0 + 17_000); // et le seuil par-dessus
    assert_eq!(stops_seen(&mut rx), 1);
}

#[test]
fn le_plafond_de_temps_court_depuis_go_pas_depuis_start_race() {
    // Le joueur voit un compteur qui part de la 1re frappe : un plafond de 30 s doit
    // laisser 30 s de frappe, décompte non compris. Ce n'est plus compensé ici — c'est
    // `start_at_epoch_ms` lui-même qui vaut le GO — d'où le test sur les DEUX bornes.
    let rooms = new_rooms();
    let go = spam_race(&rooms, &["p1", "p2"], 50, 30);
    let countdown = rooms.lock().unwrap().get("c1").unwrap().countdown_s as i64;
    assert!(countdown > 0, "sinon le test ne prouve rien");

    // Pendant le décompte (avant le GO) : rien ne peut expirer.
    game_mode_tick(&rooms, go - countdown * 1000);
    assert!(!stopped(&rooms, "c1"));
    game_mode_tick(&rooms, go + 29_000);
    assert!(!stopped(&rooms, "c1"));
    game_mode_tick(&rooms, go + 30_000);
    assert!(stopped(&rooms, "c1"));
}

#[test]
fn le_mot_ne_se_regle_pas_hors_spam_il_ecraserait_le_texte_du_lobby() {
    // Le seuil et le plafond se préparent d'avance sans rien casser ; le mot, lui,
    // REGÉNÈRE le texte — l'accepter sous Normal remplacerait la citation du lobby.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    let before = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    assert!(!set(&rooms, "c1", "p1", RoomSetting::SpamWord(Some("wow".to_string()))));
    assert_eq!(rooms.lock().unwrap().get("c1").unwrap().target_text, before);
    // Les deux autres restent préparables d'avance, eux.
    assert!(set(&rooms, "c1", "p1", RoomSetting::SpamThreshold(30)));
    assert!(set(&rooms, "c1", "p1", RoomSetting::SpamTimeCap(45)));
}

#[test]
fn le_plafond_ne_touche_pas_les_autres_modes() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    start_race(&rooms, "c1", "p1"); // Race normale
    game_mode_tick(&rooms, now_epoch_ms() + 600_000);
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn spam_part_a_un_seul_joueur() {
    // Contrairement à floor is lava (ADR 0015) : courir seul contre un seuil ou une
    // horloge reste un jeu cohérent, il n'y a pas d'élimination à vider de son sens.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::Spam));
    start_race(&rooms, "c1", "p1");
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn le_classement_suit_les_repetitions_pas_le_wpm() {
    // Le WPM et les répétitions divergent dès qu'on tape vite ET faux : c'est le
    // compte de répétitions correctes qui décide, jamais la vitesse brute.
    let rooms = new_rooms();
    spam_race(&rooms, &["a", "b", "c"], 20, 30);
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

    record(&rooms, "c1", spammed("a", 90.0, 11, 0)); // rapide, mais 11 répétitions
    record(&rooms, "c1", spammed("b", 40.0, 20, 0)); // lent, mais le seuil atteint
    record(&rooms, "c1", spammed("c", 70.0, 11, 3)); // ex æquo avec a, mais en cours

    assert_eq!(ranking_of(&mut rx), Some(s(&["b", "c", "a"])));
}

#[test]
fn un_abandon_reste_derriere_les_devances() {
    let rooms = new_rooms();
    spam_race(&rooms, &["p1", "p2", "p3"], 20, 30);
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

    record(&rooms, "c1", RaceResult::forfeited("p3"));
    record(&rooms, "c1", spammed("p2", 30.0, 4, 0));
    record(&rooms, "c1", spammed("p1", 20.0, 12, 0));

    assert_eq!(ranking_of(&mut rx), Some(s(&["p1", "p2", "p3"])));
}

#[test]
fn la_revanche_repart_sur_un_mot_repete() {
    let rooms = new_rooms();
    spam_race(&rooms, &["p1"], 10, 15);
    record(&rooms, "c1", spammed("p1", 40.0, 10, 0)); // dernier partant : clôt
    let text = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    assert_eq!(text.split(' ').count(), SPAM_LEAD_WORDS);
    assert_eq!(text.split(' ').collect::<HashSet<_>>().len(), 1);
}

#[test]
fn le_texte_du_recompute_couvre_le_log_sans_le_deviner_d_avance() {
    // Le texte de la Room ne fait que SPAM_LEAD_WORDS mots : un joueur plus rapide que
    // ça ne doit pas voir ses répétitions au-delà comptées comme fausses.
    let word = "go";
    let locks = SPAM_LEAD_WORDS + 40;
    let text = spam_text(word, (locks + 1).min(SPAM_MAX_WORDS));
    assert_eq!(text.split(' ').count(), locks + 1);
    assert_eq!(spam_word_of(&text), word);
}

#[test]
fn duel_wpm_choisit_la_paire_la_plus_serree_vainqueur_inclus() {
    let results = vec![done("gagnant", 60.0), burnt("a", 59.5, 20_000.0), burnt("b", 40.0, 10_000.0)];
    // 60 vs 59,5 est plus serré que 59,5 vs 40 — et le vainqueur est éligible.
    assert_eq!(duel_by_wpm(&results), Some((0, 1)));
}

#[test]
fn duel_wpm_aucun_au_dela_du_seuil() {
    let results = vec![done("a", 60.0), burnt("b", 50.0, 10_000.0)];
    assert_eq!(duel_by_wpm(&results), None);
    // Seuil inclusif, comme les 2 s d'ADR 0011.
    let serres = vec![done("a", 60.0), burnt("b", 58.0, 10_000.0)];
    assert_eq!(duel_by_wpm(&serres), Some((0, 1)));
}

#[test]
fn duel_wpm_ignore_abandons_et_echecs_et_exige_deux_candidats() {
    let results = vec![done("a", 60.0), RaceResult::forfeited("b"), fail_res("c", 42)];
    assert_eq!(duel_by_wpm(&results), None); // un seul candidat réel
}

#[test]
fn duel_wpm_ne_depend_pas_de_l_ordre_du_classement() {
    // `results` est trié par ordre des décès, pas par WPM : la paire la plus serrée
    // peut n'être PAS consécutive au classement.
    let results = vec![
        done("survivant", 45.0),
        burnt("mort_tard", 70.0, 30_000.0),
        burnt("mort_tot", 44.5, 10_000.0),
    ];
    assert_eq!(duel_by_wpm(&results), Some((0, 2)));
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

// --- Réglage de salon (issue #129, ADR 0017) ------------------------------------
//
// La garde « owner + hors course » vivait dans neuf fonctions `set_*` ; elle vit
// maintenant une seule fois dans `room_setting::apply_setting`. Les deux tests
// ci-dessous la vérifient UNE fois, sur chaque variante de `RoomSetting`, plutôt que
// sept fois sur chaque fonction (les domaines de validité, eux, se testent sans Room
// dans `room_setting::tests::domaine_de_validite_de_chaque_reglage`).

/// Un exemple de chaque Réglage de salon, avec une valeur ACCEPTÉE une fois la garde
/// owner/hors-course passée — assez pour couvrir chaque variante par construction
/// plutôt que par répétition (`SetReady` en est absent : ADR 0017, ce n'en est pas
/// un). Room supposée déjà en Spam pour que `SpamWord` ne se heurte pas à sa 3e garde
/// (`accepts_spam_settings`), qui n'est pas ce que ces deux tests mesurent.
fn un_reglage_de_chaque_sorte() -> Vec<RoomSetting> {
    vec![
        RoomSetting::TextSource(TextSource::Words { count: 15 }),
        RoomSetting::MaxPlayers(4),
        RoomSetting::Countdown(3),
        RoomSetting::ReadyCheck(true),
        RoomSetting::Difficulty(Difficulty::Master),
        RoomSetting::GameMode(GameMode::FloorIsLava),
        RoomSetting::SpamWord(Some("wow".to_string())),
        RoomSetting::SpamThreshold(30),
        RoomSetting::SpamTimeCap(45),
        RoomSetting::LavaInterval(5),
    ]
}

#[test]
fn seul_l_owner_regle_un_reglage_de_salon() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1"); // owner
    join(&rooms, "c1", "p2");
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::Spam)); // pour que SpamWord soit recevable

    for setting in un_reglage_de_chaque_sorte() {
        assert_eq!(apply_setting(&rooms, "c1", "p2", setting), SettingOutcome::Rejected);
    }
}

#[test]
fn aucun_reglage_de_salon_ne_change_pendant_une_course() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::GameMode(GameMode::Spam));
    start_race(&rooms, "c1", "p1");

    for setting in un_reglage_de_chaque_sorte() {
        assert_eq!(apply_setting(&rooms, "c1", "p1", setting), SettingOutcome::Rejected);
    }
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
fn une_longueur_arbitraire_est_refusee() {
    // Frontière de confiance : le count vient du client et s'impose aux 7 autres.
    // Une course de 100 000 mots ne doit pas être demandable.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    for count in [1, 31, 100_000] {
        assert!(!set(&rooms, "c1", "p1", RoomSetting::TextSource(TextSource::Words { count })));
    }
    for count in WORDS_LENGTHS {
        assert!(set(&rooms, "c1", "p1", RoomSetting::TextSource(TextSource::Words { count })));
    }
}

#[test]
fn la_revanche_respecte_la_longueur_choisie() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::TextSource(TextSource::Words { count: 15 }));

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

// --- Taille max de la Room (issue #62) ----------------------------------------

fn max_of(rooms: &Rooms, key: &str) -> usize {
    rooms.lock().unwrap().get(key).unwrap().max_players
}

#[test]
fn une_taille_hors_plage_est_refusee() {
    // Frontière de confiance : 0 fermerait la Room, 999 casserait la piste des autres.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    for max in [0, 1, 9, 999] {
        assert!(!set(&rooms, "c1", "p1", RoomSetting::MaxPlayers(max)));
    }
    for max in MIN_PLAYERS..=MAX_PLAYERS {
        assert!(set(&rooms, "c1", "p1", RoomSetting::MaxPlayers(max)));
    }
}

#[test]
fn la_taille_reglee_remplace_le_plafond_dur() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::MaxPlayers(2));
    join(&rooms, "c1", "p2"); // 2e place : encore libre

    assert_eq!(join_channel(&rooms, "c1", "p3", ident("p3")).err(), Some(JoinError::Full));
    assert_eq!(players_of(&rooms, "c1").len(), 2);
}

#[test]
fn baisser_la_taille_sous_le_nombre_de_presents_n_expulse_personne() {
    // On ne sort pas quelqu'un du lobby par un réglage : la place se libère quand il
    // part de lui-même. Seules les ARRIVÉES sont refusées.
    let rooms = new_rooms();
    for i in 0..4 {
        join(&rooms, "c1", &format!("p{i}"));
    }
    assert!(set(&rooms, "c1", "p0", RoomSetting::MaxPlayers(2)));
    assert_eq!(players_of(&rooms, "c1").len(), 4); // les 4 présents restent

    assert_eq!(join_channel(&rooms, "c1", "p9", ident("p9")).err(), Some(JoinError::Full));
    join(&rooms, "c1", "p0"); // reconnexion d'un présent : toujours acceptée
    assert_eq!(players_of(&rooms, "c1").len(), 4);
}

// --- Décompte de la Room (issue #61) ------------------------------------------

fn countdown_of(rooms: &Rooms, key: &str) -> u32 {
    rooms.lock().unwrap().get(key).unwrap().countdown_s
}

#[test]
fn une_duree_hors_plage_est_refusee() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    for seconds in [0, 1, 4, 6, 8, 11, 999] {
        assert!(!set(&rooms, "c1", "p1", RoomSetting::Countdown(seconds)));
    }
    for seconds in COUNTDOWN_VALUES {
        assert!(set(&rooms, "c1", "p1", RoomSetting::Countdown(seconds)));
    }
}

// --- Ready-check (issue #63) --------------------------------------------------

fn ready_check_of(rooms: &Rooms, key: &str) -> bool {
    rooms.lock().unwrap().get(key).unwrap().ready_check
}

#[test]
fn ready_check_off_le_depart_reste_immediat() {
    // Comportement par défaut inchangé : personne n'a rien marqué "prêt", ça démarre
    // quand même — c'est tout le point de la garde `all_present_ready`.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    join(&rooms, "c1", "p2");
    start_race(&rooms, "c1", "p1");
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn start_race_attend_que_tous_soient_prets() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1"); // owner
    join(&rooms, "c1", "p2");
    set(&rooms, "c1", "p1", RoomSetting::ReadyCheck(true));

    start_race(&rooms, "c1", "p1"); // personne n'est prêt : ignoré
    assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

    assert!(set_ready(&rooms, "c1", "p1", true));
    start_race(&rooms, "c1", "p1"); // p2 pas encore prêt : toujours ignoré
    assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

    assert!(set_ready(&rooms, "c1", "p2", true));
    start_race(&rooms, "c1", "p1"); // tous prêts : accepté
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn set_ready_refuse_un_absent_et_pendant_une_course() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    assert!(!set_ready(&rooms, "c1", "spectateur", true)); // jamais rejoint

    start_race(&rooms, "c1", "p1");
    assert!(!set_ready(&rooms, "c1", "p1", true)); // course en cours
}

#[test]
fn la_bascule_du_ready_check_vide_les_prets() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::ReadyCheck(true));
    set_ready(&rooms, "c1", "p1", true);

    set(&rooms, "c1", "p1", RoomSetting::ReadyCheck(false));
    set(&rooms, "c1", "p1", RoomSetting::ReadyCheck(true)); // réactivé : repart de zéro
    start_race(&rooms, "c1", "p1"); // p1 n'est plus marqué prêt : ignoré
    assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn une_nouvelle_manche_redemande_la_confirmation() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    set(&rooms, "c1", "p1", RoomSetting::ReadyCheck(true));
    set_ready(&rooms, "c1", "p1", true);
    start_race(&rooms, "c1", "p1");
    assert_eq!(record(&rooms, "c1", done("p1", 60.0)), FinishOutcome::RaceOver);

    // Retour au Lobby : p1 doit se remarquer prêt pour relancer.
    start_race(&rooms, "c1", "p1");
    assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());

    assert!(set_ready(&rooms, "c1", "p1", true));
    start_race(&rooms, "c1", "p1");
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

// --- Difficulté & Failed (issue #71, ADR 0013) ---------------------------------

fn difficulty_of(rooms: &Rooms, key: &str) -> Difficulty {
    rooms.lock().unwrap().get(key).unwrap().difficulty
}

/// Une frappe garantie FAUSSE contre `word` (jamais égale à son 1er caractère).
fn wrong_keystroke(word: &str) -> Keystroke {
    let first = word.chars().next().unwrap_or('a');
    let bad = if first == 'x' { 'y' } else { 'x' };
    Keystroke { t: 100.0, k: bad.to_string(), ctrl: None }
}

#[test]
fn expert_est_refuse_comme_reglage_de_salon() {
    // Expert n'est pas un Réglage de salon (ADR 0013) : sa condition de déclenchement
    // (mot soumis faux) est inatteignable dès que la course force la correction.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    assert!(!set(&rooms, "c1", "p1", RoomSetting::Difficulty(Difficulty::Expert)));
    assert_eq!(difficulty_of(&rooms, "c1"), Difficulty::Normal);
}

#[test]
fn fail_rejette_si_la_room_n_est_pas_sous_master() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1"); // Difficulté par défaut : Normal
    start_race(&rooms, "c1", "p1");
    let target = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    let bad = wrong_keystroke(target.split(' ').next().unwrap_or(""));
    assert!(!fail_race(&rooms, "c1", "p1", vec![bad]));
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn fail_rejette_une_fausse_declaration() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    assert!(set(&rooms, "c1", "p1", RoomSetting::Difficulty(Difficulty::Master)));
    start_race(&rooms, "c1", "p1");
    let target = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    let first_word = target.split(' ').next().unwrap_or("");
    // Le client PRÉTEND avoir échoué, mais son log tape le mot EXACTEMENT : le
    // serveur rejoue contre son propre texte et NE confirme PAS d'échec.
    let correct: Vec<Keystroke> =
        first_word.chars().map(|c| Keystroke { t: 100.0, k: c.to_string(), ctrl: None }).collect();
    assert!(!fail_race(&rooms, "c1", "p1", correct));
    assert!(rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn master_confirme_l_echec_a_la_1ere_frappe_fausse() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    assert!(set(&rooms, "c1", "p1", RoomSetting::Difficulty(Difficulty::Master)));
    start_race(&rooms, "c1", "p1");
    let target = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    let bad = wrong_keystroke(target.split(' ').next().unwrap_or(""));
    assert!(fail_race(&rooms, "c1", "p1", vec![bad])); // dernier partant : clôture
    assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing());
}

#[test]
fn un_echec_passe_derriere_tous_les_finisseurs() {
    // Sibling de abandon_partiel_classement_a_zero_pour_les_partants_jamais_finis :
    // un Échec Master suit exactement la même règle de classement qu'un Abandon.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    join(&rooms, "c1", "p2");
    assert!(set(&rooms, "c1", "p1", RoomSetting::Difficulty(Difficulty::Master)));
    start_race(&rooms, "c1", "p1");
    let target = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

    assert_eq!(record(&rooms, "c1", done("p1", 60.0)), FinishOutcome::Recorded);
    let bad = wrong_keystroke(target.split(' ').next().unwrap_or(""));
    assert!(fail_race(&rooms, "c1", "p2", vec![bad])); // dernier partant : clôture

    assert_eq!(ranking_of(&mut rx), Some(s(&["p1", "p2"]))); // p1 fini devant p2 en échec
}

#[test]
fn le_pourcentage_d_echec_n_affecte_pas_l_ordre_relatif() {
    // p1 échoue à la 1re frappe (pourcentage bas), p2 après un mot entier tapé juste
    // (pourcentage plus haut) : l'ordre doit rester p1 PUIS p2 (ordre d'arrivée),
    // jamais réordonné par un pourcentage pourtant plus favorable à p2.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    join(&rooms, "c1", "p2");
    assert!(set(&rooms, "c1", "p1", RoomSetting::Difficulty(Difficulty::Master)));
    start_race(&rooms, "c1", "p1");
    let target = rooms.lock().unwrap().get("c1").unwrap().target_text.clone();
    let words: Vec<&str> = target.split(' ').collect();
    let mut rx = rooms.lock().unwrap().get("c1").unwrap().tx.subscribe();

    assert!(!fail_race(&rooms, "c1", "p1", vec![wrong_keystroke(words[0])])); // p2 pas encore fini

    let mut late: Vec<Keystroke> =
        words[0].chars().map(|c| Keystroke { t: 100.0, k: c.to_string(), ctrl: None }).collect();
    late.push(Keystroke { t: 200.0, k: " ".to_string(), ctrl: None });
    late.push(wrong_keystroke(words.get(1).copied().unwrap_or("zz")));
    assert!(fail_race(&rooms, "c1", "p2", late)); // dernier partant : clôture

    assert_eq!(ranking_of(&mut rx), Some(s(&["p1", "p2"]))); // ordre d'arrivée, pas de pourcentage
}

#[test]
fn watchdog_ignore_les_rooms_en_lobby() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    close_overlong_races(&rooms, now_epoch_ms() + 100 * RACE_MAX_DURATION_MS);
    assert!(!rooms.lock().unwrap().get("c1").unwrap().state.is_racing()); // toujours Lobby, intact
}

// --- Qui a le droit d'envoyer un Finish (issue #163) ----------------------------
//
// La garde est interrogée sur le PRÉDICAT, pas à travers `finish_race` : celui-ci
// exige un `SqlitePool`, qu'aucun test de ce module n'a. Même niveau que la garde
// jumelle de #160, prouvée sur `covers_whole_target` (domain/replay.rs).

/// `finish_allowed` du mode de la Room, pour ce joueur.
fn finish_ok(rooms: &Rooms, key: &str, player_id: &str) -> bool {
    let rooms = rooms.lock().unwrap();
    let room = rooms.get(key).unwrap();
    rules(room.game_mode).finish_allowed(room, player_id)
}

#[test]
fn sous_lava_seuls_un_brule_et_le_dernier_vivant_peuvent_finir() {
    let rooms = new_rooms();
    let go = lava_race(&rooms, &["p1", "p2", "p3"], 5, &[("p1", 50), ("p2", 10), ("p3", 30)]);

    // Avant le premier tic : personne n'est brûlé, personne n'est seul.
    for p in ["p1", "p2", "p3"] {
        assert!(!finish_ok(&rooms, "c1", p), "{p} n'a rien à livrer avant la 1re élimination");
    }

    game_mode_tick(&rooms, go + 5_000); // p2 (le moins avancé) brûle
    assert!(finish_ok(&rooms, "c1", "p2"), "brûlé : son log est réclamé");
    assert!(!finish_ok(&rooms, "c1", "p1"), "encore vivant, et pas seul");
    assert!(!finish_ok(&rooms, "c1", "p3"), "encore vivant, et pas seul");

    game_mode_tick(&rooms, go + 10_000); // p3 brûle : p1 reste seul
    assert!(finish_ok(&rooms, "c1", "p1"), "dernier vivant : il déduit sa victoire");
}

#[test]
fn sous_spam_aucun_finish_avant_larret() {
    let rooms = new_rooms();
    let go = spam_race(&rooms, &["p1", "p2"], 50, 30);
    assert!(!finish_ok(&rooms, "c1", "p1"), "course en cours : rien n'est réclamé");

    game_mode_tick(&rooms, go + 30_001); // plafond de temps atteint
    assert!(stopped(&rooms, "c1"));
    assert!(finish_ok(&rooms, "c1", "p1"), "arrêtée : tout le monde livre son log");
    assert!(finish_ok(&rooms, "c1", "p2"));
}

// --- Jusqu'où un log a le droit d'aller (issue #164, ADR 0018) ----------------------------
//
// Même dispositif que #163 juste au-dessus : la borne s'interroge sur le PRÉDICAT,
// `finish_race` exigeant un `SqlitePool`. Ce qu'elle en fait ensuite est de la
// plomberie (`retain` sur le log, `duration_override_ms` au recompute, prouvé côté
// `domain/replay.rs`) ; ce qui se trompe, c'est l'instant.

/// L'instant d'arrêt serveur du mode de la Room, pour ce joueur, à l'horloge `now`.
fn stop_ms_at(rooms: &Rooms, key: &str, player_id: &str, now: i64) -> Option<f64> {
    let rooms = rooms.lock().unwrap();
    let room = rooms.get(key).unwrap();
    rules(room.game_mode).stopped_at_ms(room, player_id, now)
}

/// Idem, à l'horloge réelle — pour les modes dont la réponse n'en dépend pas.
fn stop_ms(rooms: &Rooms, key: &str, player_id: &str) -> Option<f64> {
    stop_ms_at(rooms, key, player_id, now_epoch_ms())
}

#[test]
fn sous_lava_un_brule_est_borne_a_sa_flamme_et_le_survivant_a_maintenant() {
    let rooms = new_rooms();
    let go = lava_race(&rooms, &["p1", "p2", "p3"], 5, &[("p1", 50), ("p2", 10), ("p3", 30)]);

    game_mode_tick(&rooms, go + 5_000); // p2 brûle
    assert_eq!(stop_ms_at(&rooms, "c1", "p2", go + 9_000), Some(5_000.0), "sa flamme");

    game_mode_tick(&rooms, go + 10_000); // p3 brûle, p1 reste seul
    assert_eq!(stop_ms_at(&rooms, "c1", "p3", go + 12_000), Some(10_000.0));
    assert_eq!(
        stop_ms_at(&rooms, "c1", "p2", go + 12_000),
        Some(5_000.0),
        "un brûlé garde SA flamme, jamais la dernière de la liste"
    );
    assert_eq!(
        stop_ms_at(&rooms, "c1", "p1", go + 10_200),
        Some(10_200.0),
        "le survivant est borné à maintenant, pas à ce qu'il déclare"
    );
}

#[test]
fn sous_lava_le_survivant_reste_borne_meme_sans_aucune_flamme() {
    // La régression qui rouvrait #164 EN ENTIER : `alive_racers` sort aussi les
    // abandons, les échecs Master et les déconnexions, qui ne passent JAMAIS par
    // `burned`. Un survivant par forfait laissait donc la liste des brûlés vide — et une
    // borne lue dessus valait `None`, c'est-à-dire aucune borne, pour le joueur que le
    // classement de lava met en TÊTE (non brûlé devant brûlé).
    let rooms = new_rooms();
    let go = lava_race(&rooms, &["p1", "p2"], 20, &[("p1", 50), ("p2", 10)]);
    forfeit_race(&rooms, "c1", "p2"); // aucun tic n'a eu lieu : `burned` est vide
    assert!(finish_ok(&rooms, "c1", "p1"), "dernier vivant par forfait, pas par flamme");
    assert_eq!(stop_ms_at(&rooms, "c1", "p1", go + 3_000), Some(3_000.0));
}

#[test]
fn sous_lava_un_abandon_tardif_ne_recule_pas_la_borne_du_survivant() {
    // L'autre moitié du même piège : une flamme ANCIENNE suivie d'un abandon tardif.
    // Borner le survivant à la dernière flamme jetterait ici 70 s de frappe honnête.
    let rooms = new_rooms();
    let go = lava_race(&rooms, &["p1", "p2", "p3"], 20, &[("p1", 90), ("p2", 10), ("p3", 50)]);
    game_mode_tick(&rooms, go + 20_000); // p2 brûle
    forfeit_race(&rooms, "c1", "p3"); // p3 abandonne bien plus tard
    assert_eq!(stop_ms_at(&rooms, "c1", "p1", go + 90_000), Some(90_000.0));
}

#[test]
fn sous_spam_larret_est_date_et_le_meme_pour_tout_le_monde() {
    let rooms = new_rooms();
    let go = spam_race(&rooms, &["p1", "p2"], 50, 30);
    assert_eq!(stop_ms(&rooms, "c1", "p1"), None, "course en cours : aucune borne");

    game_mode_tick(&rooms, go + 30_400); // plafond de temps dépassé de 400 ms
    // L'instant retenu est celui du SCAN, pas le plafond théorique : le watchdog tourne
    // à la seconde, et c'est bien jusque-là que les partants ont pu taper.
    assert_eq!(stop_ms(&rooms, "c1", "p1"), Some(30_400.0));
    assert_eq!(stop_ms(&rooms, "c1", "p2"), Some(30_400.0), "SpamStop arrête tout le monde");
}

#[test]
fn sous_normal_aucune_borne_le_joueur_s_arrete_lui_meme() {
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    start_race(&rooms, "c1", "p1");
    assert_eq!(stop_ms(&rooms, "c1", "p1"), None);
}

#[test]
fn sous_normal_la_garde_ne_dit_jamais_non() {
    // C'est `requires_full_text` (#160) qui garde l'arrivée sous Normal, pas celle-ci.
    let rooms = new_rooms();
    join(&rooms, "c1", "p1");
    start_race(&rooms, "c1", "p1");
    assert!(finish_ok(&rooms, "c1", "p1"));
}
