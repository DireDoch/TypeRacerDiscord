// =============================================================================
//  domain/replay.rs — recompute autoritaire du Scoreboard.
//
//  PORT Rust de `frontend/src/core/stats/scoreboard.ts` (la RÉFÉRENCE). Doit
//  reproduire ses chiffres bit pour bit : c'est la version autoritaire (anti-triche
//  en Phase 2). Toute évolution de l'algo part du TS puis se reporte ici.
//
//  Règles figées (CONTEXT.md) :
//   - t=0 = fin du décompte ; durée selon le Mode.
//   - WPM = chars corrects à l'ÉTAT FINAL ÷ 5 ÷ min (espaces séparateurs inclus).
//   - Raw = toutes frappes imprimables ÷ 5 ÷ min.
//   - ACC = frappes correctes ÷ total frappes (Backspace neutre ; Extra = incorrect).
//   - Curseur LIBRE (pile) : le backspace peut rouvrir les mots précédents.
//   - Breakdown : Correct/Incorrect par frappe ; Extra/Missed à l'état final.
// =============================================================================

use crate::domain::types::{CharacterBreakdown, ControlKey, Keystroke, Mode, PerSecondPoint, Scoreboard};

/// Entrée du recompute (sous-ensemble de SubmitRunRequest utile à l'algo).
pub struct ScoreInput {
    pub mode: Mode,
    pub mode_value: i64,
    pub target_text: String,
    pub keystrokes: Vec<Keystroke>,
}

struct Snapshot {
    t: f64,
    correct_chars: i64,
    raw_chars: i64,
}

struct Completion {
    t: f64,
    word_wpm: f64,
}

struct ReplayResult {
    correct_chars: i64,
    raw_chars: i64,
    breakdown: CharacterBreakdown,
    snapshots: Vec<Snapshot>,
    error_events: Vec<f64>,
    completions: Vec<Completion>,
}

// Éligibilité PB par défaut du Mode : Zen (durée variable), Drill (texte personnalisé)
// et Quotes (longueur non capturée par le Config bucket, ADR 0003) sont incomparables.
// Time infini est une exception À L'INTÉRIEUR de Time (propriété d'UN Run, pas du Mode).
fn mode_pb_eligible(mode: Mode) -> bool {
    match mode {
        Mode::Time | Mode::Words => true,
        Mode::Quotes | Mode::Zen | Mode::Drill => false,
    }
}

pub fn compute_scoreboard(input: &ScoreInput) -> Scoreboard {
    let duration_ms = resolve_duration(input);
    let pb_eligible =
        mode_pb_eligible(input.mode) && !(input.mode == Mode::Time && input.mode_value == 0);

    let result = if input.mode == Mode::Zen {
        replay_zen(&input.keystrokes)
    } else {
        replay_target(&input.target_text, &input.keystrokes)
    };

    // `|| Infinity` du TS : un Run de 0 ms ⇒ 0 WPM (pas de division par 0).
    let minutes = if duration_ms > 0.0 {
        duration_ms / 60000.0
    } else {
        f64::INFINITY
    };
    let wpm = round1(result.correct_chars as f64 / 5.0 / minutes);
    let raw = round1(result.raw_chars as f64 / 5.0 / minutes);
    let total_keys = result.breakdown.correct + result.breakdown.incorrect;
    let accuracy = if total_keys == 0 {
        100.0
    } else {
        round1(result.breakdown.correct as f64 / total_keys as f64 * 100.0)
    };

    let per_second = build_per_second(
        &result.snapshots,
        &result.error_events,
        &result.completions,
        duration_ms,
    );

    Scoreboard {
        wpm,
        raw,
        accuracy,
        characters: result.breakdown,
        duration_ms,
        per_second,
        pb_eligible,
    }
}

