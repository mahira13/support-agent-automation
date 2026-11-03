import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake AI: a clean order-status ticket. Only agent_wants_human changes per test.
const fake = vi.hoisted(() => ({
  wantsHuman: false,
  category: "order_status",
  prompts: {} as Record<string, string>,
}));

vi.mock("@/lib/llm", () => ({
  aiConfigured: () => true,
  MODEL: "fake · test-model",
  callStructured: vi.fn(async (opts: { toolName: string; system: string }) => {
    fake.prompts[opts.toolName] = opts.system;
    if (opts.toolName === "save_triage") {
      return {
        data: { category: fake.category, brand: "nedura", sentiment: "neutral", risk_flags: [], summary_de: "Frage zur Bestellung.", confidence: 0.95 },
        meta: { ms: 1 },
      };
    }
    if (opts.toolName === "save_draft") {
      return {
        data: {
          reply_de: "Ihre Bestellung NE-20417 ist mit DHL unterwegs.\n\nIhr Kundenservice von maorika & nedura",
          facts_used: ["Status: shipped"],
          agent_wants_human: fake.wantsHuman,
          note_for_team: "",
        },
        meta: { ms: 1 },
      };
    }
    if (opts.toolName === "save_review") return { data: { verdict: "pass", issues: [], revised_reply_de: "" }, meta: { ms: 1 } };
    throw new Error(`unerwarteter toolName: ${opts.toolName}`);
  }),
}));

import { getTicket } from "@/lib/data";
import { runAgent } from "@/lib/pipeline";

describe("agent_wants_human", () => {
  beforeEach(() => {
    fake.wantsHuman = false;
    fake.category = "order_status";
  });

  it("sauberer Bestellstatus (T-1001) mit agent_wants_human=false → sendefertig", async () => {
    const r = await runAgent(getTicket("T-1001")!);
    expect(r.context.order?.tracking_number).toBeTruthy();
    expect(r.status).toBe("ready_to_send");
    expect(r.status_reasons).toEqual([]);
  });

  it("derselbe Fall mit agent_wants_human=true → Prüfung durch Mensch", async () => {
    fake.wantsHuman = true;
    const r = await runAgent(getTicket("T-1001")!);
    expect(r.status).toBe("needs_review");
    expect(r.status_reasons).toContain("Agent empfiehlt menschliche Prüfung");
  });

  it("fehlender Artikel (T-1010): Nachlieferung braucht einen Menschen", async () => {
    fake.wantsHuman = true; // what the prompt asks for "Ersatz oder Nachlieferung"
    fake.category = "damage_return";
    const r = await runAgent(getTicket("T-1010")!);
    expect(r.status).toBe("needs_review");
  });

  it("der Entwurfs-Prompt nennt die Regeln für agent_wants_human", async () => {
    await runAgent(getTicket("T-1001")!);
    const prompt = fake.prompts.save_draft;
    expect(prompt).toContain("Ersatz oder Nachlieferung");
    expect(prompt).toMatch(/Gesundheit, Medikamente, Schwangerschaft, Kinder oder Allergien/);
    expect(prompt).toMatch(/Bestellstatus.*\n.*→ false/);
  });
});
