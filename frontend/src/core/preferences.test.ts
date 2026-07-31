import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  defaultPreferences,
  parsePreferences,
  loadPreferences,
  savePreferences,
  setPreference,
  resetPreferences,
  applyPreferences,
  FONT_STACKS,
} from "./preferences";

// localStorage et document n'existent pas sous vitest (pas de jsdom dans ce
// projet) : on les remplace par le strict minimum que le module touche.
const store = new Map<string, string>();
let applied: Record<string, string>;

beforeEach(() => {
  store.clear();
  applied = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("document", {
    documentElement: {
      style: { setProperty: (k: string, v: string) => void (applied[k] = v) },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("parsePreferences — le stockage est une frontière de confiance", () => {
  it("absence totale : tout au défaut", () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences());
    expect(parsePreferences(undefined)).toEqual(defaultPreferences());
    expect(parsePreferences("pas un objet")).toEqual(defaultPreferences());
  });

  it("valeur hors domaine : cette clé retombe au défaut", () => {
    expect(parsePreferences({ fontFamily: "comic-sans" }).fontFamily).toBe(
      defaultPreferences().fontFamily,
    );
    expect(parsePreferences({ fontFamily: 42 }).fontFamily).toBe(defaultPreferences().fontFamily);
  });

  it("valeur valide : conservée", () => {
    expect(parsePreferences({ fontFamily: "courier" }).fontFamily).toBe("courier");
  });

  it("clé inconnue dans le stockage : ignorée, jamais recopiée", () => {
    const parsed = parsePreferences({ fontFamily: "inter", vieilleCle: true });
    expect(parsed).toEqual({ fontFamily: "inter" });
  });
});

describe("aller-retour localStorage", () => {
  it("save puis load rend les mêmes Preferences", () => {
    const prefs = { ...defaultPreferences(), fontFamily: "system" as const };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });

  it("stockage illisible (JSON cassé) : défauts, sans lever", () => {
    store.set("typeracer:preferences", "{pas du json");
    expect(loadPreferences()).toEqual(defaultPreferences());
  });

  it("stockage indisponible : défauts, sans lever", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(loadPreferences()).toEqual(defaultPreferences());
    expect(() => savePreferences(defaultPreferences())).not.toThrow();
  });
});

describe("setPreference", () => {
  it("écrit, persiste et applique une valeur valide", () => {
    expect(setPreference("fontFamily", "inter").fontFamily).toBe("inter");
    expect(loadPreferences().fontFamily).toBe("inter");
    expect(applied["--font-mono"]).toBe(FONT_STACKS.inter.stack);
  });

  it("valeur hors domaine : refusée, rien n'est écrit", () => {
    setPreference("fontFamily", "courier");
    // @ts-expect-error — on force la valeur invalide qu'un import JSON pourrait produire
    expect(setPreference("fontFamily", "wingdings").fontFamily).toBe("courier");
    expect(loadPreferences().fontFamily).toBe("courier");
  });
});

describe("resetPreferences", () => {
  it("ramène tout au défaut et le persiste", () => {
    setPreference("fontFamily", "courier");
    expect(resetPreferences()).toEqual(defaultPreferences());
    expect(loadPreferences()).toEqual(defaultPreferences());
  });
});

describe("applyPreferences", () => {
  it("projette la police choisie sur --font-mono", () => {
    applyPreferences({ fontFamily: "courier" });
    expect(applied["--font-mono"]).toBe(FONT_STACKS.courier.stack);
  });

  it("les piles de polices sont citées en guillemets simples (elles partent en attribut style)", () => {
    for (const { stack } of Object.values(FONT_STACKS)) {
      expect(stack).not.toContain('"');
    }
  });
});
