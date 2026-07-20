// =============================================================================
//  domain/analysis.rs — moteur Weak spot (CONTEXT.md).
//
//  À partir de 1..N couples (texte cible, keystroke log), identifie les touches
//  et paires de touches (bigrammes intra-mot) où le joueur est plus lent ou plus
//  fautif que SA PROPRE moyenne (seuils relatifs — décision de grilling), avec un
//  minimum d'occurrences pour éviter le bruit. Même fonction pour « cette course »
//  (1 log) et pour le profil (N logs) — zéro duplication.
//
//  Attribution : on rejoue le log dans le même modèle de curseur libre que
//  FreeInput/replay.rs (pile de mots + buffer plafonné) ; chaque frappe imprimable
//  dont la position tombe dans le mot cible est attribuée au caractère ATTENDU à
//  cette position (une faute sur « e » compte contre « e », pas contre la touche
//  tapée par accident). Zen (pas de cible) ne produit rien.
// =============================================================================

use std::collections::HashMap;

use crate::domain::types::{AnalysisResponse, ControlKey, Keystroke, WeakSpot};

/// Seuils (constantes ajustables — voir l'issue #3).
const MIN_OCCURRENCES: i64 = 10; // en-dessous : bruit, jamais un Weak spot
const SLOW_FACTOR: f64 = 1.5; // lent = délai moyen ≥ 1,5× SA moyenne globale
const FAULTY_FACTOR: f64 = 2.0; // fautif = taux d'erreur ≥ 2× SON taux global…
const FAULTY_FLOOR: f64 = 0.05; // …et jamais sous 5 % (un très bon joueur n'est pas « faible » à 1 %)
const MAX_DELAY_MS: f64 = 3000.0; // pause (réflexion, distraction) : exclue des délais

#[derive(Default)]
struct KeyStat {
    count: i64,
    errors: i64,
    delay_sum: f64,
    delay_count: i64,
}

/// Analyse 1..N Runs. `runs` = (texte cible, keystrokes) — un Run Zen (cible vide)
/// est ignoré sans erreur.
pub fn analyze(runs: &[(&str, &[Keystroke])]) -> AnalysisResponse {
    let mut keys: HashMap<String, KeyStat> = HashMap::new();
    let mut bigrams: HashMap<String, KeyStat> = HashMap::new();
    let mut runs_analyzed = 0i64;

    for (target_text, log) in runs {
        if target_text.is_empty() || log.is_empty() {
            continue;
        }
        runs_analyzed += 1;
        collect(target_text, log, &mut keys, &mut bigrams);
    }

    // Moyennes globales du joueur (sur les touches — les bigrammes en dérivent).
    let (mut delay_sum, mut delay_count, mut errors, mut count) = (0.0, 0i64, 0i64, 0i64);
    for s in keys.values() {
        delay_sum += s.delay_sum;
        delay_count += s.delay_count;
        errors += s.errors;
        count += s.count;
    }
    let global_mean_delay_ms = if delay_count > 0 { delay_sum / delay_count as f64 } else { 0.0 };
    let global_error_rate = if count > 0 { errors as f64 / count as f64 } else { 0.0 };

    let mut weak_spots: Vec<WeakSpot> = Vec::new();
    for (kind, map) in [("key", &keys), ("bigram", &bigrams)] {
        for (chars, s) in map {
            if s.count < MIN_OCCURRENCES {
                continue;
            }
            let mean_delay_ms = if s.delay_count > 0 { s.delay_sum / s.delay_count as f64 } else { 0.0 };
            let error_rate = s.errors as f64 / s.count as f64;
            let slow = global_mean_delay_ms > 0.0 && mean_delay_ms >= SLOW_FACTOR * global_mean_delay_ms;
            let faulty = error_rate >= (FAULTY_FACTOR * global_error_rate).max(FAULTY_FLOOR);
            if !slow && !faulty {
                continue;
            }
            // Sévérité : excès de lenteur (ratio) + excès d'erreurs (points de %,
            // pondérés fort — une faute coûte plus qu'un ralentissement).
            let slow_excess = if global_mean_delay_ms > 0.0 {
                (mean_delay_ms / global_mean_delay_ms - 1.0).max(0.0)
            } else {
                0.0
            };
            let severity = slow_excess + (error_rate - global_error_rate).max(0.0) * 10.0;
            weak_spots.push(WeakSpot {
                chars: chars.clone(),
                kind: kind.to_string(),
                occurrences: s.count,
                mean_delay_ms: round1(mean_delay_ms),
                error_rate: round3(error_rate),
                slow,
                faulty,
                severity: round3(severity),
            });
        }
    }
    weak_spots.sort_by(|a, b| b.severity.total_cmp(&a.severity));

    AnalysisResponse {
        weak_spots,
        global_mean_delay_ms: round1(global_mean_delay_ms),
        global_error_rate: round3(global_error_rate),
        runs_analyzed,
    }
}

