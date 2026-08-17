// =============================================================================
//  ws/room_setting.rs — le Réglage de salon comme module (issue #129, ADR 0017).
//
//  CONTEXT.md définit le Réglage de salon par une seule règle : « même frontière de
//  confiance et même gating que Source de texte (ADR 0009) : owner-only, rejeté
//  mid-race, re-broadcast à tout le lobby à chaque changement accepté. » Avant ce
//  module, cette phrase était recopiée dans neuf fonctions `set_*` de `ws/mod.rs` — la
//  garde vit ICI, une seule fois. AJOUTER UN RÉGLAGE : une variante `RoomSetting` de
//  plus, un bras dans `value_is_valid` et un dans `apply`, aucune garde à écrire.
//
//  `set_ready` n'en fait PAS partie (ADR 0017) : n'importe quel présent se marque prêt,
//  pas de garde owner — ce n'est justement pas un Réglage de salon par définition du
//  glossaire (« set by the party leader »), pas un oubli. Précédent direct dans le code :
//  `Difficulty::Expert` est exclu pour la même raison structurelle (ADR 0013).
// =============================================================================

use super::{
    refresh_spam_text, room_state, rules, Difficulty, GameMode, Room, Rooms, TextSource,
    COUNTDOWN_VALUES, LAVA_INTERVAL_VALUES, MAX_PLAYERS, MIN_PLAYERS, SPAM_THRESHOLD_VALUES,
    SPAM_TIME_CAP_VALUES, SPAM_WORD_MAX_LEN, WORDS_LENGTHS,
};

/// Un Réglage de salon (CONTEXT.md) — une variante par `Set*` du protocole réseau, moins
/// `SetReady` (voir le commentaire d'en-tête).
pub enum RoomSetting {
    TextSource(TextSource),
    MaxPlayers(usize),
    Countdown(u32),
    ReadyCheck(bool),
    Difficulty(Difficulty),
    GameMode(GameMode),
    SpamWord(Option<String>),
    SpamThreshold(u32),
    SpamTimeCap(u32),
    LavaInterval(u32),
}

/// Verdict d'`apply_setting`, remplace le `bool` qui portait deux post-conditions
/// différentes selon la fonction sans que le type le dise (#129) : accepté-tout-court,
/// ou accepté-et-il-faut-`spawn_refresh_text`-hors-verrou (`SetTextSource`/`SetGameMode`,
/// seuls Réglages dont le texte imposé peut demander un aller-retour réseau, ADR 0017).
#[derive(Debug, PartialEq, Eq)]
pub enum SettingOutcome {
    Rejected,
    Applied,
    AppliedNeedsRetext,
}

impl SettingOutcome {
    pub fn accepted(&self) -> bool {
        !matches!(self, SettingOutcome::Rejected)
    }
}

/// Valide un mot personnalisé de Spam (ADR 0016). Pas d'espace — il transformerait
/// silencieusement « un mot répété » en plusieurs mots cibles et casserait le comptage
/// des répétitions. Chiffres et ponctuation à l'intérieur sont acceptés : seule la FORME
/// importe, pas le vocabulaire.
fn valid_spam_word(word: &str) -> bool {
    !word.is_empty()
        && word.chars().count() <= SPAM_WORD_MAX_LEN
        && !word.chars().any(|c| c.is_whitespace() || c.is_control())
}

impl RoomSetting {
    /// Le domaine de validité de la VALEUR seule, indépendant de toute Room — une
    /// frontière de confiance par variante (#129), testable sans Room ni Mutex.
    fn value_is_valid(&self) -> bool {
        match self {
            RoomSetting::TextSource(TextSource::Words { count }) => WORDS_LENGTHS.contains(count),
            RoomSetting::TextSource(TextSource::Quote) => true,
            RoomSetting::MaxPlayers(max) => (MIN_PLAYERS..=MAX_PLAYERS).contains(max),
            RoomSetting::Countdown(s) => COUNTDOWN_VALUES.contains(s),
            RoomSetting::ReadyCheck(_) => true,
            RoomSetting::Difficulty(d) => *d != Difficulty::Expert, // ADR 0013
            RoomSetting::GameMode(_) => true,
            RoomSetting::SpamWord(None) => true,
            RoomSetting::SpamWord(Some(w)) => valid_spam_word(w),
            RoomSetting::SpamThreshold(c) => SPAM_THRESHOLD_VALUES.contains(c),
            RoomSetting::SpamTimeCap(s) => SPAM_TIME_CAP_VALUES.contains(s),
            RoomSetting::LavaInterval(s) => LAVA_INTERVAL_VALUES.contains(s),
        }
    }

