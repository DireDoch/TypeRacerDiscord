// =============================================================================
//  rate_limit.rs — plafond de requêtes par joueur (issue #151).
//
//  Une seule map pour tous les endpoints : la clé porte le seau (`"quote:1234"`), le
//  plafond est passé par l'appelant. Un compteur de plus ne coûte donc ni champ ni type.
//
//  Le patron (Mutex<HashMap> + horodatage, purge paresseuse) est déjà celui du cache
//  token→player_id de `discord.rs` — même déploiement mono-processus, même durée de vie.
// =============================================================================

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const WINDOW: Duration = Duration::from_secs(60);

/// Plafonds par minute. C'est LA surface à régler : un joueur ne les voit jamais.
///
/// `API` couvre tout ce qui passe par l'extracteur d'identité (runs, historique, replay,
/// analyses, progression) : 2 requêtes/seconde, hors de portée d'un humain qui joue.
pub const API_PER_MIN: u32 = 120;
/// `QUOTE` est plus serré que le reste : chaque appel consomme le quota API-Ninjas, qui
/// est mensuel et partagé par TOUS les joueurs. Une citation se lit en plus de 2 s.
pub const QUOTE_PER_MIN: u32 = 30;
/// `TOKEN` est GLOBAL, pas par joueur : avant l'échange, il n'y a pas encore d'identité.
pub const TOKEN_PER_MIN: u32 = 120;
/// `WS` compte les CONNEXIONS, pas les messages : une partie en ouvre une, un réseau qui
/// vacille quelques-unes de plus.
pub const WS_PER_MIN: u32 = 20;

/// Au-delà de ce nombre d'entrées, on purge les fenêtres expirées au prochain passage.
/// Sans ça, la map garderait une ligne par joueur croisé depuis le démarrage.
const PURGE_ABOVE: usize = 4_096;

pub struct RateLimiter {
    counts: Mutex<HashMap<String, (u32, Instant)>>,
}

impl RateLimiter {
    pub fn new() -> RateLimiter {
        RateLimiter { counts: Mutex::new(HashMap::new()) }
    }

    /// `false` = budget dépassé, l'appelant renvoie 429.
    pub fn allow(&self, bucket: &str, key: &str, max: u32) -> bool {
        self.allow_at(bucket, key, max, Instant::now())
    }

    /// Horloge injectée, comme `spawn_watchdog` — c'est ce qui rend la fenêtre testable.
    ///
    /// ponytail: fenêtre FIXE, pas glissante. Un client qui tire son budget à la fin
    /// d'une fenêtre puis au début de la suivante passe 2× le plafond sur une seconde.
    /// Sans importance ici (les plafonds sont larges et bornent le débit soutenu) ; si un
    /// jour ça compte, remplacer le `(u32, Instant)` par une file d'instants.
    fn allow_at(&self, bucket: &str, key: &str, max: u32, now: Instant) -> bool {
        let mut counts = self.counts.lock().unwrap();
        if counts.len() > PURGE_ABOVE {
            counts.retain(|_, (_, started)| now.duration_since(*started) < WINDOW);
        }
        let entry = counts.entry(format!("{bucket}:{key}")).or_insert((0, now));
        if now.duration_since(entry.1) >= WINDOW {
            *entry = (0, now); // fenêtre suivante
        }
        entry.0 += 1;
        entry.0 <= max
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_budget_se_consomme_puis_se_recharge_a_la_fenetre_suivante() {
        let rl = RateLimiter::new();
        let t0 = Instant::now();

        assert!(rl.allow_at("api", "alice", 2, t0), "1re requête");
        assert!(rl.allow_at("api", "alice", 2, t0), "2e requête, pile le plafond");
        assert!(!rl.allow_at("api", "alice", 2, t0), "3e requête → 429");

        // Le seau et la clé isolent : le voisin garde son budget entier.
        assert!(rl.allow_at("api", "bob", 2, t0), "autre joueur");
        assert!(rl.allow_at("quote", "alice", 2, t0), "autre endpoint, même joueur");

        // Fenêtre suivante : le compteur repart de zéro.
        let t1 = t0 + WINDOW;
        assert!(rl.allow_at("api", "alice", 2, t1), "budget rechargé");
    }

    #[test]
    fn les_fenetres_expirees_sont_purgees() {
        let rl = RateLimiter::new();
        let t0 = Instant::now();
        for i in 0..=PURGE_ABOVE {
            rl.allow_at("api", &i.to_string(), 1, t0);
        }
        // Un passage APRÈS la fenêtre déclenche la purge : tout est expiré sauf la
        // nouvelle entrée. Sans elle, la map ne redescendrait jamais.
        rl.allow_at("api", "tard", 1, t0 + WINDOW);
        assert_eq!(rl.counts.lock().unwrap().len(), 1);
    }
}
