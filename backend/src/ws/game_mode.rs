// =============================================================================
//  ws/game_mode.rs — le seam du Mode de jeu (issue #128, ADR 0017).
//
//  Avant ce module, les 3 valeurs de `GameMode` (Normal / FloorIsLava / Spam) étaient
//  lues par un `if`/`match` à chaque endroit du moteur de course qui devait se comporter
//  différemment selon le mode — 13 sites, listés dans #128. `GameMode` reste l'enum du
//  PROTOCOLE réseau (Serialize/Deserialize, transporté par ClientEvent/ServerEvent) : ce
//  module ne le remplace pas, il RÉSOUT une table de règles depuis cet enum, une seule
//  fois, ici — c'est le seul endroit du crate qui a le droit de faire
//  `match mode { GameMode::… }` pour une question de comportement de Mode de jeu.
//
//  Table déclarée plutôt qu'un trait objet (ADR 0017) : `GameMode` doit de toute façon
//  rester l'enum sérialisable, un trait objet ne s'y substituerait pas — la table donne
//  la même lisibilité « un bloc par mode » sans la cérémonie d'un trait à dix méthodes
//  pour trois implémentations connues d'avance, et sans dispatch dynamique pour un
//  polymorphisme qui ne sert à rien ici (le mode d'une Room ne change jamais après
//  résolution). Chaque champ est un pointeur de fonction, pas une closure : aucun ne
//  capture d'état, la table entière est `'static`.
//
//  AJOUTER UN QUATRIÈME MODE : un bloc `GameModeRules { .. }` de plus dans `rules()`,
//  rien d'autre à toucher dans `ws/mod.rs`.
// =============================================================================

use std::cmp::Ordering;

use crate::domain::spam::count_reps;
use crate::domain::types::Keystroke;

use super::protocol::{GameMode, RaceResult, TextSource};
use super::{
    refresh_spam_text, spam_text, spam_word_of, words_text, RaceState, Room, LAVA_WORD_COUNT,
    ROOM_WORD_COUNT, SPAM_MAX_WORDS,
};

