import { describe, expect, it } from "vitest";
import { hashSender, maskEmail } from "@/lib/privacy";

describe("maskEmail", () => {
  it("maskiert den lokalen Teil bis auf den ersten Buchstaben", () => {
    expect(maskEmail("j.becker@example.com")).toBe("j***@example.com");
  });

  it("behält die Domain sichtbar", () => {
    expect(maskEmail("anna@firma.de")).toBe("a***@firma.de");
  });

  it("gibt *** zurück, wenn kein @ vorhanden ist", () => {
    expect(maskEmail("keine-email")).toBe("***");
  });
});

describe("hashSender", () => {
  it("ist deterministisch für dieselbe Adresse", () => {
    expect(hashSender("Jana@Example.com")).toBe(hashSender("jana@example.com "));
  });

  it("ist unterschiedlich für unterschiedliche Absender", () => {
    expect(hashSender("a@example.com")).not.toBe(hashSender("b@example.com"));
  });

  it("enthält nie die Original-Adresse im Klartext", () => {
    expect(hashSender("secret@example.com")).not.toContain("secret");
    expect(hashSender("secret@example.com")).not.toContain("example.com");
  });
});
