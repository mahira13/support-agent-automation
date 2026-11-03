import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/store";

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  async function ticket(overrides: Partial<Parameters<MemoryStore["createTicket"]>[0]> = {}) {
    await store.createTicket({
      ticket_id: "T-1",
      received_at: new Date().toISOString(),
      source: "email",
      from_masked: "j***@example.com",
      subject: "Test",
      body: "Hallo",
      status: "processing",
      route_to: "",
      final_reply: "",
      sender_hash: "hash-a",
      message_id: "",
      ...overrides,
    });
  }

  it("legt ein Ticket an und listet es", async () => {
    await ticket();
    const recent = await store.listRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].ticket_id).toBe("T-1");
    expect(recent[0].steps).toEqual([]);
  });

  it("gibt nie den Absender-Hash oder die MessageID preis, nur die maskierte Adresse", async () => {
    await ticket({ sender_hash: "super-secret-hash", message_id: "msg-abc" });
    const recent = await store.listRecent(10);
    expect(JSON.stringify(recent)).not.toContain("super-secret-hash");
    expect(JSON.stringify(recent)).not.toContain("msg-abc");
    expect(recent[0].from_masked).toBe("j***@example.com");
  });

  it("fügt Schritte hinzu, neuester zuletzt", async () => {
    await ticket();
    await store.addStep("T-1", "triage", "running", "Wird eingeordnet …");
    await store.addStep("T-1", "triage", "done", "Kategorie: order_status", { category: "order_status" });
    const [t] = await store.listRecent(10);
    expect(t.steps).toHaveLength(2);
    expect(t.steps[1].state).toBe("done");
    expect(t.steps[1].detail).toEqual({ category: "order_status" });
  });

  it("schließt ein Ticket ab", async () => {
    await ticket();
    await store.finishTicket("T-1", { status: "ready_to_send", route_to: "support", final_reply: "Danke!" });
    const [t] = await store.listRecent(10);
    expect(t.status).toBe("ready_to_send");
    expect(t.final_reply).toBe("Danke!");
  });

  it("listRecent sortiert neueste zuerst und respektiert das Limit", async () => {
    await ticket({ ticket_id: "A", received_at: "2026-01-01T00:00:00Z" });
    await ticket({ ticket_id: "B", received_at: "2026-01-03T00:00:00Z" });
    await ticket({ ticket_id: "C", received_at: "2026-01-02T00:00:00Z" });
    const recent = await store.listRecent(2);
    expect(recent.map((t) => t.ticket_id)).toEqual(["B", "C"]);
  });

  it("countSince zählt nur Tickets ab dem Zeitpunkt", async () => {
    await ticket({ ticket_id: "old", received_at: "2020-01-01T00:00:00Z" });
    await ticket({ ticket_id: "new", received_at: "2030-01-01T00:00:00Z" });
    expect(await store.countSince("2025-01-01T00:00:00Z")).toBe(1);
  });

  it("countSince filtert optional nach Absender-Hash", async () => {
    await ticket({ ticket_id: "a1", received_at: "2030-01-01T00:00:00Z", sender_hash: "hash-a" });
    await ticket({ ticket_id: "b1", received_at: "2030-01-01T00:00:00Z", sender_hash: "hash-b" });
    expect(await store.countSince("2025-01-01T00:00:00Z", "hash-a")).toBe(1);
    expect(await store.countSince("2025-01-01T00:00:00Z")).toBe(2);
  });

  it("hasMessageId erkennt Duplikate und leere IDs", async () => {
    await ticket({ ticket_id: "dup", message_id: "msg-1" });
    expect(await store.hasMessageId("msg-1")).toBe(true);
    expect(await store.hasMessageId("msg-2")).toBe(false);
    expect(await store.hasMessageId("")).toBe(false);
  });
});
