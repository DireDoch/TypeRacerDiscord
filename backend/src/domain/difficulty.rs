// =============================================================================
//  domain/difficulty.rs — détection d'échec Expert/Master (issue #64, ADR 0013).
//
//  PORT Rust de `frontend/src/core/difficulty.ts` (la RÉFÉRENCE) — doit reproduire
//  ses chiffres bit pour bit : c'est la version autoritaire (Race, ADR 0013).
//
//  Câblé côté Race (issue #71, `ws/mod.rs::fail_race`) pour Master, authoritatif —
//  le Practice de l'issue #64 reste purement TS (free-input côté client).
// =============================================================================

use serde::{Deserialize, Serialize};

use crate::domain::types::{ControlKey, Keystroke};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Difficulty {
    Normal,
    Expert,
    Master,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DifficultyFailure {
    pub chars_done: i64,
    pub percent: i64,
}

fn percent_of(done: i64, total: i64) -> i64 {
    if total <= 0 {
        0
    } else {
        (done as f64 / total as f64 * 100.0).round().min(100.0) as i64
    }
}

/// Premier point d'échec pour la Difficulté donnée, ou `None` si le log ne fait
/// échouer le Run à aucun moment. Pure — voir `difficulty.ts` pour les règles.
pub fn detect_difficulty_failure(
    difficulty: Difficulty,
    target_words: &[String],
    keystrokes: &[Keystroke],
) -> Option<DifficultyFailure> {
    if difficulty == Difficulty::Normal {
        return None;
    }
    let total_len = target_words.join(" ").chars().count().max(1) as i64;

    let mut locked: Vec<String> = Vec::new();
    let mut typed = String::new();

    for k in keystrokes {
        let tgt = target_words.get(locked.len()).map(String::as_str).unwrap_or("");

        if k.ctrl == Some(ControlKey::BackspaceWord) {
            if !typed.is_empty() {
                typed.clear();
            } else if let Some(w) = locked.pop() {
                typed = w;
            }
            continue;
        }
        if k.ctrl == Some(ControlKey::Backspace) {
            if !typed.is_empty() {
                typed.pop();
            } else if let Some(w) = locked.pop() {
                typed = w;
            }
            continue;
        }
        if k.k == " " {
            if typed.is_empty() {
                continue; // espace en tête (ne devrait pas être loggé) : ignoré
            }
            if difficulty == Difficulty::Expert && typed != tgt {
                let chars_done = locked_len(&locked);
                return Some(DifficultyFailure { chars_done, percent: percent_of(chars_done, total_len) });
            }
            locked.push(typed.clone());
            typed.clear();
            continue;
        }
        if k.k.chars().count() == 1 {
            if difficulty == Difficulty::Master {
                let pos = typed.chars().count();
                let correct = pos < tgt.chars().count() && Some(k.k.as_str()) == tgt_char_at(tgt, pos);
                if !correct {
                    let chars_done = locked_len(&locked) + pos as i64;
                    return Some(DifficultyFailure {
                        chars_done,
                        percent: percent_of(chars_done, total_len),
                    });
                }
            }
            typed.push_str(&k.k);
        }
    }
    None
}

/// Longueur cumulée des mots verrouillés + un séparateur par mot (même formule que
/// `Race.charsDone()` côté TS : chaque mot verrouillé l'a été via un espace compté).
fn locked_len(locked: &[String]) -> i64 {
    locked.iter().map(|w| w.chars().count() as i64).sum::<i64>() + locked.len() as i64
}

fn tgt_char_at(tgt: &str, pos: usize) -> Option<&str> {
    tgt.get(pos..pos + 1) // ASCII cible (texte généré) : indexation octet == caractère
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct VectorFile {
        cases: Vec<Case>,
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        name: String,
        difficulty: Difficulty,
        target_words: Vec<String>,
        keystrokes: Vec<Keystroke>,
        expected: Option<DifficultyFailure>,
    }

    #[test]
    fn parity_vectors_ts_rust() {
        let file: VectorFile =
            serde_json::from_str(include_str!("../../../test-vectors/difficulty.json")).unwrap();
        assert!(!file.cases.is_empty());
        for case in file.cases {
            let got = detect_difficulty_failure(case.difficulty, &case.target_words, &case.keystrokes);
            assert_eq!(got, case.expected, "{}", case.name);
        }
    }
}
