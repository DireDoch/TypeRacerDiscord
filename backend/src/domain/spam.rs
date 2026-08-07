// =============================================================================
//  domain/spam.rs — comptage des répétitions du Mode de jeu Spam (ADR 0016).
//
//  Une « répétition correcte » est un mot VERROUILLÉ égal au mot cible. Le compte se
//  RELIT de la pile `locked` rejouée depuis le log à chaque appel — ce n'est JAMAIS un
//  compteur incrémenté à part, qui pourrait diverger du buffer réel. C'est exactement ce
//  qui fait marcher Backspace au milieu d'une répétition sans une ligne de code de plus :
//  rouvrir un mot verrouillé le sort de la pile, donc du compte, sans qu'on ait à
//  l'annuler quelque part.
//
//  La mécanique de pile (~20 l.) est volontairement dupliquée de `replay.rs` et
//  `difficulty.rs`, comme `replay_zen` l'est déjà : la factoriser forcerait à toucher
//  l'algo autoritaire testé, et une copie locale vaut mieux qu'une parité fragile.
// =============================================================================

use crate::domain::types::{ControlKey, Keystroke};

/// Ce qu'un log vaut sous Spam.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SpamCount {
    /// Répétitions correctes VERROUILLÉES. C'est la grandeur qui décide de la victoire,
    /// et celle que le podium affiche en gros à la place du Gap (ADR 0016).
    pub reps: u32,
    /// Caractères corrects déjà tapés dans la répétition EN COURS, jamais verrouillée.
    ///
    /// C'est le départage à l'expiration du plafond de temps (ADR 0016) : un Player en
    /// train de taper une répétition correcte au moment du clap ne doit pas être classé à
    /// égalité avec un Player resté sur un buffer vide. Ne compte jamais comme une
    /// répétition — seul un mot verrouillé en est une.
    pub partial: u32,
}

/// Plafond du buffer d'un mot, repris tel quel de `replay.rs::max_buffer` : le log vient
/// du client, et sans borne un mot « tapé » de 10 Mo ferait grossir la comparaison.
fn max_buffer(word: &str) -> usize {
    let n = word.chars().count();
    n + n.max(4)
}

/// Nombre de caractères corrects en tête de `typed` par rapport à `word`.
fn correct_prefix(typed: &str, word: &str) -> u32 {
    typed.chars().zip(word.chars()).take_while(|(a, b)| a == b).count() as u32
}

