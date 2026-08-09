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

    // Acceptance criterion (#129) : le domaine de validité de chaque Réglage se teste
    // sur la VALEUR seule, sans Room, sans Mutex, sans broadcast::Receiver.

    #[test]
    fn domaine_de_validite_de_chaque_reglage() {
        let cases: Vec<(&str, RoomSetting, bool)> = vec![
            ("longueur autorisée", RoomSetting::TextSource(TextSource::Words { count: 15 }), true),
            ("longueur arbitraire", RoomSetting::TextSource(TextSource::Words { count: 31 }), false),
            ("citation toujours valide", RoomSetting::TextSource(TextSource::Quote), true),
            ("taille dans la plage", RoomSetting::MaxPlayers(4), true),
            ("taille à zéro", RoomSetting::MaxPlayers(0), false),
            ("taille au-dessus du plafond dur", RoomSetting::MaxPlayers(999), false),
            ("décompte autorisé", RoomSetting::Countdown(5), true),
            ("décompte hors palier", RoomSetting::Countdown(4), false),
            ("ready-check : toujours valide (bool nu)", RoomSetting::ReadyCheck(true), true),
            ("difficulté Master", RoomSetting::Difficulty(Difficulty::Master), true),
            ("Expert n'est pas un Réglage de salon (ADR 0013)", RoomSetting::Difficulty(Difficulty::Expert), false),
            ("mode : toujours valide au niveau valeur", RoomSetting::GameMode(GameMode::Spam), true),
            ("mot par défaut (None)", RoomSetting::SpamWord(None), true),
            ("mot valide", RoomSetting::SpamWord(Some("l33t!".to_string())), true),
            ("mot avec espace : casserait le comptage", RoomSetting::SpamWord(Some("deux mots".to_string())), false),
            ("mot vide", RoomSetting::SpamWord(Some(String::new())), false),
            ("mot démesuré", RoomSetting::SpamWord(Some("a".repeat(21))), false),
            ("seuil autorisé", RoomSetting::SpamThreshold(20), true),
            ("seuil hors palier", RoomSetting::SpamThreshold(17), false),
            ("plafond de temps autorisé", RoomSetting::SpamTimeCap(30), true),
            ("plafond de temps hors palier", RoomSetting::SpamTimeCap(300), false),
            ("intervalle lava autorisé", RoomSetting::LavaInterval(10), true),
            ("intervalle lava hors palier", RoomSetting::LavaInterval(7), false),
        ];
        for (label, setting, expected) in cases {
            assert_eq!(setting.value_is_valid(), expected, "{label}");
        }
    }
}