// Borne anti-DoS : ended_at_ms ET keystroke.t viennent du client, donc falsifiables.
// build_per_second alloue O(durée) — sans plafond un Run "aberrant" ferait exploser l'allocation.
const MAX_DURATION_MS: f64 = 30.0 * 60.0 * 1000.0; // 30 min, généreux pour Zen/Drill légitimes

fn resolve_duration(input: &ScoreInput) -> f64 {
    if input.mode == Mode::Time && input.mode_value > 0 {
        return input.mode_value as f64 * 1000.0;
    }
    // words/quotes (complétion), zen & time infini (Shift+Enter) : dérivée du log de frappes
    // (source faisant foi côté serveur), jamais du ended_at_ms client tel quel — et bornée.
    last_key_t(&input.keystrokes).clamp(0.0, MAX_DURATION_MS)
}

// ----------------------------------------------------------------------------
//  Replay — modes avec texte cible (time / words / quotes), curseur libre
// ----------------------------------------------------------------------------

fn replay_target(target_text: &str, keys: &[Keystroke]) -> ReplayResult {
    let target: Vec<&str> = if target_text.is_empty() {
        Vec::new()
    } else {
        target_text.split(' ').collect()
    };

    // Curseur libre : `locked` est une PILE des mots verrouillés (réouvrables).
    let mut locked: Vec<String> = Vec::new();
    let mut typed = String::new();
    let mut word_start_t: Option<f64> = None; // 1re frappe du mot courant (chrono Burst)

    let mut frozen_correct: i64 = 0; // chars corrects des mots verrouillés (+ séparateurs), réversible
    let mut raw_chars: i64 = 0;
    let mut correct_keys: i64 = 0;
    let mut incorrect_keys: i64 = 0;

    let mut snapshots: Vec<Snapshot> = Vec::new();
    let mut error_events: Vec<f64> = Vec::new();
    let mut completions: Vec<Completion> = Vec::new();

    for k in keys {
        let tgt: &str = target.get(locked.len()).copied().unwrap_or("");

        match k.ctrl {
            Some(ControlKey::BackspaceWord) => {
                if clen(&typed) > 0 {
                    typed.clear();
                } else if let Some(w) = locked.pop() {
                    let prev = target.get(locked.len()).copied().unwrap_or("");
                    frozen_correct -= word_correct(&w, prev) + 1;
                    typed.clear();
                }
                word_start_t = None;
                snap(&mut snapshots, k.t, frozen_correct, &typed, &target, locked.len(), raw_chars);
                continue;
            }
            Some(ControlKey::Backspace) => {
                if clen(&typed) > 0 {
                    typed.pop();
                    if clen(&typed) == 0 {
                        word_start_t = None;
                    }
                } else if let Some(w) = locked.pop() {
                    // Curseur libre : rouvre le mot précédent (contenu réédité).
                    let prev = target.get(locked.len()).copied().unwrap_or("");
                    frozen_correct -= word_correct(&w, prev) + 1;
                    typed = w;
                    word_start_t = None;
                }
                snap(&mut snapshots, k.t, frozen_correct, &typed, &target, locked.len(), raw_chars);
                continue;
            }
            None => {}
        }

        if k.k == " " {
            if clen(&typed) == 0 {
                // Espace en tête (ne devrait pas être loggé) : ignoré.
                snap(&mut snapshots, k.t, frozen_correct, &typed, &target, locked.len(), raw_chars);
                continue;
            }
            frozen_correct += word_correct(&typed, tgt) + 1; // +1 = espace séparateur (correct)
            correct_keys += 1; // l'espace compte comme frappe correcte
            raw_chars += 1;
            complete_word(&mut completions, word_start_t, k.t, clen(tgt));
            locked.push(std::mem::take(&mut typed));
            word_start_t = None;
            snap(&mut snapshots, k.t, frozen_correct, &typed, &target, locked.len(), raw_chars);
            continue;
        }

        if clen(&k.k) == 1 {
            if word_start_t.is_none() {
                word_start_t = Some(k.t);
            }
            let pos = clen(&typed);
            let correct = pos < clen(tgt) && k.k.chars().next() == tgt.chars().nth(pos as usize);
            if correct {
                correct_keys += 1;
            } else {
                incorrect_keys += 1;
                error_events.push(k.t);
            }
            raw_chars += 1;
            if clen(&typed) < max_buffer(tgt) {
                typed.push_str(&k.k); // plafond d'Extra
            }
            snap(&mut snapshots, k.t, frozen_correct, &typed, &target, locked.len(), raw_chars);
        }
    }

    // État final : Extra/Missed sur TOUS les mots atteints (verrouillés + courant).
    let mut extra: i64 = 0;
    let mut missed: i64 = 0;
    for (i, w) in locked.iter().enumerate() {
        let t = target.get(i).copied().unwrap_or("");
        extra += (clen(w) - clen(t)).max(0);
        missed += (clen(t) - clen(w)).max(0);
    }
    let last_tgt = target.get(locked.len()).copied().unwrap_or("");
    let correct_chars = frozen_correct + word_correct(&typed, last_tgt);
    extra += (clen(&typed) - clen(last_tgt)).max(0);
    // Complétion du dernier mot (words/quotes terminé sans espace final).
    if clen(&typed) >= clen(last_tgt) && clen(last_tgt) > 0 {
        complete_word(&mut completions, word_start_t, last_key_t(keys), clen(last_tgt));
    }

    ReplayResult {
        correct_chars,
        raw_chars,
        breakdown: CharacterBreakdown {
            correct: correct_keys,
            incorrect: incorrect_keys,
            extra,
            missed,
        },
        snapshots,
        error_events,
        completions,
    }
}

