import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Log of what happened, in order: AI calls and finished store writes.
const log = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/llm", () => ({
  aiConfigured: () => true,
  MODEL: "fake · test-model",
  callStructured: vi.fn(async (opts: { toolName: string }) => {
    log.push(`ai:${opts.toolName}`);
    if (opts.toolName === "save_triage")
      return { data: { category: "order_status", brand: "nedura", sentiment: "neutral", risk_flags: [], summary_de: "", confidence: 0.95 }, meta: { ms: 1 } };
    if (opts.toolName === "save_draft")
      return { data: { reply_de: "Ihr Paket ist unterwegs.", facts_used: [], agent_wants_human: false, note_for_team: "" }, meta: { ms: 1 } };
    return { data: { verdict: "pass", issues: [], revised_reply_de: "" }, meta: { ms: 1 } };
  }),
}));

import { continueIntake } from "@/lib/intake";
import { getStore, resetStore, MemoryStore } from "@/lib/store";
import { getTicket } from "@/lib/data";

const SLOW_WRITE_MS = 25; // stands in for the ~2 s of a real Sheet write

describe("continueIntake: Schreib-Warteschlange", () => {
  beforeEach(() => {
    log.length = 0;
    delete process.env.SHEET_API_URL;
    resetStore();
  });
  afterEach(() => resetStore());

  it("die KI wartet nicht auf die Sheet-Schreibvorgänge, Reihenfolge bleibt, Ende wartet auf alle", async () => {
    const store = getStore() as MemoryStore;
    const t = getTicket("T-1001")!;
    await store.createTicket({
      ticket_id: "Q-1", received_at: new Date().toISOString(), source: "email", from_masked: "j***@example.com",
      subject: t.subject, body: t.body, status: "processing", route_to: "", final_reply: "", sender_hash: "h", message_id: "",
    });

    const realAdd = store.addStep.bind(store);
    vi.spyOn(store, "addStep").mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, SLOW_WRITE_MS));
      await realAdd(...args);
      log.push(`write:${args[1]}:${args[2]}`);
    });
    const realFinish = store.finishTicket.bind(store);
    vi.spyOn(store, "finishTicket").mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, SLOW_WRITE_MS));
      await realFinish(...args);
      log.push("write:finish");
    });

    await continueIntake("Q-1", { ...t, id: "Q-1" });

    // All three AI calls happened before even the second write was done.
    const secondWrite = log.findIndex((e, i) => e.startsWith("write:") && log.slice(0, i).some((x) => x.startsWith("write:")));
    expect(log.lastIndexOf("ai:save_review")).toBeLessThan(secondWrite);

    // Writes kept their order, and the ticket was finished last.
    const [ticket] = await store.listRecent(1);
    expect(ticket.steps.map((s) => `${s.step}:${s.state}`)).toEqual([
      "triage:running", "triage:done", "context:running", "context:done",
      "draft:running", "draft:done", "compliance:running", "compliance:done", "decision:done",
    ]);
    expect(log[log.length - 1]).toBe("write:finish");
    expect(ticket.status).toBe("ready_to_send"); // continueIntake only returned after the last write
  });
});
