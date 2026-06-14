// =============================================================================
//  word-list.ts — liste de mots anglais embarquée (MVP, langue = anglais seul).
//
//  Liste des mots anglais courants (minuscule, sans ponctuation). Les Settings
//  Punctuation/Numbers s'appliquent PAR-DESSUS, dans index.ts. Élargissable ;
//  en Phase 2 cette liste sera dupliquée côté Rust pour la génération serveur.
// =============================================================================

export const ENGLISH_WORDS: readonly string[] = [
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "it",
  "for", "not", "on", "with", "he", "as", "you", "do", "at", "this",
  "but", "his", "by", "from", "they", "we", "say", "her", "she", "or",
  "an", "will", "my", "one", "all", "would", "there", "their", "what", "so",
  "up", "out", "if", "about", "who", "get", "which", "go", "me", "when",
  "make", "can", "like", "time", "no", "just", "him", "know", "take", "people",
  "into", "year", "your", "good", "some", "could", "them", "see", "other", "than",
  "then", "now", "look", "only", "come", "its", "over", "think", "also", "back",
  "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
  "new", "want", "because", "any", "these", "give", "day", "most", "us", "world",
  "life", "hand", "part", "child", "eye", "woman", "place", "week", "case", "point",
  "right", "study", "book", "word", "where", "small", "great", "such", "should", "home",
  "water", "room", "mother", "area", "money", "story", "fact", "month", "different", "night",
  "live", "find", "tell", "ask", "seem", "feel", "leave", "call", "keep", "begin",
  "music", "river", "light", "color", "sound", "again", "city", "house", "play", "open",
] as const;
