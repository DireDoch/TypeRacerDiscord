// Domaine pur, autoritaire. Miroir Rust de `frontend/src/core/`.
//  - types.rs  ↔ core/types.ts
//  - replay.rs ↔ core/stats/scoreboard.ts (recompute autoritaire)
// Le port de la génération de texte (core/text-gen/) est différé en Phase 2
// (en MVP le client envoie `targetText`, le serveur recompute dessus).

pub mod replay;
pub mod types;