// ----------------------------------------------------------------------------
//  Replay — Zen (pas de texte cible : tout caractère GARDÉ est correct)
// ----------------------------------------------------------------------------
//
//  Même modèle de pile que replay_target, mais sans cible : WPM = état visible final
//  (le retour arrière EFFACE, il ne compte pas), Raw = toutes les frappes imprimables
//  (l'effort, effacé inclus), ACC = 100 % (rien n'est faux sans cible).
//  La mécanique de pile (~15 l.) est volontairement dupliquée de replay_target :
//  la factoriser forcerait à toucher l'algo autoritaire testé, et une copie locale
//  vaut mieux qu'une parité fragile entre les deux chemins.

fn replay_zen(keys: &[Keystroke]) -> ReplayResult {
    let mut locked: Vec<String> = Vec::new();
    let mut typed = String::new();
    let mut word_start_t: Option<f64> = None;

    let mut frozen_visible: i64 = 0; // chars visibles des mots verrouillés (+ séparateurs), réversible
    let mut raw_chars: i64 = 0; // toutes les frappes imprimables (jamais décrémenté)
    let mut keys_typed: i64 = 0; // frappes imprimables = frappes correctes (aucune cible → rien de faux)

    let mut snapshots: Vec<Snapshot> = Vec::new();
    let mut completions: Vec<Completion> = Vec::new();
    let push_snap = |snapshots: &mut Vec<Snapshot>, t: f64, visible: i64, typed: &str, raw: i64| {
        snapshots.push(Snapshot { t, correct_chars: visible + clen(typed), raw_chars: raw });
    };

    for k in keys {
        match k.ctrl {
            Some(ControlKey::BackspaceWord) => {
                if clen(&typed) > 0 {
                    typed.clear();
                } else if let Some(w) = locked.pop() {
                    frozen_visible -= clen(&w) + 1;
                    typed.clear();
                }
                word_start_t = None;
                push_snap(&mut snapshots, k.t, frozen_visible, &typed, raw_chars);
                continue;
            }
            Some(ControlKey::Backspace) => {
                if clen(&typed) > 0 {
                    typed.pop();
                    if clen(&typed) == 0 {
                        word_start_t = None;
                    }
                } else if let Some(w) = locked.pop() {
                    frozen_visible -= clen(&w) + 1; // retire le mot + son séparateur
                    typed = w; // rouvert, éditable
                    word_start_t = None;
                }
                push_snap(&mut snapshots, k.t, frozen_visible, &typed, raw_chars);
                continue;
            }
            None => {}
        }

        if k.k == " " {
            if clen(&typed) == 0 {
                push_snap(&mut snapshots, k.t, frozen_visible, &typed, raw_chars);
                continue;
            }
            frozen_visible += clen(&typed) + 1; // mot + séparateur, tous visibles/corrects
            keys_typed += 1; // l'espace = frappe correcte
            raw_chars += 1;
            complete_word(&mut completions, word_start_t, k.t, clen(&typed));
            locked.push(std::mem::take(&mut typed));
            word_start_t = None;
            push_snap(&mut snapshots, k.t, frozen_visible, &typed, raw_chars);
            continue;
        }

        if clen(&k.k) == 1 {
            if word_start_t.is_none() {
                word_start_t = Some(k.t);
            }
            keys_typed += 1;
            raw_chars += 1;
            typed.push_str(&k.k); // pas de plafond (aucune cible)
            push_snap(&mut snapshots, k.t, frozen_visible, &typed, raw_chars);
        }
    }

    ReplayResult {
        correct_chars: frozen_visible + clen(&typed),
        raw_chars,
        breakdown: CharacterBreakdown { correct: keys_typed, incorrect: 0, extra: 0, missed: 0 },
        snapshots,
        error_events: Vec::new(),
        completions,
    }
}

