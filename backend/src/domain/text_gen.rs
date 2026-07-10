// =============================================================================
//  domain/text_gen.rs — génération de texte cible (FONCTION PURE et SEEDÉE).
//
//  PORT Rust de `frontend/src/core/text-gen/` (la RÉFÉRENCE). Même (settings,
//  count, seed) ⇒ même sortie qu'en TS, bit pour bit. En Phase 2 le serveur
//  devient propriétaire du texte : il tire le seed et génère ici, le client ne
//  l'envoie plus. Quotes/Zen ne passent pas par cette fonction.
//
//  Parité assurée par mulberry32 en arithmétique u32 (Math.imul ↔ wrapping_mul,
//  `+` JS 32-bit ↔ wrapping_add) et une word-list identique au TS.
// =============================================================================

/// PRNG seedé déterministe (mulberry32), miroir de `core/text-gen/rng.ts`.
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng { state: seed }
    }

    /// Flottant dans [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }

    /// Entier dans [0, max).
    pub fn int(&mut self, max: usize) -> usize {
        (self.next_f64() * max as f64).floor() as usize
    }

    /// Élément aléatoire d'une liste non vide.
    pub fn pick<'a>(&mut self, arr: &'a [&'a str]) -> &'a str {
        arr[self.int(arr.len())]
    }

    /// true avec la probabilité p (0..1).
    pub fn chance(&mut self, p: f64) -> bool {
        self.next_f64() < p
    }
}

/// Sous-ensemble de config qui influe sur la génération.
pub struct GenSettings {
    pub punctuation: bool,
    pub numbers: bool,
}

/// Proportion de slots transformés en jeton-nombre.
const NUMBER_TOKEN_RATIO: f64 = 0.17;

// Ponctuation "structurée type phrases" (voir core/text-gen/punctuation.ts).
const SENTENCE_MIN: usize = 4;
const SENTENCE_MAX: usize = 10;
const COMMA: f64 = 0.12;
const QUOTE: f64 = 0.05;
const PAREN: f64 = 0.04;

/// Génère `count` jetons-mots cibles. Joints par des espaces, ils forment le
/// `targetText`.
pub fn generate_text(settings: &GenSettings, count: usize, seed: u32) -> Vec<String> {
    let mut rng = Rng::new(seed);
    generate_with_rng(settings, count, &mut rng)
}

/// Variante exposant le Rng, pour re-générer des lots en CONTINUANT la même
/// suite (Time infini, déterminisme préservé).
pub fn generate_with_rng(settings: &GenSettings, count: usize, rng: &mut Rng) -> Vec<String> {
    let mut base: Vec<String> = Vec::with_capacity(count);
    for _ in 0..count {
        if settings.numbers && rng.chance(NUMBER_TOKEN_RATIO) {
            base.push(number_token(rng));
        } else {
            base.push(rng.pick(ENGLISH_WORDS).to_string());
        }
    }
    if settings.punctuation {
        apply_punctuation(&base, rng)
    } else {
        base
    }
}

/// Jeton-nombre autonome de 1 à 4 chiffres (1er chiffre jamais 0, sauf "0").
fn number_token(rng: &mut Rng) -> String {
    let len = 1 + rng.int(4);
    if len == 1 {
        return rng.int(10).to_string();
    }
    let mut s = (1 + rng.int(9)).to_string();
    for _ in 1..len {
        s.push_str(&rng.int(10).to_string());
    }
    s
}

/// Majuscule sur la 1re lettre a-z ; inchangé si déjà capitalisé ou sans lettre.
fn capitalize(token: &str) -> String {
    let bytes = token.as_bytes();
    for (i, &c) in bytes.iter().enumerate() {
        if c.is_ascii_lowercase() {
            let mut out = String::with_capacity(token.len());
            out.push_str(&token[..i]);
            out.push((c - 32) as char);
            out.push_str(&token[i + 1..]);
            return out;
        }
        if c.is_ascii_uppercase() {
            return token.to_string();
        }
    }
    token.to_string()
}

/// Marque de fin de phrase : '.' 70 %, '?' 15 %, '!' 15 %.
fn end_mark(rng: &mut Rng) -> char {
    let r = rng.next_f64();
    let mut acc = 0.0;
    for (mark, w) in [('.', 0.7f64), ('?', 0.15), ('!', 0.15)] {
        acc += w;
        if r < acc {
            return mark;
        }
    }
    '.'
}

/// Décore des jetons bruts en phrases ponctuées (miroir de applyPunctuation).
fn apply_punctuation(tokens: &[String], rng: &mut Rng) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(tokens.len());
    let mut i = 0;
    while i < tokens.len() {
        let remaining = tokens.len() - i;
        let mut len = SENTENCE_MIN + rng.int(SENTENCE_MAX - SENTENCE_MIN + 1);
        if len > remaining {
            len = remaining;
        }
        let end = i + len;
        for j in i..end {
            let mut tok = tokens[j].clone();
            let is_first = j == i;
            let is_last = j == end - 1;

            if !is_last {
                if rng.chance(QUOTE) {
                    tok = format!("\"{tok}\"");
                } else if rng.chance(PAREN) {
                    tok = format!("({tok})");
                }
            }

            if is_first {
                tok = capitalize(&tok);
            }

            if is_last {
                tok.push(end_mark(rng));
            } else if rng.chance(COMMA) {
                tok.push(',');
            }
            out.push(tok);
        }
        i = end;
    }
    out
}

/// Liste de mots anglais embarquée — copie exacte de `core/text-gen/word-list.ts`.
const ENGLISH_WORDS: &[&str] = &[
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
];

#[cfg(test)]
mod tests {
    use super::*;

    // Vecteurs de référence figés depuis le TS (seed 12345, count 40).
    // Source : frontend/src/core/text-gen/ via generateText.
    #[test]
    fn parity_with_ts_seed_12345() {
        let seed = 12345;
        let cases: [(GenSettings, &[&str]); 4] = [
            (
                GenSettings { punctuation: false, numbers: false },
                &["city","which","look","mother","over","like","not","where","open","area","other","river","ask","again","these","their","now","get","small","night","day","such","should","most","see","not","me","an","book","as","out","it","these","begin","like","will","the","part","room","that"],
            ),
            (
                GenSettings { punctuation: false, numbers: true },
                &["which","mother","like","9849","again","their","get","night","such","most","not","an","as","it","begin","will","805","music","958","so","think","get","4810","word","point","not","city","small","the","from","we","call","small","where","they","river","be","woman","new","room"],
            ),
            (
                GenSettings { punctuation: true, numbers: false },
                &["City,","which","look","mother","over","like","\"not\"","where?","Open,","area","other,","river","ask","again.","These","their","(now)","get","small","night","day","such,","should.","Most","see","not","\"me\"","an.","Book","as","\"out\"","it","these","begin","like","will!","The","part","room","that."],
            ),
            (
                GenSettings { punctuation: true, numbers: true },
                &["Which","mother","like,","9849","again","their","get,","(night)","such","most.","(Not)","an","as","it","begin","will","805,","music!","958","\"so\"","think","\"get\"","4810","word","point.","Not","city","small","the","from","we","call","small","where","they.","River","(be)","woman","new,","room."],
            ),
        ];
        for (settings, expected) in cases {
            let got = generate_text(&settings, 40, seed);
            assert_eq!(got, expected);
        }
    }

    #[test]
    fn same_seed_same_output() {
        let s = GenSettings { punctuation: true, numbers: true };
        assert_eq!(generate_text(&s, 30, 999), generate_text(&s, 30, 999));
    }
}
