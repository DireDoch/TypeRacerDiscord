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
    refresh_spam_text, spam_text, spam_word_of, words_text, Room, LAVA_WORD_COUNT,
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
    on_progress: fn(&mut Room, reps: u32),
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
    pub fn on_mode_switch(&self, room: &mut Room) {
        (self.on_mode_switch)(room)
    }
    pub fn rematch_text(&self, room: &mut Room) {
        (self.rematch_text)(room)
    }
    pub fn tick(&self, room: &mut Room, now: i64) {
        (self.tick)(room, now)
    }
    pub fn on_progress(&self, room: &mut Room, reps: u32) {
        (self.on_progress)(room, reps)
    }
    pub fn recompute_target_text(&self, target_text: &str, keystrokes: &[Keystroke]) -> String {
        (self.recompute_target_text)(target_text, keystrokes)
    }
    pub fn score_extra(&self, target_text: &str, keystrokes: &[Keystroke]) -> (Option<u32>, u32) {
        (self.score_extra)(target_text, keystrokes)
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
fn noop_progress(_room: &mut Room, _reps: u32) {}
fn no_extra(_target_text: &str, _keystrokes: &[Keystroke]) -> (Option<u32>, u32) {
    (None, 0)
}
fn identity_target_text(target_text: &str, _keystrokes: &[Keystroke]) -> String {
    target_text.to_string()
}

const NORMAL: GameModeRules = GameModeRules {
    min_players_to_start: 1,
    persists_run: true,
    accepts_spam_settings: false,
    pending_source: |room| Some(room.text_source),
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
    persists_run: false,
    accepts_spam_settings: false,
    pending_source: |_room| Some(TextSource::Words { count: LAVA_WORD_COUNT }),
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
    persists_run: false,
    accepts_spam_settings: true,
    pending_source: |_room| None,
    on_mode_switch: refresh_spam_text,
    rematch_text: refresh_spam_text,
    tick: super::spam_tick_room,
    on_progress: |room, reps| {
        if reps >= room.spam_threshold {
            super::stop_spam(room);
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