// ----------------------------------------------------------------------------
//  Série par seconde
// ----------------------------------------------------------------------------

fn build_per_second(
    snapshots: &[Snapshot],
    error_events: &[f64],
    completions: &[Completion],
    duration_ms: f64,
) -> Vec<PerSecondPoint> {
    let duration_s = duration_ms / 1000.0;
    if duration_s <= 0.0 {
        return Vec::new();
    }

    let mut marks: Vec<f64> = Vec::new();
    let floor = duration_s.floor() as i64;
    for n in 1..=floor {
        marks.push(n as f64);
    }
    if marks.last().copied() != Some(duration_s) {
        marks.push(duration_s);
    }

    let mut points: Vec<PerSecondPoint> = Vec::new();
    let mut snap_ptr = 0usize;
    let mut cc: i64 = 0;
    let mut rc: i64 = 0;
    let mut prev_tms = 0.0f64;
    let mut last_burst = 0.0f64;

    for m in marks {
        let tms = m * 1000.0;

        // Cumulatif : dernière snapshot avec t <= tms.
        while snap_ptr < snapshots.len() && snapshots[snap_ptr].t <= tms {
            cc = snapshots[snap_ptr].correct_chars;
            rc = snapshots[snap_ptr].raw_chars;
            snap_ptr += 1;
        }

        let min = m / 60.0;
        let errors = error_events.iter().filter(|&&t| t > prev_tms && t <= tms).count() as i64;
        let burst = completions
            .iter()
            .filter(|c| c.t > prev_tms && c.t <= tms)
            .map(|c| c.word_wpm)
            .fold(None, |acc: Option<f64>, w| Some(acc.map_or(w, |a| a.max(w))))
            .unwrap_or(last_burst);
        last_burst = burst;

        points.push(PerSecondPoint {
            t: round2(m),
            wpm: round1(cc as f64 / 5.0 / min),
            raw: round1(rc as f64 / 5.0 / min),
            errors,
            burst,
        });
        prev_tms = tms;
    }

    points
}

// ----------------------------------------------------------------------------
//  Utilitaires
// ----------------------------------------------------------------------------

/// Nombre de chars (codepoints). Miroir de `String.length` pour notre texte (BMP).
fn clen(s: &str) -> i64 {
    s.chars().count() as i64
}