    /// Applique le Réglage sous verrou — owner, hors-course et `value_is_valid()` déjà
    /// vérifiés par `apply_setting`. Patron nominal : mute le champ, diffuse,
    /// `Applied` — sauf trois Réglages qui divergent pour une raison propre à EUX (et
    /// citée dans leur bras), pas par oubli :
    ///   - `TextSource` ne diffuse PAS ici : l'appelant régénère hors verrou, ce qui
    ///     rediffuse (une Quote peut demander un aller-retour réseau).
    ///   - `GameMode` pose son texte tout de suite pour les modes qui le produisent
    ///     eux-mêmes (`GameModeRules::on_mode_switch`, #128) puis demande quand même un
    ///     retext : no-op pour ces modes-là, `pending_source` y renvoie `None`.
    ///   - `SpamWord` porte une 3e garde (refusé hors Spam, ADR 0016) et régénère SOUS
    ///     ce verrou : aucun aller-retour réseau à attendre.
    fn apply(self, room: &mut Room) -> SettingOutcome {
        match self {
            RoomSetting::TextSource(source) => {
                room.text_source = source;
                SettingOutcome::AppliedNeedsRetext
            }
            RoomSetting::MaxPlayers(max) => {
                room.max_players = max;
                diffuse(room);
                SettingOutcome::Applied
            }
            RoomSetting::Countdown(seconds) => {
                room.countdown_s = seconds;
                diffuse(room);
                SettingOutcome::Applied
            }
            RoomSetting::ReadyCheck(enabled) => {
                room.ready_check = enabled;
                room.ready.clear();
                diffuse(room);
                SettingOutcome::Applied
            }
            RoomSetting::Difficulty(difficulty) => {
                room.difficulty = difficulty;
                diffuse(room);
                SettingOutcome::Applied
            }
            RoomSetting::GameMode(mode) => {
                if room.game_mode == mode {
                    return SettingOutcome::Rejected; // pas de bascule : rien à faire
                }
                room.game_mode = mode;
                rules(mode).on_mode_switch(room);
                diffuse(room);
                SettingOutcome::AppliedNeedsRetext
            }
            RoomSetting::SpamWord(word) => {
                if !rules(room.game_mode).accepts_spam_settings {
                    return SettingOutcome::Rejected; // 3e garde : refusé hors Spam
                }
                room.spam_word = word;
                refresh_spam_text(room);
                diffuse(room);
                SettingOutcome::Applied
            }
            RoomSetting::SpamThreshold(count) => {
                room.spam_threshold = count;
                diffuse(room);
                SettingOutcome::Applied
            }
            RoomSetting::SpamTimeCap(seconds) => {
                room.spam_time_cap_s = seconds;
                diffuse(room);
                SettingOutcome::Applied
            }
            RoomSetting::LavaInterval(seconds) => {
                room.lava_interval_s = seconds;
                diffuse(room);
                SettingOutcome::Applied
            }
        }
    }
}

fn diffuse(room: &Room) {
    let _ = room.tx.send(room_state(room));
}