/// Les règles d'un Mode de jeu : tout ce que le moteur de course lui demande. L'inventaire
/// de départ est le tableau des 13 sites de #128 — un champ par question distincte, pas
/// un par site (plusieurs sites posaient la même question).
pub struct GameModeRules {
    /// Effectif minimum pour `StartRace` (ADR 0015 : 2 sous Floor is lava, personne
    /// d'autre à éliminer sinon). Distinct de `MIN_PLAYERS`, qui borne le RÉGLAGE de
    /// taille de Room — une question différente.
    pub min_players_to_start: usize,
    /// Une arrivée exige-t-elle d'avoir tapé TOUT le texte cible ? Vrai sous Normal, dont
    /// c'est la règle de victoire ; faux sous les deux Modes de jeu, qui n'ont pas de ligne
    /// d'arrivée (leur `Finish` livre le log de quelqu'un que le SERVEUR a déjà arrêté —
    /// brûlé, ou stoppé par SpamStop). Sans cette garde, un `Finish` de trois caractères
    /// annoncés en 50 ms passait pour une arrivée à 800 wpm, premier du podium.
    pub requires_full_text: bool,
    /// Ce `Finish` a-t-il le droit d'exister ? Question distincte de `requires_full_text`,
    /// qui juge le LOG une fois recompté ; celle-ci juge l'AUTEUR, contre l'état de la Room,
    /// avant tout recompute (issue #163).
    ///
    /// Sous les deux Modes de jeu, un `Finish` n'est pas censé venir du joueur : c'est le
    /// serveur qui décide qu'il a fini (`PlayerBurned`, `SpamStop`) et le `Finish` ne fait
    /// que livrer le log qu'on lui réclame. Sans cette garde, n'importe quel client envoyait
    /// le sien quand il voulait et sortait de la course à l'instant de son choix.
    ///
    /// Toujours vrai sous Normal, où franchir la ligne est précisément l'affaire du joueur —
    /// c'est `requires_full_text` qui y garde l'arrivée.
    finish_allowed: fn(&Room, &str) -> bool,
    /// L'instant (ms depuis t=0) où le SERVEUR a arrêté ce joueur — la borne temporelle de
    /// son log (issue #164, ADR 0018) : rien au-delà n'a pu être tapé, et c'est cet instant,
    /// pas la dernière frappe déclarée, qui fait le dénominateur du WPM.
    ///
    /// `now` (horloge injectée, même convention que `tick`) sert de MAJORANT quand le mode
    /// ne connaît pas d'instant exact : il est toujours sûr — un joueur n'a pas pu taper
    /// dans le futur, et un dénominateur trop large ne fait que baisser un WPM.
    ///
    /// `None` sous Normal seulement, où le joueur s'arrête lui-même en franchissant la
    /// ligne : il n'y a pas d'instant serveur à lui opposer. Sous un Mode de jeu la réponse
    /// est TOUJOURS `Some` en course — un seul trou et l'exploit de #164 se rouvre en
    /// entier. Troisième question distincte sur un `Finish`, après « son auteur y a-t-il
    /// droit ? » (`finish_allowed`) et « le log va-t-il au bout ? » (`requires_full_text`) :
    /// celle-ci borne le log DANS LE TEMPS.
    stopped_at_ms: fn(&Room, &str, now: i64) -> Option<f64>,
    /// Un Run sous ce mode entre-t-il dans `runs` (historique, jamais PB) ? Faux pour
    /// Floor is lava et Spam (ADR 0015, 0016) : texte imposé, jamais « terminé » au sens
    /// normal, rien à comparer d'une manche à l'autre.
    pub persists_run: bool,
    /// Les Réglages de salon propres à Spam (mot, seuil, plafond de temps) sont-ils
    /// acceptés sous ce mode ? Seul le MOT est aujourd'hui gardé ainsi (`set_spam_word`) —
    /// seuil et plafond se préparent d'avance sous n'importe quel mode, inertes jusqu'à
    /// bascule (ADR 0016).
    pub accepts_spam_settings: bool,
    /// La Source à regénérer de façon ASYNCHRONE (`spawn_refresh_text`, peut demander un
    /// fetch réseau pour une Quote) — `None` si ce mode produit son texte lui-même.
    pending_source: fn(&Room) -> Option<TextSource>,
    /// Le résultat de `pending_source` doit-il être écrit dans `room.text_source` une fois
    /// résolu ? Vrai pour Normal seul : `room.text_source` est le Réglage de salon choisi
    /// par l'owner, pas le texte que ce mode impose. Faux pour Floor is lava, dont le
    /// `Words{LAVA_WORD_COUNT}` de `pending_source` n'est qu'un texte à générer — l'écrire
    /// dans `text_source` effacerait le choix de l'owner (bug : #145).
    persists_source: bool,
    /// Appelé sous verrou juste après un `SetGameMode` accepté vers ce mode. No-op pour
    /// les modes qui suivent la Source (le changement de texte arrive plus tard, via
    /// `spawn_refresh_text` hors verrou) ; régénère tout de suite pour un mode qui produit
    /// son propre texte sans réseau (Spam).
    on_mode_switch: fn(&mut Room),
    /// Texte de revanche, posé SOUS LE VERROU dans `end_race` — toujours immédiat, jamais
    /// d'aller-retour réseau (une Quote retombe sur `ROOM_WORD_COUNT` mots ici même si la
    /// vraie citation arrivera plus tard via `spawn_refresh_text`).
    rematch_text: fn(&mut Room),
    /// Le tic du watchdog (ADR 0015, 0016) : métronome d'élimination pour Floor is lava,
    /// plafond de temps pour Spam. No-op pour Normal.
    tick: fn(&mut Room, now: i64),
    /// Réaction à un `Progress` relayé d'un partant (ADR 0016 : le seuil de répétitions
    /// coupe la course immédiatement, pas seulement au tic du watchdog). No-op ailleurs.
    on_progress: fn(&mut Room, reps: u32, now: i64),
    /// Le texte contre lequel `finish_race` recompute un log, depuis le `target_text` de
    /// la Room au moment du `Finish` (déjà extrait, hors verrou — pas de `&Room` ici).
    /// Identité pour Normal/Floor is lava ; sous Spam, reconstruit exactement assez de
    /// répétitions pour couvrir CE log (le texte imposé est infini, ADR 0016).
    recompute_target_text: fn(&str, &[Keystroke]) -> String,
    /// Grandeur(s) supplémentaire(s) que ce mode ajoute au score recompute — `(reps,
    /// spam_partial)`, `(None, 0)` hors Spam.
    score_extra: fn(&str, &[Keystroke]) -> (Option<u32>, u32),
    /// Comparateur de classement UNE FOIS les abandons/échecs Master repoussés en queue
    /// (`is_tail`, partagé par tous les modes — `end_race` l'applique en premier).
    rank_cmp: fn(&RaceResult, &RaceResult) -> Ordering,
    /// Le Play of the Game (ADR 0011) : quelle paire de résultats forme le duel le plus
    /// serré, et sur quelle grandeur.
    duel: fn(&[RaceResult]) -> Option<(usize, usize)>,
}

