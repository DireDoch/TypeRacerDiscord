// =============================================================================
//  core/learn.ts — cursus « Apprendre » (CONTEXT.md, terme Lesson).
//
//  Une Lesson = contenu pédagogique + exercice tapable sur un jeu de touches
//  FIXE, généré par le générateur de séquences seedé ci-dessous. Réussir
//  l'exercice au seuil d'accuracy de la tranche courante débloque la suivante.
//  Les exercices ne sont PAS des Runs : jamais de PB, jamais d'historique.
//
//  Cursus complet (issue #8) : rangée de base, rangées haut/bas, majuscules,
//  ponctuation, chiffres, mots complets, fluidité. Contenu en français.
// =============================================================================

import { Rng } from "./text-gen/rng";
import { ENGLISH_WORDS } from "./text-gen/word-list";
import lessons from "../content/lessons.json";

export interface Lesson {
  title: string;
  /** Paragraphes pédagogiques (texte brut, affichés tels quels). */
  content: string[];
  /** Jeu de touches FIXE de l'exercice (caractères simples). */
  keys: string[];
  /** Nombre de jetons de l'exercice. */
  tokens: number;
  /** true : l'exercice tire de VRAIS mots de la word-list (leçons mots/fluidité). */
  words?: boolean;
  /**
   * Référence d'illustration statique (positionnement mains/clavier), réservée
   * aux toutes premières Lessons (ADR 0006). Non consommé avant #29 — inutilisé
   * si absent, aucun effet sur les Lessons existantes.
   */
  diagram?: string;
}

// ----------------------------------------------------------------------------
//  Barème de déblocage — TABLEAU STATIQUE, modifiable ICI SEUL (décision grilling).
//  Une tranche s'applique à partir de la leçon `from` (index 0-based) : les
//  premières leçons sont indulgentes, la vitesse n'est JAMAIS exigée à AUCUNE
//  tranche (ADR 0006) — l'accuracy seule débloque, du début à la fin des 100
//  Lessons. Granularité resserrée (aucune tranche > ~20 leçons) pour une
//  progression cohérente sur tout le cursus, pas seulement les 13 premières.
// ----------------------------------------------------------------------------

const STAGES: { from: number; minAccuracy: number }[] = [
  { from: 0, minAccuracy: 70 }, // leçons 1–5 (découverte)
  { from: 5, minAccuracy: 75 }, // leçons 6–10
  { from: 10, minAccuracy: 80 }, // leçons 11–20
  { from: 20, minAccuracy: 82 }, // leçons 21–35
  { from: 35, minAccuracy: 85 }, // leçons 36–50
  { from: 50, minAccuracy: 87 }, // leçons 51–70
  { from: 70, minAccuracy: 90 }, // leçons 71–90
  { from: 90, minAccuracy: 92 }, // leçons 91–100
];

/** Accuracy (%) requise pour compléter la leçon d'index `lesson` (0-based). */
export function requiredAccuracy(lesson: number): number {
  let acc = STAGES[0].minAccuracy;
  for (const s of STAGES) if (lesson >= s.from) acc = s.minAccuracy;
  return acc;
}

// ----------------------------------------------------------------------------
//  Générateur de séquences — pur et seedé, sur le jeu de touches fixe.
// ----------------------------------------------------------------------------

/**
 * Génère `count` jetons de 3 touches tirées du jeu fixe (« fjf », « asd »…).
 * Déterministe : même (keys, count, seed) ⇒ même exercice.
 */
export function generateLessonText(keys: string[], count: number, rng: Rng): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < count; i++) {
    tokens.push(rng.pick(keys) + rng.pick(keys) + rng.pick(keys));
  }
  return tokens;
}

/**
 * Exercice d'une Lesson : séquences sur touches fixes, ou vrais mots de la
 * word-list pour les leçons `words` (mots complets, fluidité).
 */
export function generateLessonExercise(lesson: Lesson, rng: Rng): string[] {
  if (lesson.words) {
    const tokens: string[] = [];
    for (let i = 0; i < lesson.tokens; i++) tokens.push(rng.pick(ENGLISH_WORDS));
    return tokens;
  }
  return generateLessonText(lesson.keys, lesson.tokens, rng);
}

// ----------------------------------------------------------------------------
//  Contenu du cursus — DONNÉE, pas code (#201).
// ----------------------------------------------------------------------------

/**
 * Les Lessons, dans l'ordre de déblocage. Le contenu vit dans `src/content/lessons.json` :
 * l'ADR 0006 en pose **100**, et à 13 elles occupaient déjà 1 039 des 1 133 lignes de ce
 * module. Écrire une leçon ne touche plus une ligne de code, et le moteur (barème,
 * générateur seedé) reste lisible d'un coup d'œil.
 *
 * Le `as` est le seul point où l'on fait confiance au fichier : `lessons.test.ts` parcourt
 * le cursus ENTIER et vérifie ses invariants, ce que 13 littéraux en dur ne permettaient
 * pas d'écrire. Cette vérification-là vaut pour les 100 à venir sans une ligne de plus.
 */
export const LESSONS: Lesson[] = lessons as Lesson[];