/// La garde partagée par tout Réglage de salon (CONTEXT.md) — owner-only, rejeté
/// mid-race — une seule fois (#129), plus la validité de la valeur, avant même de
/// prendre le verrou.
pub fn apply_setting(
    rooms: &Rooms,
    key: &str,
    player_id: &str,
    setting: RoomSetting,
) -> SettingOutcome {
    if !setting.value_is_valid() {
        return SettingOutcome::Rejected;
    }
    let mut rooms = rooms.lock().unwrap();
    let Some(room) = rooms.get_mut(key) else { return SettingOutcome::Rejected };
    if room.owner != player_id || room.state.is_racing() {
        return SettingOutcome::Rejected;
    }
    setting.apply(room)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::difficulty::Difficulty;
    use serde::Deserialize;

    // Acceptance criterion (#129) : le domaine de validité de chaque Réglage se teste
    // sur la VALEUR seule, sans Room, sans Mutex, sans broadcast::Receiver.
    //
    // Depuis #202 les paliers ne sont plus écrits ici : ils viennent de
    // `test-vectors/room-settings.json`, que `frontend/src/core/net.test.ts` lit AUSSI.
    // Le client offre ces valeurs, le serveur les revalide — quand les deux divergent, le
    // joueur clique et rien ne bouge (`apply_setting` répond `Rejected` sans rien
    // renvoyer). Changer un palier d'un seul côté fait maintenant rougir les deux CI.

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Domains {
        words_lengths: Vec<u32>,
        max_players: Vec<usize>,
        countdown: Vec<u32>,
        lava_interval: Vec<u32>,
        spam_threshold: Vec<u32>,
        spam_time_cap: Vec<u32>,
        difficulties: Vec<Difficulty>,
        game_modes: Vec<GameMode>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Rejected {
        words_lengths: Vec<u32>,
        max_players: Vec<usize>,
        countdown: Vec<u32>,
        lava_interval: Vec<u32>,
        spam_threshold: Vec<u32>,
        spam_time_cap: Vec<u32>,
        difficulties: Vec<Difficulty>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Defaults {
        words_length: u32,
        max_players: usize,
        countdown: u32,
        lava_interval: u32,
        spam_threshold: u32,
        spam_time_cap: u32,
        difficulty: Difficulty,
        game_mode: GameMode,
        ready_check: bool,
        spam_word: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SpamWordVectors {
        max_len: usize,
        valid: Vec<String>,
        invalid: Vec<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vectors {
        domains: Domains,
        rejected: Rejected,
        defaults: Defaults,
        spam_word: SpamWordVectors,
    }

    fn vectors() -> Vectors {
        serde_json::from_str(include_str!("../../../test-vectors/room-settings.json"))
            .expect("test-vectors/room-settings.json lisible")
    }

    /// Le vecteur est l'AUTORITÉ : sans ce test, changer une constante déplacerait le
    /// domaine et le test qui le vérifie en même temps, et le client resterait seul à
    /// offrir l'ancien palier.
    #[test]
    fn les_constantes_du_serveur_sont_exactement_le_vecteur() {
        let d = vectors().domains;
        assert_eq!(WORDS_LENGTHS.to_vec(), d.words_lengths, "longueurs de la Source Mots");
        assert_eq!((MIN_PLAYERS..=MAX_PLAYERS).collect::<Vec<_>>(), d.max_players, "tailles de Room");
        assert_eq!(COUNTDOWN_VALUES.to_vec(), d.countdown, "durées de décompte");
        assert_eq!(LAVA_INTERVAL_VALUES.to_vec(), d.lava_interval, "intervalles d'élimination");
        assert_eq!(SPAM_THRESHOLD_VALUES.to_vec(), d.spam_threshold, "seuils de répétitions");
        assert_eq!(SPAM_TIME_CAP_VALUES.to_vec(), d.spam_time_cap, "plafonds de temps");
        assert_eq!(SPAM_WORD_MAX_LEN, vectors().spam_word.max_len, "longueur max du mot de Spam");
    }

    /// Ce qu'une Room neuve porte. `#185` a fait passer le décompte de 7 à 5 s sans que
    /// les replis du client suivent : le vecteur tient maintenant les deux.
    #[test]
    fn les_defauts_d_une_room_neuve_sont_ceux_du_vecteur() {
        let room = super::super::new_room("c1".to_string(), None, "p1");
        let d = vectors().defaults;
        assert_eq!(room.max_players, d.max_players);
        assert_eq!(room.countdown_s, d.countdown);
        assert_eq!(room.lava_interval_s, d.lava_interval);
        assert_eq!(room.spam_threshold, d.spam_threshold);
        assert_eq!(room.spam_time_cap_s, d.spam_time_cap);
        assert_eq!(room.difficulty, d.difficulty);
        assert_eq!(room.game_mode, d.game_mode);
        assert_eq!(room.ready_check, d.ready_check);
        assert_eq!(room.spam_word, d.spam_word);
        // Le texte d'une Room neuve est TOUJOURS des mots, même si la Source par défaut
        // est Quote (CONTEXT.md) — c'est cette longueur-là que le vecteur nomme.
        assert_eq!(super::super::ROOM_WORD_COUNT, d.words_length);
    }

    #[test]
    fn tout_le_domaine_du_vecteur_est_accepte() {
        let d = vectors().domains;
        let accepted: Vec<(&str, RoomSetting)> = [
            d.words_lengths
                .iter()
                .map(|c| ("longueur Mots", RoomSetting::TextSource(TextSource::Words { count: *c })))
                .collect::<Vec<_>>(),
            d.max_players.iter().map(|m| ("taille de Room", RoomSetting::MaxPlayers(*m))).collect(),
            d.countdown.iter().map(|s| ("décompte", RoomSetting::Countdown(*s))).collect(),
            d.lava_interval.iter().map(|s| ("intervalle lava", RoomSetting::LavaInterval(*s))).collect(),
            d.spam_threshold.iter().map(|c| ("seuil Spam", RoomSetting::SpamThreshold(*c))).collect(),
            d.spam_time_cap.iter().map(|s| ("plafond Spam", RoomSetting::SpamTimeCap(*s))).collect(),
            d.difficulties.iter().map(|x| ("difficulté", RoomSetting::Difficulty(*x))).collect(),
            d.game_modes.iter().map(|m| ("mode de jeu", RoomSetting::GameMode(*m))).collect(),
            vec![
                ("citation", RoomSetting::TextSource(TextSource::Quote)),
                ("ready-check activé", RoomSetting::ReadyCheck(true)),
                ("ready-check désactivé", RoomSetting::ReadyCheck(false)),
                ("mot de Spam par défaut", RoomSetting::SpamWord(None)),
            ],
        ]
        .into_iter()
        .flatten()
        .collect();
        for (label, setting) in accepted {
            assert!(setting.value_is_valid(), "{label} : refusé alors que le vecteur l'offre");
        }
    }

    #[test]
    fn tout_ce_que_le_vecteur_dit_hors_palier_est_refuse() {
        let r = vectors().rejected;
        let refused: Vec<(&str, RoomSetting)> = [
            r.words_lengths
                .iter()
                .map(|c| ("longueur Mots", RoomSetting::TextSource(TextSource::Words { count: *c })))
                .collect::<Vec<_>>(),
            r.max_players.iter().map(|m| ("taille de Room", RoomSetting::MaxPlayers(*m))).collect(),
            r.countdown.iter().map(|s| ("décompte", RoomSetting::Countdown(*s))).collect(),
            r.lava_interval.iter().map(|s| ("intervalle lava", RoomSetting::LavaInterval(*s))).collect(),
            r.spam_threshold.iter().map(|c| ("seuil Spam", RoomSetting::SpamThreshold(*c))).collect(),
            r.spam_time_cap.iter().map(|s| ("plafond Spam", RoomSetting::SpamTimeCap(*s))).collect(),
            // Expert (ADR 0013) : sa condition de déclenchement est inatteignable en Race.
            r.difficulties.iter().map(|x| ("difficulté", RoomSetting::Difficulty(*x))).collect(),
        ]
        .into_iter()
        .flatten()
        .collect();
        for (label, setting) in refused {
            assert!(!setting.value_is_valid(), "{label} : accepté alors que le vecteur le refuse");
        }
    }

    #[test]
    fn le_mot_personnalise_de_spam_suit_le_vecteur() {
        let w = vectors().spam_word;
        for word in w.valid {
            assert!(RoomSetting::SpamWord(Some(word.clone())).value_is_valid(), "refusé : {word:?}");
        }
        for word in w.invalid {
            assert!(!RoomSetting::SpamWord(Some(word.clone())).value_is_valid(), "accepté : {word:?}");
        }
    }
}