impl GameModeRules {
    pub fn pending_source(&self, room: &Room) -> Option<TextSource> {
        (self.pending_source)(room)
    }
    pub fn persists_source(&self) -> bool {
        self.persists_source
    }
    pub fn on_mode_switch(&self, room: &mut Room) {
        (self.on_mode_switch)(room)
    }
    pub fn rematch_text(&self, room: &mut Room) {
        (self.rematch_text)(room)
    }
    pub fn tick(&self, room: &mut Room, now: i64) {
        (self.tick)(room, now)
    }
    pub fn on_progress(&self, room: &mut Room, reps: u32, now: i64) {
        (self.on_progress)(room, reps, now)
    }
    pub fn recompute_target_text(&self, target_text: &str, keystrokes: &[Keystroke]) -> String {
        (self.recompute_target_text)(target_text, keystrokes)
    }
    pub fn score_extra(&self, target_text: &str, keystrokes: &[Keystroke]) -> (Option<u32>, u32) {
        (self.score_extra)(target_text, keystrokes)
    }
    pub fn finish_allowed(&self, room: &Room, player_id: &str) -> bool {
        (self.finish_allowed)(room, player_id)
    }
    pub fn stopped_at_ms(&self, room: &Room, player_id: &str, now: i64) -> Option<f64> {
        (self.stopped_at_ms)(room, player_id, now)
    }
    pub fn rank_cmp(&self, a: &RaceResult, b: &RaceResult) -> Ordering {
        (self.rank_cmp)(a, b)
    }
    pub fn duel(&self, results: &[RaceResult]) -> Option<(usize, usize)> {
        (self.duel)(results)
    }
}

fn noop_switch(_room: &mut Room) {}
fn noop_tick(_room: &mut Room, _now: i64) {}
fn noop_progress(_room: &mut Room, _reps: u32, _now: i64) {}
fn no_extra(_target_text: &str, _keystrokes: &[Keystroke]) -> (Option<u32>, u32) {
    (None, 0)
}
fn identity_target_text(target_text: &str, _keystrokes: &[Keystroke]) -> String {
    target_text.to_string()
}

const NORMAL: GameModeRules = GameModeRules {
    min_players_to_start: 1,
    requires_full_text: true,
    finish_allowed: |_room, _player_id| true,
    // Franchir la ligne est l'affaire du joueur : le serveur n'arrête personne ici.
    stopped_at_ms: |_room, _player_id, _now| None,
    persists_run: true,
    accepts_spam_settings: false,
    pending_source: |room| Some(room.text_source),
    persists_source: true,
    on_mode_switch: noop_switch,
    rematch_text: |room| {
        let count = match room.text_source {
            TextSource::Words { count } => count,
            TextSource::Quote => ROOM_WORD_COUNT,
        };
        let (seed, text) = words_text(count);
        room.seed = seed;
        room.target_text = text;
    },
    tick: noop_tick,
    on_progress: noop_progress,
    recompute_target_text: identity_target_text,
    score_extra: no_extra,
    rank_cmp: |a, b| b.wpm.partial_cmp(&a.wpm).unwrap_or(Ordering::Equal),
    duel: super::duel,
};

