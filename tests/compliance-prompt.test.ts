import { describe, expect, it, vi } from "vitest";

// Captures the user prompt the AI review gets.
const seen = vi.hoisted(() => ({ user: "" }));
vi.mock("@/lib/llm", () => ({
  aiConfigured: () => true,
  MODEL: "fake · test-model",
  callStructured: vi.fn(async (opts: { user: string }) => {
    seen.user = opts.user;
    return { data: { verdict: "pass", issues: [], revised_reply_de: "" }, meta: { ms: 1 } };
  }),
}));

import { checkCompliance } from "@/lib/compliance";
import { getTicket } from "@/lib/data";

const draft = (reply_de: string) => ({ reply_de, facts_used: [], agent_wants_human: false, note_for_team: "" });

describe("Compliance-Prompt", () => {
  it("ohne Wortlisten-Treffer steht dort kein einzelnes Wort „keine“, das die KI entfernen soll", async () => {
    await checkCompliance(getTicket("T-1007")!, draft("Guten Tag Herr Weber,\n\ndie Rechnung finden Sie in Ihrem Amazon-Konto."), "Klaus Weber");
    expect(seen.user).toContain("AUTOMATISCHE WORTLISTE: kein Treffer.");
    expect(seen.user).not.toContain("müssen auf jeden Fall raus");
  });

  it("der Name aus den Bestelldaten wird mitgegeben (sonst hält die KI ihn für erfunden)", async () => {
    await checkCompliance(getTicket("T-1007")!, draft("Guten Tag Herr Weber,"), "Klaus Weber");
    expect(seen.user).toContain("KUNDENNAME AUS DEN BESTELLDATEN (aus dem System, nicht erfunden): Klaus Weber");
    await checkCompliance(getTicket("T-1007")!, draft("Guten Tag,"));
    expect(seen.user).toContain("KUNDENNAME AUS DEN BESTELLDATEN (aus dem System, nicht erfunden): nicht bekannt");
  });

  it("mit Treffer: Treffer stehen im Prompt, und ein „pass“ der KI wird trotzdem blockiert", async () => {
    const r = await checkCompliance(getTicket("T-1003")!, draft("Unser Schwarzkümmelöl hilft gegen Diabetes."));
    expect(seen.user).toContain("müssen auf jeden Fall raus");
    expect(r.result.review.verdict).toBe("block");
    expect(r.result.final_reply_de).toBe("");
  });
});