/// Rejoue UN log (modèle FreeInput : pile + buffer plafonné) et accumule les stats.
fn collect(
    target_text: &str,
    log: &[Keystroke],
    keys: &mut HashMap<String, KeyStat>,
    bigrams: &mut HashMap<String, KeyStat>,
) {
    let target: Vec<Vec<char>> = target_text.split(' ').map(|w| w.chars().collect()).collect();
    let mut locked: Vec<String> = Vec::new();
    let mut typed = String::new();
    let mut prev_t: Option<f64> = None;
    // Caractère cible de la frappe imprimable PRÉCÉDENTE, si adjacente (bigramme
    // intra-mot : cassé par espace, backspace ou Extra).
    let mut prev_expected: Option<char> = None;

    for k in log {
        let delay = prev_t.map(|p| k.t - p);
        prev_t = Some(k.t);

        match k.ctrl {
            Some(ControlKey::BackspaceWord) => {
                if typed.is_empty() {
                    locked.pop();
                }
                typed.clear();
                prev_expected = None;
                continue;
            }
            Some(ControlKey::Backspace) => {
                if typed.pop().is_none() {
                    if let Some(w) = locked.pop() {
                        typed = w; // rouvre le mot précédent (curseur libre)
                    }
                }
                prev_expected = None;
                continue;
            }
            None => {}
        }

        if k.k == " " {
            // FreeInput ne journalise l'espace que s'il verrouille (buffer non vide).
            locked.push(std::mem::take(&mut typed));
            prev_expected = None;
            continue;
        }

        let Some(typed_ch) = k.k.chars().next() else { continue };
        let word = target.get(locked.len());
        let pos = typed.chars().count();
        let expected = word.and_then(|w| w.get(pos).copied());

        // Plafond du buffer de FreeInput : len + max(4, len). Au-delà, la frappe
        // est journalisée mais n'entre pas dans le buffer.
        let cap = word.map_or(usize::MAX, |w| w.len() + w.len().max(4));
        if pos < cap {
            typed.push(typed_ch);
        }

        let Some(expected) = expected else {
            prev_expected = None; // Extra : pas de caractère cible
            continue;
        };

        let is_error = typed_ch != expected;
        let good_delay = delay.filter(|d| *d >= 0.0 && *d <= MAX_DELAY_MS);
        bump(keys, expected.to_string(), is_error, good_delay);
        if let Some(pe) = prev_expected {
            bump(bigrams, format!("{pe}{expected}"), is_error, good_delay);
        }
        prev_expected = Some(expected);
    }
}

fn bump(map: &mut HashMap<String, KeyStat>, chars: String, is_error: bool, delay: Option<f64>) {
    let s = map.entry(chars).or_default();
    s.count += 1;
    if is_error {
        s.errors += 1;
    }
    if let Some(d) = delay {
        s.delay_sum += d;
        s.delay_count += 1;
    }
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}
fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

// ============================================================================
//  Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Log synthétique : tape `s` parfaitement, un caractère toutes les `step` ms,
    /// sauf les caractères présents dans `slow_on` qui prennent `slow_ms`.
    fn perfect_log(s: &str, step: f64, slow_on: &str, slow_ms: f64) -> Vec<Keystroke> {
        let mut t = 0.0;
        s.chars()
            .map(|c| {
                t += if slow_on.contains(c) { slow_ms } else { step };
                Keystroke { t, k: c.to_string(), ctrl: None }
            })
            .collect()
    }

    #[test]
    fn touche_lente_detectee() {
        // 12 mots « tache » : le h est 4× plus lent que le reste.
        let text = vec!["tache"; 12].join(" ");
        let log = perfect_log(&text, 100.0, "h", 400.0);
        let res = analyze(&[(text.as_str(), log.as_slice())]);

        let h = res.weak_spots.iter().find(|w| w.chars == "h" && w.kind == "key").expect("h absent");
        assert!(h.slow, "h devrait être lent");
        assert!(!h.faulty);
        // Le bigramme « ch » (délai du h) doit ressortir aussi.
        assert!(res.weak_spots.iter().any(|w| w.chars == "ch" && w.kind == "bigram" && w.slow));
        // Une touche régulière (a) n'est pas un Weak spot.
        assert!(!res.weak_spots.iter().any(|w| w.chars == "a"));
    }

    #[test]
    fn touche_fautive_detectee_faute_attribuee_a_la_cible() {
        // 12 mots « the » : sur e on tape d'abord x (faute), backspace, puis e.
        let mut log: Vec<Keystroke> = Vec::new();
        let mut t = 0.0;
        let mut push = |k: &str, ctrl: Option<ControlKey>, t: &mut f64| {
            *t += 100.0;
            log.push(Keystroke { t: *t, k: k.to_string(), ctrl });
        };
        for i in 0..12 {
            push("t", None, &mut t);
            push("h", None, &mut t);
            push("x", None, &mut t); // faute À LA POSITION du e → contre « e »
            push("", Some(ControlKey::Backspace), &mut t);
            push("e", None, &mut t);
            if i < 11 {
                push(" ", None, &mut t);
            }
        }
        let text = vec!["the"; 12].join(" ");
        let res = analyze(&[(text.as_str(), log.as_slice())]);

        let e = res.weak_spots.iter().find(|w| w.chars == "e" && w.kind == "key").expect("e absent");
        assert!(e.faulty, "e devrait être fautif (12 fautes / 24 frappes)");
        assert!(!res.weak_spots.iter().any(|w| w.chars == "t" && w.faulty));
    }

    #[test]
    fn trop_rare_ignore_et_agregation_multi_runs() {
        // 6 occurrences par run : sous le minimum sur 1 run, détecté sur 2 runs.
        let text = vec!["tache"; 6].join(" ");
        let log = perfect_log(&text, 100.0, "h", 400.0);
        let un_seul = analyze(&[(text.as_str(), log.as_slice())]);
        assert!(un_seul.weak_spots.iter().all(|w| w.chars != "h"), "6 occurrences : bruit");

        let deux = analyze(&[(text.as_str(), log.as_slice()), (text.as_str(), log.as_slice())]);
        assert!(deux.weak_spots.iter().any(|w| w.chars == "h" && w.slow));
        assert_eq!(deux.runs_analyzed, 2);
    }

    #[test]
    fn zen_et_log_vide_ignores() {
        let res = analyze(&[("", &[]), ("the cat", &[])]);
        assert_eq!(res.runs_analyzed, 0);
        assert!(res.weak_spots.is_empty());
    }
}
