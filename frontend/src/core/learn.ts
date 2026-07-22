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
      "Tout le clavier est maintenant vu une première fois. La suite du cursus consolide : rangées enchaînées, paires de lettres fréquentes, ponctuation et symboles pas encore couverts, puis des mots et phrases plus longs.",
    ],
    keys: [],
    tokens: 30,
    words: true,
  },
  {
    title: "Rangée du haut — fluidité (Q W E R T Y U I O P)",
    content: [
      "Les leçons 5 et 6 t'ont fait monter puis REdescendre après chaque touche. Ici, tu enchaînes plusieurs touches du haut À LA SUITE, sans repasser par la base entre deux.",
      "La main reste momentanément en position haute ; le retour à la rangée de base se fait à la fin de la séquence, pas frappe par frappe. C'est ce relâchement qui donne de la fluidité.",
      "Exercice sur toute la rangée du haut, les deux mains mélangées.",
    ],
    keys: ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    tokens: 20,
  },
  {
    title: "Rangée du bas — fluidité (Z X C V B N M)",
    content: [
      "Même principe que la rangée du haut, en sens inverse : plusieurs touches basses enchaînées avant de remonter à la base.",
      "La rangée du bas est la moins naturelle des trois — cette fluidité se construit sur plusieurs leçons, pas en une seule.",
      "Exercice sur toute la rangée du bas, les deux mains mélangées.",
    ],
    keys: ["z", "x", "c", "v", "b", "n", "m"],
    tokens: 20,
  },
  {
    title: "Tout le clavier — lettres mélangées",
    content: [
      "Premier exercice qui mélange VRAIMENT les trois rangées, sans thème particulier : le test qui dit si les 15 leçons précédentes ont pris.",
      "Si une touche te fait hésiter, pas de panique : repère sa rangée et son doigt — tu la retrouveras dans les prochaines leçons ciblées.",
      "Les 26 lettres, réparties au hasard.",
    ],
    keys: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"],
    tokens: 22,
  },
  {
    title: "Paire fréquente — TH / HE",
    content: [
      "« th » et « he » sont parmi les paires de lettres les plus fréquentes de l'anglais — elles reviennent dans « the », « that », « he », « her »… Automatiser ce geste paie sur presque chaque mot.",
      "T (index gauche, rangée du haut) et H (index droit, rangée de base) : un aller-retour entre les deux mains, pas un doigt qui glisse d'une touche à l'autre.",
      "Exercice concentré sur T et H, dans les deux ordres.",
    ],
    keys: ["t", "h"],
    tokens: 18,
  },
  {
    title: "Paire fréquente — IN / ER",
    content: [
      "« in » et « er » ferment énormément de mots anglais (« in », « her », « after », « winter »).",
      "I (majeur droit, rangée du haut) et N (index droit, rangée du bas) restent tous deux à droite — pas de croisement de main ici, juste un changement de rangée.",
      "Exercice concentré sur I, N, E et R.",
    ],
    keys: ["i", "n", "e", "r"],
    tokens: 18,
  },
  {
    title: "Paire fréquente — AN / RE",
    content: [
      "« an » et « re » ouvrent ou ferment des mots très courants (« and », « are », « re- » en préfixe de « return », « repeat »…).",
      "A (auriculaire gauche) et N (index droit) traversent tout le clavier — un vrai croisement de mains, comme TH.",
      "Exercice concentré sur A, N, R et E.",
    ],
    keys: ["a", "n", "r", "e"],
    tokens: 18,
  },
  {
    title: "Paire fréquente — ON / AT",
    content: [
      "« on » et « at » terminent une quantité de mots anglais courts et très fréquents (« on », « at », « that », « button »).",
      "O (annulaire droit) et N (index droit) restent côte à côte sur la rangée du haut puis celle du bas — un petit trajet, à répéter jusqu'à ce qu'il devienne automatique.",
      "Exercice concentré sur O, N, A et T.",
    ],
    keys: ["o", "n", "a", "t"],
    tokens: 18,
  },
  {
    title: "Paire fréquente — EN / ND",
    content: [
      "« en » et « nd » terminent des mots très communs (« when », « and », « friend »).",
      "E (majeur droit) et N (index droit) sont proches ; D (index gauche) demande ensuite un vrai changement de main après le N.",
      "Exercice concentré sur E, N et D.",
    ],
    keys: ["e", "n", "d"],
    tokens: 18,
  },
  {
    title: "Voyelles doublées — OU / EA",
    content: [
      "L'anglais enchaîne souvent deux voyelles qui ne se prononcent qu'une fois : « out », « house », « sea », « read ». Le clavier, lui, veut bien les deux frappes.",
      "O et U sont voisines sur la rangée du haut, à droite ; E et A traversent tout le clavier, comme TH ou AN.",
      "Exercice concentré sur O, U, E et A.",
    ],
    keys: ["o", "u", "e", "a"],
    tokens: 18,
  },
  {
    title: "Lettres doublées (SS LL EE OO TT)",
    content: [
      "« miss », « tell », « see », « look », « better » : la lettre doublée est un motif à part entière, pas deux frappes indépendantes — le même doigt refrappe la même touche.",
      "Un doigt qui vient de frapper une touche doit pouvoir la refrapper aussitôt, sans hésitation ni décalage.",
      "Exercice concentré sur S, L, E, O et T.",
    ],
    keys: ["s", "l", "e", "o", "t"],
    tokens: 18,
  },
  {
    title: "Mots — deuxième lot",
    content: [
      "Retour aux vrais mots (comme la leçon 9), avec plus de jetons : c'est la fluidité sur mots qui progresse maintenant, pas les touches individuelles.",
      "Le rythme reste la priorité : un tempo régulier bat toujours une pointe de vitesse suivie d'une hésitation.",
      "Vingt-quatre mots de la liste standard.",
    ],
    keys: [],
    tokens: 24,
    words: true,
  },
  {
    title: "Majuscules — tout le clavier",
    content: [
      "La leçon 10 t'a fait alterner minuscule/majuscule sur la rangée de base seulement. Ici, la règle (Shift à l'AURICULAIRE OPPOSÉ) s'applique aux 26 lettres.",
      "Le réflexe ne change pas, seule la touche visée change : identifie la main de la lettre, prends Shift de l'AUTRE main.",
      "Exercice sur les 26 lettres, minuscules et majuscules mélangées.",
    ],
    keys: [
      "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    ],
    tokens: 22,
  },
  {
    title: "Parenthèses ( )",
    content: [
      "Les parenthèses s'ouvrent avec Shift + 9 (auriculaire gauche pour Shift, auriculaire gauche pour 9 — les deux mains ne se gênent pas) et se ferment avec Shift + 0.",
      "Elles s'utilisent toujours par paire : ouvrir puis fermer, sans oublier la seconde une fois lancé dans la phrase.",
      "Exercice concentré sur les parenthèses, mélangées à quelques lettres de la rangée de base.",
    ],
    keys: ["(", ")", "a", "s", "d", "f", "j", "k", "l"],
    tokens: 16,
  },
  {
    title: "Guillemets et tiret ( \" - )",
    content: [
      "Le guillemet double (Shift + ') encadre une citation ; le tiret (touche seule, à côté du 0) relie deux mots ou introduit une liste.",
      "Le guillemet partage sa touche avec l'apostrophe déjà vue (leçon 11) — c'est Shift qui fait la différence.",
      "Exercice concentré sur le guillemet et le tiret, mélangés à quelques lettres.",
    ],
    keys: ["\"", "-", "a", "s", "d", "f", "j", "k", "l"],
    tokens: 16,
  },
  {
    title: "Symboles (Shift + chiffres)",
    content: [
      "Chaque chiffre de la leçon 12 cache un symbole en Shift : ! @ # $ % ^ & * — utiles pour les mentions, hashtags, adresses mail, calculs.",
      "Même geste que les majuscules : Shift de l'AUTRE main, chiffre de sa main habituelle. Le point de repère (F/J) reste la base du retour.",
      "Exercice concentré sur les huit symboles de la rangée du haut.",
    ],
    keys: ["!", "@", "#", "$", "%", "^", "&", "*"],
    tokens: 18,
  },
  {
    title: "Chiffres et lettres mélangés",
    content: [
      "Dans un vrai texte, les chiffres n'arrivent jamais seuls : adresses, dates, codes postaux, mots de passe mélangent lettres et chiffres sans prévenir.",
      "Le réflexe à construire : après un chiffre (rangée du haut, grand étirement), revenir directement sur F ou J avant la lettre suivante — pas de raccourci qui saute l'étape.",
      "Exercice qui mélange quelques chiffres et quelques lettres de la rangée de base.",
    ],
    keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "a", "s", "d", "f", "j", "k", "l"],
    tokens: 18,
  },
  {
    title: "Deux-points et point-virgule ( : ; )",
    content: [
      "Le point-virgule (;) est déjà connu depuis la leçon 3 — l'auriculaire droit, sans Shift. Le deux-points est le MÊME doigt, avec Shift.",
      "Les deux annoncent une suite : le point-virgule sépare deux idées liées, le deux-points introduit ce qui suit.",
      "Exercice concentré sur les deux, mélangés à la rangée de base droite.",
    ],
    keys: [":", ";", "j", "k", "l"],
    tokens: 16,
  },
  {
    title: "Slash et underscore ( / _ )",
    content: [
      "Le slash (/) sert aux URLs, aux fractions, aux dates ; l'underscore (Shift + -) relie des mots dans un identifiant (« nom_de_variable »).",
      "Le slash est à l'auriculaire droit, tout en bas du clavier — un étirement à sentir la première fois, puis à automatiser.",
      "Exercice concentré sur les deux, mélangés à quelques lettres.",
    ],
    keys: ["/", "_", "j", "k", "l", ";"],
    tokens: 16,
  },
  {
    title: "Paire fréquente — ES / TI",
    content: [
      "« es » termine les pluriels et les verbes (« goes », « makes ») ; « ti » ouvre des suffixes très courants (« -tion », « -tial »).",
      "E, S, T et I sont tous à portée de la rangée de base ou juste au-dessus — un bon terrain pour construire de la vitesse SANS sacrifier la précision.",
      "Exercice concentré sur E, S, T et I.",
    ],
    keys: ["e", "s", "t", "i"],
    tokens: 18,
  },
  {
    title: "Mots — troisième lot",
    content: [
      "Encore des mots réels, avec davantage de jetons — l'endurance progresse en même temps que la précision.",
      "Si l'accuracy chute vers la fin de l'exercice, c'est un signe de fatigue de concentration, pas de vitesse : ralentis plutôt que de forcer.",
      "Vingt-six mots de la liste standard.",
    ],
    keys: [],
    tokens: 26,
    words: true,
  },
  {
    title: "Consolidation — ponctuation et symboles",
    content: [
      "Revue de tout ce qui a été introduit depuis la leçon 26 : parenthèses, guillemet, tiret, symboles Shift, deux-points, slash, underscore — rien de nouveau, juste du rappel.",
      "C'est la ponctuation et les symboles qui cassent le plus souvent le rythme d'un texte réel — les avoir déjà rencontrés une fois change tout le jour où ils reviennent.",
      "Exercice concentré sur les dix symboles vus dans ce lot de leçons.",
    ],
    keys: ["(", ")", "\"", "-", "!", "@", "#", "$", "%", "^", "&", "*", ":", ";", "/", "_"],
    tokens: 24,
  },
  {
    title: "Mots — clôture du lot",
    content: [
      "Dernière leçon de ce lot : mots réels, tempo régulier, comme la Fluidité de la leçon 13 mais avec l'aisance de rangées et symboles en plus depuis.",
      "Le prochain lot du cursus enchaîne sur des mots plus longs et des majuscules en contexte de phrase plutôt que de touches isolées.",
      "Trente mots de la liste standard.",
    ],
    keys: [],
    tokens: 30,
    words: true,
  },
];