/// Rejoue un log de frappes contre le mot cible répété et en tire le compte de Spam.
///
/// Pure. Le texte cible n'a pas à être reconstruit : chaque position vaut le même mot,
/// donc « le mot verrouillé à l'index i est-il correct ? » se réduit à « vaut-il `word` ? ».
pub fn count_reps(word: &str, keys: &[Keystroke]) -> SpamCount {
    let mut locked: Vec<String> = Vec::new();
    let mut typed = String::new();

    for k in keys {
        match k.ctrl {
            // Ctrl+Backspace : vide le buffer, ou SUPPRIME entièrement le mot précédent
            // (il ne redevient pas éditable, contrairement au Backspace simple).
            Some(ControlKey::BackspaceWord) => {
                if typed.is_empty() {
                    locked.pop();
                }
                typed.clear();
            }
            // Backspace : efface un caractère, ou — buffer vide — ROUVRE le dernier mot
            // verrouillé. La répétition est alors annulée tant qu'elle n'est pas
            // re-verrouillée, et le compte le reflète sans code supplémentaire.
            Some(ControlKey::Backspace) => {
                if typed.is_empty() {
                    typed = locked.pop().unwrap_or_default();
                } else {
                    typed.pop();
                }
            }
            None if k.k == " " => {
                // Espace en tête / double espace : ignoré, comme partout ailleurs.
                if !typed.is_empty() {
                    locked.push(std::mem::take(&mut typed));
                }
            }
            None if k.k.chars().count() == 1 => {
                if typed.chars().count() < max_buffer(word) {
                    typed.push_str(&k.k);
                }
            }
            None => {}
        }
    }

    SpamCount {
        reps: locked.iter().filter(|w| w.as_str() == word).count() as u32,
        partial: correct_prefix(&typed, word),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tape `text` caractère par caractère (l'espace verrouille), t croissant.
    fn keys(text: &str) -> Vec<Keystroke> {
        text.chars()
            .enumerate()
            .map(|(i, c)| Keystroke { t: i as f64, k: c.to_string(), ctrl: None })
            .collect()
    }

    fn back(t: f64) -> Keystroke {
        Keystroke { t, k: String::new(), ctrl: Some(ControlKey::Backspace) }
    }

    fn back_word(t: f64) -> Keystroke {
        Keystroke { t, k: String::new(), ctrl: Some(ControlKey::BackspaceWord) }
    }

    #[test]
    fn compte_les_repetitions_verrouillees() {
        assert_eq!(count_reps("go", &keys("go go go ")).reps, 3);
    }

    #[test]
    fn la_repetition_en_cours_ne_compte_pas_encore() {
        // Deux verrouillées + « go » tapé sans espace derrière : toujours 2.
        let c = count_reps("go", &keys("go go go"));
        assert_eq!(c.reps, 2);
        assert_eq!(c.partial, 2);
    }

    #[test]
    fn un_mot_faux_verrouille_n_est_pas_une_repetition() {
        assert_eq!(count_reps("go", &keys("go ga go ")).reps, 2);
    }

    #[test]
    fn backspace_en_buffer_vide_annule_la_derniere_repetition() {
        // « go go » puis Backspace : le 2e mot est rouvert, il n'est plus verrouillé.
        let mut k = keys("go go ");
        k.push(back(100.0));
        let c = count_reps("go", &k);
        assert_eq!(c.reps, 1);
        assert_eq!(c.partial, 2); // le mot rouvert est redevenu le buffer courant
    }

    #[test]
    fn une_repetition_rouverte_puis_re_verrouillee_recompte() {
        let mut k = keys("go go ");
        k.push(back(100.0));
        k.push(Keystroke { t: 101.0, k: " ".to_string(), ctrl: None });
        assert_eq!(count_reps("go", &k).reps, 2);
    }

    #[test]
    fn ctrl_backspace_supprime_la_repetition_sans_la_rouvrir() {
        let mut k = keys("go go ");
        k.push(back_word(100.0));
        let c = count_reps("go", &k);
        assert_eq!(c.reps, 1);
        assert_eq!(c.partial, 0); // supprimé, pas rouvert : rien dans le buffer
    }

    #[test]
    fn corriger_une_faute_au_milieu_d_une_repetition_la_rend_valide() {
        // « ga », deux Backspace, « o », espace → une répétition correcte.
        let mut k = keys("ga");
        k.push(back(10.0));
        k.push(Keystroke { t: 11.0, k: "o".to_string(), ctrl: None });
        k.push(Keystroke { t: 12.0, k: " ".to_string(), ctrl: None });
        assert_eq!(count_reps("go", &k).reps, 1);
    }

    #[test]
    fn le_prefixe_partiel_s_arrete_a_la_premiere_faute() {
        assert_eq!(count_reps("spam", &keys("spxm")).partial, 2);
        assert_eq!(count_reps("spam", &keys("xpam")).partial, 0);
    }

    #[test]
    fn un_log_vide_ne_vaut_rien() {
        assert_eq!(count_reps("go", &[]), SpamCount { reps: 0, partial: 0 });
    }

    #[test]
    fn le_buffer_est_plafonne_comme_dans_le_recompute() {
        // 100 « x » sur un mot de 2 : le buffer s'arrête au plafond, rien ne diverge.
        let c = count_reps("go", &keys(&"x".repeat(100)));
        assert_eq!(c, SpamCount { reps: 0, partial: 0 });
    }
}
