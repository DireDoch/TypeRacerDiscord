// =============================================================================
//  TypeRacerDiscord — Types de domaine partagés (livrable #2)
//
//  Source de vérité des termes : voir CONTEXT.md à la racine.
//  Ce fichier est le MIROIR TypeScript de `backend/src/domain/types.rs`.
//  Toute modification ici doit être répercutée à l'identique côté Rust.
//
//  Règles de calcul figées (issues du grilling) :
//   - t=0  = 1re frappe en solo, `RaceStart` en multijoueur (pas de décompte en solo —
//            ADR 0004). Horloge monotone.
//   - WPM  = chars corrects à l'ÉTAT FINAL ÷ 5 ÷ minutes (style Monkeytype).
//   - ACC  = frappes correctes ÷ total frappes, PAR FRAPPE. Backspace neutre.
//            Extra (au-delà du mot) = frappe incorrecte.
//   - Curseur libre : le backspace peut rouvrir les mots précédents (pile), avec ou sans erreur.
//   - Génération de texte SEEDÉE et déterministe.
// =============================================================================

// ----------------------------------------------------------------------------
//  Mode / Setting / Config bucket
// ----------------------------------------------------------------------------

/** Le Mode décide quel texte est présenté et quand le Run se termine. Exactement un par Run. */
export type Mode = "time" | "words" | "quotes" | "zen" | "drill";

/** Un Setting est un modificateur de texte cumulable appliqué par-dessus un Mode. */
export type Setting = "punctuation" | "numbers";

/** Langue du texte. MVP : anglais seul. */
export type Language = "english";

/**
 * Configuration d'un Run. La combinaison qui définit le Config bucket
 * (= ce qui rend deux Runs comparables pour un PB).
 */
export interface RunConfig {
  mode: Mode;
  /**
   * Valeur du Mode, normalisée en entier :
   *   - time  : secondes (0 = Time infini). "1h30m" est résolu en secondes AVANT d'arriver ici.
   *   - words : nombre de mots (10 | 25 | 50 | 100, ou custom).
   *   - quotes: 0 (ignoré — la longueur vient de la Quote).
   *   - zen   : 0 (ignoré — pas de texte cible).
   *   - drill : 0 (ignoré — la longueur vient du texte personnalisé).
   */
  modeValue: number;
  language: Language;
  punctuation: boolean;
  numbers: boolean;
}

// ----------------------------------------------------------------------------
//  Keystroke log (matière première du recompute autoritaire)
// ----------------------------------------------------------------------------

/** Touche de contrôle modifiant le buffer. Pas de navigation au curseur en MVP. */
export type ControlKey = "backspace" | "backspace-word";

/**
 * Un événement clavier brut. Format minimal (option A du grilling).
 *  - frappe de caractère : { t, k: "a" }     (espace inclus, k = " ")
 *  - contrôle            : { t, k: "", ctrl: "backspace" }
 * `t` est en millisecondes depuis t=0 (1re frappe en solo, `RaceStart` en Race).
 */
export interface Keystroke {
  t: number;
  /** Caractère imprimable tapé (1 char, espace inclus). Vide "" si touche de contrôle. */
  k: string;
  /** Présent uniquement pour une touche de contrôle ; k vaut alors "". */
  ctrl?: ControlKey;
}

/** Le timeline complet, ordonné par `t` croissant. Envoyé une seule fois, jamais persisté brut. */
export type KeystrokeLog = Keystroke[];

// ----------------------------------------------------------------------------
//  État du Run (machine d'état côté client)
// ----------------------------------------------------------------------------

export type RunPhase =
  | "idle" // écran de config, rien de démarré
  | "running" // le joueur tape (dès la 1re frappe, pas de décompte en solo — ADR 0004) ; le log se remplit
  | "finished"; // terminé ; on attend / affiche le scoreboard autoritaire

export interface RunState {
  phase: RunPhase;
  config: RunConfig;
  /** Graine du générateur. Envoyée au backend pour reproductibilité / Phase 2. */
  seed: number;
  /** Mots cibles générés (vide pour Zen). */
  targetWords: string[];
  /** Pour Quotes uniquement : identifiant renvoyé par GET /api/quote. */
  quoteId?: string;
  /** Valeur de l'horloge monotone (performance.now()) à l'instant t=0. null avant départ. */
  startedAt: number | null;
  /** Log brut accumulé pendant `running`. */
  log: KeystrokeLog;
}

// ----------------------------------------------------------------------------
//  Scoreboard autoritaire (recalculé par Rust)
// ----------------------------------------------------------------------------

/**
 * Décompte final des caractères.
 *  - correct / incorrect : PAR FRAPPE (une faute corrigée compte ; Extra ⊂ incorrect).
 *  - extra / missed       : à l'ÉTAT FINAL.
 */
export interface CharacterBreakdown {
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
}

/** Un point de la série par seconde (rempli dans la colonne `per_second` de la DB). */
export interface PerSecondPoint {
  /** Secondes écoulées depuis t=0. Entier pour les points réguliers ; le dernier point porte la durée exacte. */
  t: number;
  /** WPM cumulatif depuis le départ, évalué à l'instant t. */
  wpm: number;
  /** Raw cumulatif depuis le départ, évalué à l'instant t. */
  raw: number;
  /** Erreurs LOCALES à la fenêtre [t-1, t) (points rouges, axe Y droit). */
  errors: number;
  /** Burst : WPM du mot le plus rapide complété dans [t-1, t) ; report de la valeur précédente sinon. */
  burst: number;
}

