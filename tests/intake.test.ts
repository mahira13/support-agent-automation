import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limit logic never calls the AI; only aiConfigured() matters here.
vi.mock("@/lib/llm", () => ({
  aiConfigured: () => true,
  MODEL: "fake · test-model",
  callStructured: vi.fn(async () => {
    throw new Error("KI darf in diesem Test nicht aufgerufen werden");
  }),
}));

import { beginIntake } from "@/lib/intake";
import { getStore, resetStore } from "@/lib/store";

const ENV_KEYS = ["ENABLE_LIVE", "LIVE_DAILY_LIMIT", "LIVE_PER_SENDER_HOUR", "SHEET_API_URL", "SHEET_API_SECRET"] as const;

function mail(sender: string, i: number) {
  return { source: "email" as const, senderId: sender, subject: `Frage ${i}`, body: "Wo ist mein Paket?", messageId: `m-${sender}-${i}` };
}

describe("Limits (beginIntake mit MemoryStore)", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) prev[k] = process.env[k];
    process.env.ENABLE_LIVE = "true";
    delete process.env.SHEET_API_URL; // force MemoryStore
    delete process.env.SHEET_API_SECRET;
    resetStore();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    resetStore();
  });

  it("verarbeitet pro Absender genau LIVE_PER_SENDER_HOUR Tickets pro Stunde", async () => {
    process.env.LIVE_PER_SENDER_HOUR = "3";
    process.env.LIVE_DAILY_LIMIT = "100";
    const results: Awaited<ReturnType<typeof beginIntake>>[] = [];
    for (let i = 0; i < 4; i++) results.push(await beginIntake(mail("a@example.com", i)));
    expect(results.slice(0, 3).every((r) => r.ticket !== null)).toBe(true);
    expect(results[3].ticket).toBeNull();

    const blocked = (await getStore().listRecent(10)).find((t) => t.ticket_id === results[3].ticket_id)!;
    expect(blocked.status).toBe("blocked");
    expect(blocked.steps[0].label_de).toMatch(/Limit erreicht/);
  });

  it("ein anderer Absender ist vom Absender-Limit nicht betroffen", async () => {
    process.env.LIVE_PER_SENDER_HOUR = "1";
    process.env.LIVE_DAILY_LIMIT = "100";
    expect((await beginIntake(mail("a@example.com", 1))).ticket).not.toBeNull();
    expect((await beginIntake(mail("a@example.com", 2))).ticket).toBeNull();
    expect((await beginIntake(mail("b@example.com", 1))).ticket).not.toBeNull();
  });

  it("Tageslimit gilt für alle Absender zusammen", async () => {
    process.env.LIVE_PER_SENDER_HOUR = "100";
    process.env.LIVE_DAILY_LIMIT = "2";
    expect((await beginIntake(mail("a@example.com", 1))).ticket).not.toBeNull();
    expect((await beginIntake(mail("b@example.com", 1))).ticket).not.toBeNull();
    expect((await beginIntake(mail("c@example.com", 1))).ticket).toBeNull();
  });

  it("Standardwerte: 5 pro Absender und Stunde", async () => {
    delete process.env.LIVE_PER_SENDER_HOUR;
    delete process.env.LIVE_DAILY_LIMIT;
    const results: Awaited<ReturnType<typeof beginIntake>>[] = [];
    for (let i = 0; i < 6; i++) results.push(await beginIntake(mail("a@example.com", i)));
    expect(results.filter((r) => r.ticket !== null)).toHaveLength(5);
  });

  it("kürzt den Text auf 2.000 Zeichen und speichert nur die maskierte Adresse", async () => {
    const r = await beginIntake({ ...mail("jana.becker@firma.de", 1), body: "x".repeat(5000) });
    expect(r.ticket!.body).toHaveLength(2000);
    const [stored] = await getStore().listRecent(1);
    expect(stored.body).toHaveLength(2000);
    expect(stored.from_masked).toBe("j***@firma.de");
    expect(JSON.stringify(stored)).not.toContain("jana.becker");
  });

  it("ohne ENABLE_LIVE=true wird nichts an die KI gegeben", async () => {
    process.env.ENABLE_LIVE = "false";
    const r = await beginIntake(mail("a@example.com", 1));
    expect(r.ticket).toBeNull();
    const [stored] = await getStore().listRecent(1);
    expect(stored.steps[0].label_de).toBe("Live-Modus aus");
  });
});
