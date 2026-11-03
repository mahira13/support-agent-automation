import { describe, expect, it } from "vitest";
import { checkRules } from "@/lib/rules";

describe("Wortliste (Compliance Ebene 1)", () => {
  const bad = [
    "Unser Schwarzkümmelöl hilft gegen Diabetes.",
    "Manuka Honig wirkt bei Erkältung sehr gut.",
    "Das Öl senkt den Blutzucker auf natürliche Weise.",
    "Propolis stärkt Ihr Immunsystem.",
    "Manuka Honig ist antibakteriell.",
    "Sie können dann weniger Metformin nehmen.",
    "Mit dem Öl können Sie Ihre Tabletten reduzieren.",
    "Der Honig lindert Halsschmerzen.",
    "Honig heilt Wunden.",
  ];
  for (const text of bad) {
    it(`findet: "${text}"`, () => {
      expect(checkRules(text).length).toBeGreaterThan(0);
    });
  }

  const ok = [
    "Ihre Bestellung NE-20417 ist mit DHL unterwegs.",
    "Bitte reduzieren Sie Ihre Medikamente nicht ohne Rücksprache mit Ihrer Ärztin.",
    "Wir dürfen keine Aussagen machen, ob das Öl gegen Diabetes hilft.",
    "Honig ist nicht für Säuglinge unter 12 Monaten geeignet.",
    "Das Laborzertifikat für Charge M800-2407 zeigt MGO 842 mg/kg.",
    "Bei Husten wenden Sie sich bitte an Ihre Kinderärztin.",
  ];
  for (const text of ok) {
    it(`lässt durch: "${text}"`, () => {
      expect(checkRules(text)).toEqual([]);
    });
  }

  it("Verneinung in einem anderen Satz versteckt keinen Claim", () => {
    const text = "Wir sind keine Ärzte. Unser Öl hilft gegen Diabetes.";
    expect(checkRules(text).length).toBeGreaterThan(0);
  });
});