/** Les chiffres de record, produits exclusivement par le recompute Rust. */
export interface Scoreboard {
  /** Net : chars corrects (état final) ÷ 5 ÷ minutes. */
  wpm: number;
  /** Gross : tous les chars imprimables ÷ 5 ÷ minutes. */
  raw: number;
  /** Pourcentage 0–100 (frappes correctes ÷ total frappes). */
  accuracy: number;
  characters: CharacterBreakdown;
  /** Durée du Run depuis t=0, en ms (= modeValue pour Time fini ; instant de complétion pour Words/Quotes ; Shift+Enter pour Zen/infini). */
  durationMs: number;
  perSecond: PerSecondPoint[];
  /** false pour Zen et Time infini (durée variable → exclus des PB). */
  pbEligible: boolean;
}

// ----------------------------------------------------------------------------
//  Quote
// ----------------------------------------------------------------------------

export interface Quote {
  /** Identifiant opaque ré-échoié dans POST /api/runs (vérif Phase 2). */
  id: string;
  text: string;
  author: string;
  /** Lien "en savoir plus" vers la page Wikipedia de l'auteur. */
  wikipediaUrl: string;
}

// ----------------------------------------------------------------------------
//  DTOs HTTP (voir docs/API.md pour le contrat complet — livrable #3)
// ----------------------------------------------------------------------------

/** GET /token — corps de requête (code OAuth fourni par l'Embedded App SDK). */
export interface TokenRequest {
  code: string;
}
/** GET /token — réponse. */
export interface TokenResponse {
  access_token: string;
}

/** POST /api/runs — corps de requête. Identité via header Authorization (voir docs/API.md). */
export interface SubmitRunRequest {
  config: RunConfig;
  seed: number;
  /** Texte cible complet reconstruit (mots joints par espaces). "" pour Zen. */
  targetText: string;
  /** Présent pour le Mode quotes uniquement. */
  quoteId?: string;
  keystrokes: KeystrokeLog;
  /**
   * Instant de fin du Run, en ms depuis t=0 (indicatif). Le serveur NE LUI FAIT PAS
   * CONFIANCE pour la durée autoritaire : falsifiable, il l'ignore. Pour Time fini la
   * durée = modeValue ; sinon elle est dérivée du dernier timestamp du log de frappes
   * (source faisant foi), bornée pour éviter un Run "aberrant".
   */
  endedAtMs: number;
}

/** POST /api/runs — réponse (scoreboard autoritaire + verdict PB). */
export interface SubmitRunResponse {
  runId: string;
  scoreboard: Scoreboard;
  /** true si ce Run établit un nouveau PB pour son bucket (false si non éligible ou non battu). */
  isPersonalBest: boolean;
  /** Meilleur WPM précédent du bucket, ou null s'il n'y en avait pas. */
  previousPbWpm: number | null;
}

/** GET /api/history — un Run passé (perSecond inclus pour permettre de re-tracer le graphe). */
export interface HistoryEntry {
  runId: string;
  /** epoch-ms. */
  createdAt: number;
  /** Provenance du Run — les Races : historique seulement, jamais PB. */
  kind: "practice" | "race";
  config: RunConfig;
  wpm: number;
  raw: number;
  accuracy: number;
  characters: CharacterBreakdown;
  durationMs: number;
  perSecond: PerSecondPoint[];
  pbEligible: boolean;
  /** true si le Run peut être rejoué : keystroke log ET texte cible en base
   *  (les Runs d'avant les migrations 0002/0003 ne le peuvent pas — ADR 0001). */
  replayable: boolean;
}

/** GET /api/history — réponse. */
export interface HistoryResponse {
  entries: HistoryEntry[];
}

/** Un Weak spot : touche, bigramme ou trigramme plus lent/fautif que la moyenne DU JOUEUR. */
export interface WeakSpot {
  /** Caractère(s) cible(s) : 1 char pour une touche, 2 pour un bigramme, 3 pour un trigramme. */
  chars: string;
  kind: "key" | "bigram" | "trigram";
  occurrences: number;
  meanDelayMs: number;
  /** 0..1 (fautes / frappes sur cette cible). */
  errorRate: number;
  slow: boolean;
  faulty: boolean;
  /** Tri décroissant fait côté serveur. */
  severity: number;
}

/** GET /api/runs/:id/analysis — Weak spots d'un Run (moteur 1..N logs). */
export interface AnalysisResponse {
  weakSpots: WeakSpot[];
  globalMeanDelayMs: number;
  /** 0..1. */
  globalErrorRate: number;
  runsAnalyzed: number;
}

/**
 * GET/POST /api/learn/progress — progression du cursus « Apprendre ».
 * `completed` = nombre de leçons complétées (le serveur garde le MAX, jamais de recul).
 */
export interface LearnProgress {
  completed: number;
}

/** GET /api/runs/:id — un Run complet pour le Replay (log + texte cible). */
export interface RunDetailResponse {
  runId: string;
  config: RunConfig;
  /** Texte cible verbatim ("" pour Zen). */
  targetText: string;
  keystrokes: KeystrokeLog;
}