const FLOOR_IS_LAVA: GameModeRules = GameModeRules {
    // ADR 0015 : seul, on est déjà le dernier vivant, la course serait finie à t=0.
    min_players_to_start: 2,
    requires_full_text: false,
    // Brûlé : le serveur l'a arrêté, son log est réclamé. Dernier vivant : personne ne
    // le lui dit, il le DÉDUIT de ce qu'il ne reste que lui (ADR 0015) — le serveur
    // refait ici la même déduction plutôt que de le croire sur parole.
    finish_allowed: |room, player_id| match &room.state {
        RaceState::Racing { racers, finishers, burned, .. } => {
            burned.iter().any(|(id, _)| id == player_id) || {
                let alive = super::alive_racers(racers, finishers, burned);
                alive.len() == 1 && alive[0] == player_id
            }
        }
        RaceState::Lobby => false,
    },
    // Un brûlé s'arrête à SA flamme, instant exact que le serveur a lui-même décidé.
    //
    // Le dernier vivant, lui, n'a pas brûlé, et ce qui l'a laissé seul n'est PAS forcément
    // une flamme : un abandon, un échec Master et une déconnexion sortent aussi des vivants
    // (`alive_racers`), et ces sorties-là ne sont pas datées. Deux pièges qu'on a failli
    // prendre : lire le dernier `burned` donne `None` quand le dernier partant a abandonné
    // au lieu de brûler — survivant non borné, exploit intact — et un instant PÉRIMÉ quand
    // une flamme ancienne précède un abandon tardif, ce qui jetterait des dizaines de
    // secondes de frappe honnête.
    //
    // Donc on ne devine pas : `now`. Majorant sûr — le survivant ne peut pas avoir tapé
    // dans le futur, sa course est bien finie à cet instant-là, et il envoie son `Finish`
    // dès qu'il se voit seul. Traîner ne fait qu'agrandir son dénominateur, donc baisser
    // son propre WPM : personne n'a intérêt à en abuser.
    stopped_at_ms: |room, player_id, now| match &room.state {
        RaceState::Racing { start_at_epoch_ms, burned, .. } => Some(
            burned
                .iter()
                .find(|(id, _)| id == player_id)
                .map(|(_, at)| *at)
                .unwrap_or_else(|| (now - *start_at_epoch_ms).max(0) as f64),
        ),
        RaceState::Lobby => None,
    },
    persists_run: false,
    accepts_spam_settings: false,
    pending_source: |_room| Some(TextSource::Words { count: LAVA_WORD_COUNT }),
    persists_source: false,
    on_mode_switch: noop_switch,
    rematch_text: |room| {
        let (seed, text) = words_text(LAVA_WORD_COUNT);
        room.seed = seed;
        room.target_text = text;
    },
    tick: super::lava_tick_room,
    on_progress: noop_progress,
    recompute_target_text: identity_target_text,
    score_extra: no_extra,
    rank_cmp: |a, b| {
        a.burned_at_ms
            .is_some()
            .cmp(&b.burned_at_ms.is_some())
            .then(
                b.burned_at_ms
                    .unwrap_or(0.0)
                    .partial_cmp(&a.burned_at_ms.unwrap_or(0.0))
                    .unwrap_or(Ordering::Equal),
            )
    },
    duel: super::duel_by_wpm,
};

const SPAM: GameModeRules = GameModeRules {
    // ADR 0016 : courir seul contre un seuil ou une horloge reste un jeu, il n'y a pas
    // d'élimination qui le viderait de sens à un seul joueur.
    min_players_to_start: 1,
    requires_full_text: false,
    // `SpamStop` est diffusé à TOUT LE MONDE (ADR 0016) : avant lui, aucun log n'est
    // réclamé de personne ; après, ils le sont tous. Un seul drapeau suffit donc, sans
    // regarder qui envoie.
    finish_allowed: |room, _player_id| {
        matches!(&room.state, RaceState::Racing { spam_stopped_at_ms: Some(_), .. })
    },
    // `SpamStop` arrête TOUT LE MONDE au même instant (ADR 0016) : une seule borne, la
    // même pour tous, et elle vaut aussi pour le vainqueur qui a claqué le seuil.
    stopped_at_ms: |room, _player_id, _now| match &room.state {
        RaceState::Racing { spam_stopped_at_ms, .. } => *spam_stopped_at_ms,
        RaceState::Lobby => None,
    },
    persists_run: false,
    accepts_spam_settings: true,
    pending_source: |_room| None,
    persists_source: false,
    on_mode_switch: refresh_spam_text,
    rematch_text: refresh_spam_text,
    tick: super::spam_tick_room,
    on_progress: |room, reps, now| {
        if reps >= room.spam_threshold {
            super::stop_spam(room, now);
        }
    },
    recompute_target_text: |target_text, keystrokes| {
        let locks = keystrokes.iter().filter(|k| k.ctrl.is_none() && k.k == " ").count();
        spam_text(spam_word_of(target_text), (locks + 1).min(SPAM_MAX_WORDS))
    },
    score_extra: |target_text, keystrokes| {
        let c = count_reps(spam_word_of(target_text), keystrokes);
        (Some(c.reps), c.partial)
    },
    rank_cmp: |a, b| b.reps.cmp(&a.reps).then(b.spam_partial.cmp(&a.spam_partial)),
    duel: super::duel_by_wpm,
};

