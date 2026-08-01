import { describe, it, expect } from "vitest";
import { rowHtml, sectionHtml, sections, type SettingRow } from "./settings";
import { defaultPreferences, FONT_STACKS } from "../core/preferences";

const row: SettingRow = {
  key: "fontFamily",
  label: "Police de frappe",
  description: "Change la police du texte à taper.",
  control: {
    kind: "segmented",
    value: "courier",
    options: [
      { value: "jetbrains", label: "JetBrains Mono", font: FONT_STACKS.jetbrains.stack },
      { value: "courier", label: "Courier", font: FONT_STACKS.courier.stack },
    ],
  },
};

describe("rowHtml — libellé et explication à gauche, contrôle à droite", () => {
  const html = rowHtml(row);

  it("rend le libellé ET son explication (l'explication n'est pas une info-bulle)", () => {
    expect(html).toContain("Police de frappe");
    expect(html).toContain("Change la police du texte à taper.");
    expect(html).toContain('class="set-desc"');
  });

  it("sépare la colonne de texte de la colonne de contrôle", () => {
    expect(html.indexOf('class="set-text"')).toBeLessThan(html.indexOf('class="set-control"'));
  });

  it("marque comme pressée la seule option active", () => {
    expect(html).toMatch(/data-value="courier"\s+aria-pressed="true"/);
    expect(html).toMatch(/data-value="jetbrains"\s+aria-pressed="false"/);
  });

  it("étiquette le groupe de contrôle par le libellé de la ligne", () => {
    expect(html).toContain('id="lbl-fontFamily"');
    expect(html).toContain('aria-labelledby="lbl-fontFamily"');
  });

  it("rend chaque option dans la police qu'elle sélectionne", () => {
    expect(html).toContain(`style="font-family:${FONT_STACKS.courier.stack}"`);
  });
});

describe("rowHtml — contrôles slider et toggle (issue #66)", () => {
  it("rend un curseur natif avec bornes et valeur", () => {
    const html = rowHtml({
      key: "soundVolume",
      label: "Volume",
      description: "Volume des effets sonores.",
      control: { kind: "slider", value: 0.5, min: 0, max: 1, step: 0.05 },
    });
    expect(html).toContain('type="range"');
    expect(html).toContain('data-setting="soundVolume"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="1"');
    expect(html).toContain('value="0.5"');
  });

  it("rend une case à cocher, cochée si la valeur est vraie", () => {
    const html = rowHtml({
      key: "soundOnError",
      label: "Son sur erreur",
      description: "Joue un son sur une frappe fausse.",
      control: { kind: "toggle", value: true },
    });
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("case à cocher décochée : pas de mot-clé checked", () => {
    const html = rowHtml({
      key: "soundOnError",
      label: "Son sur erreur",
      description: "Joue un son sur une frappe fausse.",
      control: { kind: "toggle", value: false },
    });
    expect(html).not.toContain("checked");
  });
});

describe("sectionHtml", () => {
  it("numérote la section sur deux chiffres et porte son rang pour la révélation décalée", () => {
    const html = sectionHtml({ title: "Apparence", rows: [row] }, 0);
    expect(html).toContain(">01<");
    expect(html).toContain('style="--i:0"');
    expect(html).toContain("Apparence");
  });
});

describe("sections — déclaration des réglages", () => {
  it("reflète la valeur courante des Preferences dans le contrôle", () => {
    const [apparence] = sections({ ...defaultPreferences(), fontFamily: "inter" });
    expect(apparence.rows[0].control.value).toBe("inter");
  });

  it("chaque ligne a une clé, un libellé et une explication non vides", () => {
    for (const section of sections(defaultPreferences())) {
      for (const r of section.rows) {
        expect(r.key).not.toBe("");
        expect(r.label).not.toBe("");
        expect(r.description).not.toBe("");
      }
    }
  });

  it("la section Solo (issue #65) reflète quickRestartKey et stopOnError", () => {
    const solo = sections({ ...defaultPreferences(), quickRestartKey: "esc", stopOnError: "word" }).find(
      (s) => s.title === "Solo",
    );
    expect(solo?.rows.find((r) => r.key === "quickRestartKey")?.control.value).toBe("esc");
    expect(solo?.rows.find((r) => r.key === "stopOnError")?.control.value).toBe("word");
  });

  it("la section Apparence (issue #67) reflète les styles live, l'opacité et show-all-lines", () => {
    const prefs = {
      ...defaultPreferences(),
      liveAccuracyStyle: "off" as const,
      timerOpacity: 0.5 as const,
      showAllLines: true,
    };
    const apparence = sections(prefs).find((s) => s.title === "Apparence");
    expect(apparence?.rows.find((r) => r.key === "liveAccuracyStyle")?.control.value).toBe("off");
    expect(apparence?.rows.find((r) => r.key === "timerOpacity")?.control.value).toBe(0.5);
    expect(apparence?.rows.find((r) => r.key === "showAllLines")?.control.value).toBe(true);
  });
});