/// Chars corrects de `typed` vis-à-vis de `target` (position par position).
fn word_correct(typed: &str, target: &str) -> i64 {
    typed
        .chars()
        .zip(target.chars())
        .filter(|(a, b)| a == b)
        .count() as i64
}

/// Plafond du buffer pour le mot courant (~2× la longueur cible, min +4).
fn max_buffer(target: &str) -> i64 {
    let n = clen(target);
    n + n.max(4)
}

#[allow(clippy::too_many_arguments)]
fn snap(
    snapshots: &mut Vec<Snapshot>,
    t: f64,
    frozen_correct: i64,
    typed: &str,
    target: &[&str],
    locked_len: usize,
    raw_chars: i64,
) {
    let cur = target.get(locked_len).copied().unwrap_or("");
    snapshots.push(Snapshot {
        t,
        correct_chars: frozen_correct + word_correct(typed, cur),
        raw_chars,
    });
}

fn complete_word(completions: &mut Vec<Completion>, word_start_t: Option<f64>, t: f64, len: i64) {
    if let Some(ws) = word_start_t {
        if t > ws {
            completions.push(Completion {
                t,
                word_wpm: round1(len as f64 / 5.0 / ((t - ws) / 60000.0)),
            });
        }
    }
}

fn last_key_t(keys: &[Keystroke]) -> f64 {
    keys.last().map(|k| k.t).unwrap_or(0.0)
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

// ----------------------------------------------------------------------------
//  Tests de parité avec scoreboard.test.ts
// ----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit un log depuis des tuples (t, k, ctrl?).
    fn log(events: &[(f64, &str, Option<ControlKey>)]) -> Vec<Keystroke> {
        events
            .iter()
            .map(|(t, k, ctrl)| Keystroke {
                t: *t,
                k: if ctrl.is_some() { String::new() } else { k.to_string() },
                ctrl: *ctrl,
            })
            .collect()
    }

    fn input(mode: Mode, mode_value: i64, target: &str, keys: Vec<Keystroke>, _ended: f64) -> ScoreInput {
        // _ended : conservé pour que chaque appel montre l'endedAtMs "client" à côté du
        // log — il n'a plus d'effet, c'est tout le point de l'issue #11.
        ScoreInput { mode, mode_value, target_text: target.to_string(), keystrokes: keys }
    }

    #[test]
    fn perfect_the_cat() {
        let s = compute_scoreboard(&input(
            Mode::Words,
            2,
            "the cat",
            log(&[(100.0, "t", None), (200.0, "h", None), (300.0, "e", None), (400.0, " ", None), (500.0, "c", None), (600.0, "a", None), (700.0, "t", None)]),
            700.0,
        ));
        assert_eq!(s.wpm, 120.0);
        assert_eq!(s.raw, 120.0);
        assert_eq!(s.accuracy, 100.0);
        assert_eq!(s.characters, CharacterBreakdown { correct: 7, incorrect: 0, extra: 0, missed: 0 });
    }

    #[test]
    fn faute_interne_cxt() {
        let s = compute_scoreboard(&input(
            Mode::Words,
            1,
            "cat",
            log(&[(100.0, "c", None), (200.0, "x", None), (300.0, "t", None)]),
            300.0,
        ));
        assert_eq!(s.characters, CharacterBreakdown { correct: 2, incorrect: 1, extra: 0, missed: 0 });
        assert_eq!(s.accuracy, 66.7);
        assert_eq!(s.wpm, 80.0);
        assert_eq!(s.raw, 120.0);
    }

    #[test]
    fn extra_hixx() {
        let s = compute_scoreboard(&input(
            Mode::Words,
            1,
            "hi",
            log(&[(100.0, "h", None), (200.0, "i", None), (300.0, "x", None), (400.0, "x", None)]),
            400.0,
        ));
        assert_eq!(s.characters, CharacterBreakdown { correct: 2, incorrect: 2, extra: 2, missed: 0 });
        assert_eq!(s.accuracy, 50.0);
    }

    #[test]
    fn curseur_libre_correction_mot_anterieur() {
        // "ab cd" : "xb" (1 faute), espace, retour corriger en "ab", espace, "cd".
        let s = compute_scoreboard(&input(
            Mode::Words,
            2,
            "ab cd",
            log(&[
                (100.0, "x", None), (200.0, "b", None), (300.0, " ", None),
                (400.0, "", Some(ControlKey::Backspace)), // rouvre "xb"
                (500.0, "", Some(ControlKey::Backspace)), // "xb" -> "x"
                (600.0, "", Some(ControlKey::Backspace)), // "x" -> ""
                (700.0, "a", None), (800.0, "b", None), (900.0, " ", None),
                (1000.0, "c", None), (1100.0, "d", None),
            ]),
            1100.0,
        ));
        // État final "ab cd" parfait → pas d'extra/missed ; la frappe "x" reste en incorrect.
        assert_eq!(s.characters, CharacterBreakdown { correct: 7, incorrect: 1, extra: 0, missed: 0 });
        assert_eq!(s.accuracy, 87.5);
        assert_eq!(s.wpm, 54.5);
    }

    #[test]
    fn missed_espace_anticipe() {
        let s = compute_scoreboard(&input(
            Mode::Words,
            2,
            "cat dog",
            log(&[(100.0, "c", None), (200.0, "a", None), (300.0, " ", None), (400.0, "d", None), (500.0, "o", None), (600.0, "g", None)]),
            600.0,
        ));
        assert_eq!(s.characters, CharacterBreakdown { correct: 6, incorrect: 0, extra: 0, missed: 1 });
    }

    #[test]
    fn serie_par_seconde_et_burst() {
        let s = compute_scoreboard(&input(
            Mode::Words,
            3,
            "aa bb cc",
            log(&[
                (100.0, "a", None), (200.0, "a", None), (300.0, " ", None),
                (1100.0, "b", None), (1200.0, "b", None), (1300.0, " ", None),
                (2100.0, "c", None), (2200.0, "c", None),
            ]),
            2200.0,
        ));
        assert_eq!(s.per_second.len(), 3);
        assert_eq!(s.per_second[0], PerSecondPoint { t: 1.0, wpm: 36.0, raw: 36.0, errors: 0, burst: 120.0 });
        assert_eq!(s.per_second[1], PerSecondPoint { t: 2.0, wpm: 36.0, raw: 36.0, errors: 0, burst: 120.0 });
        assert_eq!(s.per_second[2], PerSecondPoint { t: 2.2, wpm: 43.6, raw: 43.6, errors: 0, burst: 240.0 });
    }

    #[test]
    fn zen_acc_100_exclu_pb() {
        let s = compute_scoreboard(&input(
            Mode::Zen,
            0,
            "",
            log(&[(100.0, "a", None), (200.0, "b", None), (300.0, "c", None), (400.0, " ", None), (500.0, "d", None), (600.0, "e", None), (700.0, "f", None)]),
            1_000_000.0, // ignoré : la durée vient du dernier t du log, pas du client
        ));
        assert_eq!(s.characters, CharacterBreakdown { correct: 7, incorrect: 0, extra: 0, missed: 0 });
        assert_eq!(s.accuracy, 100.0);
        assert_eq!(s.wpm, 120.0); // 7 ÷ 5 ÷ (0.7/60)
        assert!(!s.pb_eligible);
    }

    #[test]
    fn zen_retour_arriere_etat_visible() {
        // "teh" → 2× backspace → "he" ⇒ visible "the" (3 chars) ; effort brut = 5 frappes.
        let s = compute_scoreboard(&input(
            Mode::Zen,
            0,
            "",
            log(&[
                (100.0, "t", None), (200.0, "e", None), (300.0, "h", None),
                (400.0, "", Some(ControlKey::Backspace)),
                (500.0, "", Some(ControlKey::Backspace)),
                (600.0, "h", None), (700.0, "e", None),
            ]),
            1_000_000.0, // ignoré, idem
        ));
        assert_eq!(s.wpm, 51.4); // 3 chars visibles ÷ 5 ÷ (0.7/60)
        assert_eq!(s.raw, 85.7); // 5 frappes ÷ 5 ÷ (0.7/60)
        assert_eq!(s.accuracy, 100.0);
        assert_eq!(s.characters, CharacterBreakdown { correct: 5, incorrect: 0, extra: 0, missed: 0 });
        assert!(!s.pb_eligible);
    }

    #[test]
    fn eligibilite_pb() {
        let k = log(&[(100.0, "a", None)]);
        assert!(!compute_scoreboard(&input(Mode::Time, 0, "the cat", k.clone(), 1000.0)).pb_eligible);
        // Drill : texte personnalisé ⇒ jamais de PB (même règle que Zen / Time infini).
        assert!(!compute_scoreboard(&input(Mode::Drill, 0, "fjf jfj the", k.clone(), 1000.0)).pb_eligible);
        assert!(compute_scoreboard(&input(Mode::Time, 30, "the cat", k, 1000.0)).pb_eligible);
    }

    #[test]
    fn quotes_exclu_du_pb_longueur_non_capturee_par_le_bucket() {
        // issue #14 / ADR 0003 : une Quote courte et une longue partagent le même bucket
        // (mode_value = 0 pour toutes) ⇒ jamais comparables, jamais de PB.
        let court = compute_scoreboard(&input(Mode::Quotes, 0, "hi", log(&[(100.0, "h", None), (200.0, "i", None)]), 200.0));
        let long = compute_scoreboard(&input(Mode::Quotes, 0, "the cat sat", log(&[(100.0, "a", None)]), 100.0));
        assert!(!court.pb_eligible);
        assert!(!long.pb_eligible);
    }

    #[test]
    fn espace_en_tete_ignore_meme_garde_que_analysis_rs() {
        // Log client (issue #11) avec un espace en tête, que FreeInput ne journalise
        // jamais lui-même : ignoré, ne verrouille pas de mot vide (issue #15).
        let s = compute_scoreboard(&input(
            Mode::Words,
            2,
            "the cat",
            log(&[
                (100.0, " ", None),
                (200.0, "t", None), (300.0, "h", None), (400.0, "e", None), (500.0, " ", None),
                (600.0, "c", None), (700.0, "a", None), (800.0, "t", None),
            ]),
            800.0,
        ));
        assert_eq!(s.characters, CharacterBreakdown { correct: 7, incorrect: 0, extra: 0, missed: 0 });
    }

    #[test]
    fn duree_ignore_ended_at_ms_client() {
        let s = compute_scoreboard(&input(
            Mode::Words,
            1,
            "the",
            log(&[(100.0, "t", None), (200.0, "h", None), (300.0, "e", None)]),
            999_999.0,
        ));
        assert_eq!(s.duration_ms, 300.0);
    }

    #[test]
    fn duree_aberrante_bornee_anti_dos() {
        let s = compute_scoreboard(&input(
            Mode::Words,
            1,
            "the",
            log(&[(100_000_000.0, "t", None)]),
            100_000_000.0,
        ));
        assert_eq!(s.duration_ms, MAX_DURATION_MS);
        assert!(s.per_second.len() <= 30 * 60 + 1);
    }

    #[test]
    fn log_vide_duree_zero() {
        let s = compute_scoreboard(&input(Mode::Words, 1, "the", vec![], 5000.0));
        assert_eq!(s.duration_ms, 0.0);
        assert!(s.per_second.is_empty());
    }
}
