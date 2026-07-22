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
  {
    title: "Rangée de base — complète (G et H)",
    content: [
      "G et H sont au centre de la rangée de base : ce sont les index qui s'étirent pour les atteindre — l'index gauche (depuis F) pour G, l'index droit (depuis J) pour H.",
      "Après l'étirement, l'index REVIENT immédiatement sur sa touche repère. C'est ce retour systématique qui garde toute la main en place.",
      "Cet exercice mélange les huit doigts et les deux étirements : toute la rangée de base, sans regarder.",
    ],
    keys: ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";"],
    tokens: 18,
  },
  {
    title: "Rangée du haut — main gauche (Q W E R T)",
    content: [
      "La rangée du haut se joue en montant depuis la rangée de base, sans déplacer la main : auriculaire vers Q, annulaire vers W, majeur vers E, index vers R puis T (étirement).",
      "Le doigt monte, frappe, et REDESCEND sur sa touche de base. Si ta main entière bouge, tu perds tes repères.",
      "L'exercice mélange la rangée du haut gauche et la rangée de base gauche pour ancrer les allers-retours.",
    ],
    keys: ["q", "w", "e", "r", "t", "a", "s", "d", "f"],
    tokens: 18,
  },
  {
    title: "Rangée du haut — main droite (Y U I O P)",
    content: [
      "Main droite, même principe : index vers Y (étirement) et U, majeur vers I, annulaire vers O, auriculaire vers P.",
      "Y est l'étirement le plus difficile — l'index part de J, frappe Y et revient. Prends ton temps.",
      "L'exercice mélange la rangée du haut droite et la rangée de base droite.",
    ],
    keys: ["y", "u", "i", "o", "p", "j", "k", "l"],
    tokens: 18,
  },
  {
    title: "Rangée du bas — main gauche (Z X C V B)",
    content: [
      "La rangée du bas se joue en descendant : auriculaire vers Z, annulaire vers X, majeur vers C, index vers V puis B (étirement).",
      "La descente est moins naturelle que la montée — le poignet reste souple, seul le doigt plonge et remonte.",
      "L'exercice mélange la rangée du bas gauche et la rangée de base gauche.",
    ],
    keys: ["z", "x", "c", "v", "b", "a", "s", "d", "f"],
    tokens: 18,
  },
  {
    title: "Rangée du bas — main droite (N M , .)",
    content: [
      "Main droite : index vers N et M, majeur vers la virgule (,), annulaire vers le point (.).",
      "La virgule et le point sont des touches à part entière, frappées sans regarder — elles reviendront partout dès qu'on tape de vraies phrases.",
      "L'exercice mélange la rangée du bas droite et la rangée de base droite.",
    ],
    keys: ["n", "m", ",", ".", "j", "k", "l"],
    tokens: 18,
  },
  {
    title: "Mots complets",
    content: [
      "Toutes les lettres sont en place : on passe aux vrais mots. Un mot se tape comme une suite de frappes régulières, pas comme un sprint.",
      "Le rythme compte plus que la vitesse : mieux vaut un tempo lent et constant que des à-coups rapides.",
      "L'espace se frappe au pouce, sans quitter la rangée de base. Les yeux restent sur l'écran, toujours.",
    ],
    keys: [],
    tokens: 20,
    words: true,
  },
  {
    title: "Majuscules (Shift)",
    content: [
      "Une majuscule se tape avec DEUX mains : la lettre avec sa main habituelle, Shift avec l'AURICULAIRE DE L'AUTRE MAIN. « A » = Shift droit + A main gauche.",
      "On ne verrouille jamais les majuscules avec Caps Lock pour une seule lettre — c'est le petit doigt opposé qui fait le travail.",
      "L'exercice alterne minuscules et majuscules sur des touches déjà connues.",
    ],
    keys: ["a", "s", "d", "f", "j", "k", "l", "A", "S", "D", "F", "J", "K", "L"],
    tokens: 15,
  },
  {
    title: "Ponctuation",
    content: [
      "La ponctuation s'intègre au flux de frappe : virgule (majeur droit), point (annulaire droit), et les signes en Shift comme ? et ! suivent la règle des majuscules (Shift opposé).",
      "L'apostrophe (') se frappe à l'auriculaire droit, juste à côté du point-virgule.",
      "L'exercice mélange lettres et signes pour que la ponctuation ne casse plus ton rythme.",
    ],
    keys: [",", ".", "?", "!", "'", "a", "s", "d", "f", "j", "k", "l"],
    tokens: 15,
  },
  {
    title: "Chiffres (rangée du haut)",
    content: [
      "La rangée des chiffres se joue depuis la rangée de base, en grand étirement : 1-2 à l'auriculaire gauche, 3 à l'annulaire, 4-5 à l'index gauche ; 6-7 à l'index droit, 8 au majeur, 9 à l'annulaire, 0 à l'auriculaire droit.",
      "C'est la rangée la plus éloignée : la main a tendance à se perdre. Frappe le chiffre, puis REVIENS toucher tes repères F et J avant la frappe suivante.",
      "Va très lentement — presque personne ne tape les chiffres sans regarder ; toi, si.",
    ],
    keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    tokens: 15,
  },
  {
    title: "Fluidité",
    content: [
      "Dernière étape : enchaîner de vrais mots sans t'arrêter. La fluidité vient d'un tempo régulier — chaque frappe au même intervalle, espace compris.",
      "Ne corrige pas chaque erreur par réflexe : garde le rythme, la précision est déjà dans tes doigts.",
      "Après cette leçon, le cursus est terminé : place aux Runs (Solo) — et au Mode drill pour travailler tes points faibles.",
    ],
    keys: [],
    tokens: 30,
    words: true,
  },
];
