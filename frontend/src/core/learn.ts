// =============================================================================
//  core/learn.ts — cursus « Apprendre » (CONTEXT.md, terme Lesson).
//
//  Une Lesson = contenu pédagogique + exercice tapable sur un jeu de touches
//  FIXE, généré par le générateur de séquences seedé ci-dessous. Réussir
//  l'exercice au seuil d'accuracy de la tranche courante débloque la suivante.
//  Les exercices ne sont PAS des Runs : jamais de PB, jamais d'historique.
//
//  Socle (issue #4) : 3 leçons réelles ; le reste du cursus vient avec l'issue #8.
// =============================================================================

import { Rng } from "./text-gen/rng";

export interface Lesson {
  title: string;
  /** Paragraphes pédagogiques (texte brut, affichés tels quels). */
  content: string[];
  /** Jeu de touches FIXE de l'exercice (caractères simples). */
  keys: string[];
  /** Nombre de jetons de l'exercice. */
  tokens: number;
}

// ----------------------------------------------------------------------------
//  Barème de déblocage — TABLEAU STATIQUE, modifiable ICI SEUL (décision grilling).
//  Une tranche s'applique à partir de la leçon `from` (index 0-based) : les
//  premières leçons sont indulgentes, la vitesse n'est JAMAIS exigée en début
//  de cursus (l'accuracy seule débloque).
// ----------------------------------------------------------------------------

const STAGES: { from: number; minAccuracy: number }[] = [
  { from: 0, minAccuracy: 70 }, // leçons 1–10 : ≥ 70 %
  { from: 10, minAccuracy: 80 }, // leçons 11–20 : ≥ 80 %
  { from: 20, minAccuracy: 90 }, // leçons 21+  : ≥ 90 %
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

// ----------------------------------------------------------------------------
//  Contenu du cursus (français). Ordre = ordre de déblocage.
// ----------------------------------------------------------------------------

export const LESSONS: Lesson[] = [
  {
    title: "Posture et touches repères (F et J)",
    content: [
      "Assieds-toi droit, les deux pieds au sol, les avant-bras à l'horizontale et les poignets souples, sans s'appuyer sur le bureau.",
      "Pose tes index sur F et J : ce sont les touches repères — sens les petites bosses sous tes doigts. Les autres doigts se posent naturellement sur les touches voisines.",
      "Règle d'or : ne regarde JAMAIS le clavier. Tes index retrouvent F et J au toucher, tout le reste se place autour. L'exercice n'utilise que F, J et l'espace (pouce).",
    ],
    keys: ["f", "j"],
    tokens: 12,
  },
  {
    title: "Rangée de base — main gauche (A S D F)",
    content: [
      "La rangée de base est ta position de repos : chaque doigt a sa touche et y REVIENT après chaque frappe.",
      "Main gauche : auriculaire sur A, annulaire sur S, majeur sur D, index sur F. Chaque touche est frappée par SON doigt, jamais un autre.",
      "Va lentement : la précision d'abord, la vitesse viendra seule. Les yeux restent sur l'écran.",
    ],
    keys: ["a", "s", "d", "f"],
    tokens: 15,
  },
  {
    title: "Rangée de base — main droite (J K L ;)",
    content: [
      "Main droite : index sur J, majeur sur K, annulaire sur L, auriculaire sur le point-virgule (;).",
      "Le point-virgule est une touche comme une autre : c'est l'auriculaire droit qui la frappe, sans regarder.",
      "Après chaque frappe, le doigt revient sur sa touche de repos. Si tu te perds, retrouve J au toucher (la bosse) et repars.",
    ],
    keys: ["j", "k", "l", ";"],
    tokens: 15,
  },
];
