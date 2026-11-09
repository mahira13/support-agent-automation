import { describe, expect, it, vi } from "vitest";

// Capture the prompts; the fake answers don't matter here.
const prompts = vi.hoisted(() => ({}) as Record<string, string>);
vi.mock("@/lib/llm", () => ({
  aiConfigured: () => true,
  MODEL: "fake · test-model",
  callStructured: vi.fn(async (opts: { toolName: string; system: string }) => {
    prompts[opts.toolName] = opts.system;
    if (opts.toolName === "save_triage")
      return { data: { category: "batch_certificate", brand: "maorika", sentiment: "neutral", risk_flags: [], summary_de: "", confidence: 0.9 }, meta: { ms: 1 } };
    if (opts.toolName === "save_draft")
      return { data: { reply_de: "Hier ist der Link.", facts_used: [], agent_wants_human: false, note_for_team: "" }, meta: { ms: 1 } };
    return { data: { verdict: "pass", issues: [], revised_reply_de: "" }, meta: { ms: 1 } };
  }),
}));

import ordersJson from "@/data/orders.json";
import { buildContext, getTicket } from "@/lib/data";
import { runAgent } from "@/lib/pipeline";
import { loadSupportFaq } from "@/lib/rules";

describe("Support-FAQ (Beispiel-Richtlinien)", () => {
  it("ist klar als Beispiel markiert und enthält die Standardantworten", () => {
    const faq = loadSupportFaq();
    expect(faq).toContain("Beispiel-Richtlinien");
    expect(faq).toContain("Meine Bestellungen → Rechnung");
    expect(faq).toContain("invoice_url");
    expect(faq).toContain("certificate_url");
    expect(faq).toMatch(/DHL.*1–3 Werktage/s);
    expect(faq).toMatch(/entscheidet immer ein Mensch/);
  });

  it("steht als eigener FAQ-Abschnitt im Entwurfs-Prompt", async () => {
    await runAgent(getTicket("T-1002")!);
    const draft = prompts.save_draft;
    expect(draft).toContain("<<<FAQ>>>");
    expect(draft).toContain(loadSupportFaq());
    expect(draft).toContain("<<<ENDE_FAQ>>>");
  });

  it("der Entwurfs-Prompt verbietet Versprechen, die das System nicht ausführt", async () => {
    await runAgent(getTicket("T-1002")!);
    const draft = prompts.save_draft;
    expect(draft).toMatch(/Versprich nie eine Handlung, die das System nicht ausführt/);
    expect(draft).toMatch(/keine Anhänge oder PDFs schicken, keine Rechnung\s+ausstellen, kein Geld erstatten, nichts nachschicken/);
  });

  it("Baby-Hinweis nur, wenn ein Baby oder Kind unter 1 erwähnt wird", async () => {
    await runAgent(getTicket("T-1002")!);
    expect(prompts.save_draft).toMatch(/Nur wenn die Nachricht ein Baby, einen Säugling oder ein Kind unter 1 Jahr erwähnt/);
    expect(prompts.save_draft).not.toMatch(/das immer klar sagen/);
  });
});

describe("Mock-Bestellungen: Rechnungslink", () => {
  it("jede Shop-Bestellung hat eine invoice_url, Amazon-Bestellungen nicht", () => {
    for (const o of ordersJson) {
      if (o.channel === "shopify") expect(o.invoice_url).toMatch(/^https:\/\//);
      else expect(o.invoice_url).toBeNull();
    }
  });

  it("der Kontext gibt die Rechnung und den Zertifikat-Link an den Entwurf weiter", () => {
    expect(buildContext(getTicket("T-1001")!).order?.invoice_url).toContain("NE-20417");
    expect(buildContext(getTicket("T-1002")!).batch?.certificate_url).toContain("M800-2407");
  });
});