/// La table de règles d'un Mode de jeu — le seul endroit du crate qui a le droit de lire
/// `GameMode` pour une question de comportement.
pub fn rules(mode: GameMode) -> &'static GameModeRules {
    match mode {
        GameMode::Normal => &NORMAL,
        GameMode::FloorIsLava => &FLOOR_IS_LAVA,
        GameMode::Spam => &SPAM,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(player_id: &str) -> RaceResult {
        RaceResult { forfeit: false, ..RaceResult::forfeited(player_id) }
    }

    // Acceptance criterion (#128) : les règles d'un mode se testent sans `Room`, sans
    // `Mutex`, sans `broadcast::Receiver` — ce module entier n'en construit aucun.

    #[test]
    fn effectif_minimum_au_depart() {
        assert_eq!(rules(GameMode::Normal).min_players_to_start, 1);
        assert_eq!(rules(GameMode::FloorIsLava).min_players_to_start, 2); // ADR 0015
        assert_eq!(rules(GameMode::Spam).min_players_to_start, 1); // ADR 0016
    }

    #[test]
    fn seul_normal_persiste_le_run() {
        assert!(rules(GameMode::Normal).persists_run);
        assert!(!rules(GameMode::FloorIsLava).persists_run);
        assert!(!rules(GameMode::Spam).persists_run);
    }

    #[test]
    fn seul_spam_accepte_ses_reglages() {
        assert!(!rules(GameMode::Normal).accepts_spam_settings);
        assert!(!rules(GameMode::FloorIsLava).accepts_spam_settings);
        assert!(rules(GameMode::Spam).accepts_spam_settings);
    }

    #[test]
    fn normal_classe_au_wpm_decroissant() {
        let a = RaceResult { wpm: 80.0, ..result("a") };
        let b = RaceResult { wpm: 100.0, ..result("b") };
        assert_eq!(rules(GameMode::Normal).rank_cmp(&a, &b), Ordering::Greater); // b devant
    }

    #[test]
    fn floor_is_lava_classe_le_survivant_devant_et_le_dernier_brule_en_second() {
        let survivant = result("a"); // burned_at_ms: None
        let brule_tot = RaceResult { burned_at_ms: Some(1000.0), ..result("b") };
        let brule_tard = RaceResult { burned_at_ms: Some(5000.0), ..result("c") };
        assert_eq!(rules(GameMode::FloorIsLava).rank_cmp(&survivant, &brule_tard), Ordering::Less);
        assert_eq!(rules(GameMode::FloorIsLava).rank_cmp(&brule_tard, &brule_tot), Ordering::Less);
    }

    #[test]
    fn spam_classe_aux_repetitions_puis_au_partiel() {
        let peu = RaceResult { reps: Some(3), spam_partial: 2, ..result("a") };
        let beaucoup = RaceResult { reps: Some(10), spam_partial: 0, ..result("b") };
        assert_eq!(rules(GameMode::Spam).rank_cmp(&peu, &beaucoup), Ordering::Greater);
        let a_egalite_partiel_bas = RaceResult { reps: Some(5), spam_partial: 1, ..result("c") };
        let a_egalite_partiel_haut = RaceResult { reps: Some(5), spam_partial: 4, ..result("d") };
        assert_eq!(
            rules(GameMode::Spam).rank_cmp(&a_egalite_partiel_bas, &a_egalite_partiel_haut),
            Ordering::Greater
        );
    }

    #[test]
    fn le_duel_de_floor_is_lava_et_spam_se_mesure_au_wpm_pas_a_la_duree() {
        // `duration_ms` identiques (comme un arrêt/décès qui tombe au même instant pour
        // tout le monde) : `duel()` n'y verrait aucun écart à départager, `duel_by_wpm`
        // si. Les deux modes doivent utiliser ce second (ADR 0015, 0016).
        let results = vec![
            RaceResult { wpm: 40.0, duration_ms: 1000.0, ..result("a") },
            RaceResult { wpm: 41.0, duration_ms: 1000.0, ..result("b") },
            RaceResult { wpm: 80.0, duration_ms: 1000.0, ..result("c") },
        ];
        assert_eq!(rules(GameMode::FloorIsLava).duel(&results), Some((1, 0)));
        assert_eq!(rules(GameMode::Spam).duel(&results), Some((1, 0)));
    }
}
