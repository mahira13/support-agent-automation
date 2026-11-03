import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the AI so the test runs fully offline. The route still goes through
// real triage → context → draft → compliance → decision logic; only the
// model call itself is faked.
vi.mock("@/lib/llm", () => ({
  aiConfigured: () => true,
  MODEL: "fake · test-model",
  callStructured: vi.fn(async (opts: { toolName: string }) => {
    if (opts.toolName === "save_triage") {
      return {
        data: {
          category: "order_status",
          brand: "nedura",
          sentiment: "neutral",
          risk_flags: [],
          summary_de: "Kunde fragt nach dem Status seiner Bestellung.",
          confidence: 0.9,
        },
        meta: { ms: 1 },
      };
    }
    if (opts.toolName === "save_draft") {
      return {
        data: {
          reply_de: "Vielen Dank für Ihre Nachricht. Unser Team prüft das gern für Sie.",
          facts_used: [],
          agent_wants_human: false,
          note_for_team: "",
        },
        meta: { ms: 1 },
      };
    }
    if (opts.toolName === "save_review") {
      return { data: { verdict: "pass", issues: [], revised_reply_de: "" }, meta: { ms: 1 } };
    }
    throw new Error(`unerwarteter toolName in Testmock: ${opts.toolName}`);
  }),
}));

import { POST } from "@/app/api/inbound-email/route";
import { getStore, resetStore } from "@/lib/store";

const TOKEN = "test-token-123";

// Same shape apps-script/GmailForwarder.gs sends (Postmark's field names, no StrippedTextReply).
function forwarderPayload(overrides: Record<string, unknown> = {}) {
  return {
    FromFull: { Email: "k.weber@example.com", Name: "Klaus Weber" },
    FromName: "Klaus Weber",
    Subject: "Wo ist meine Bestellung?",
    TextBody: "Hallo, wo ist meine Bestellung NE-99999? Danke, Klaus",
    HtmlBody: "<div>Hallo, wo ist meine Bestellung NE-99999?<br>Danke, Klaus</div>",
    MessageID: `<msg-${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
    Headers: [],
    Date: new Date().toISOString(),
    ...overrides,
  };
}

function request(body: unknown, token = TOKEN) {
  return new Request(`http://localhost/api/inbound-email?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/inbound-email", () => {
  const prevToken = process.env.INBOUND_WEBHOOK_TOKEN;
  const prevLive = process.env.ENABLE_LIVE;
  const prevSheetUrl = process.env.SHEET_API_URL;

  beforeEach(() => {
    process.env.INBOUND_WEBHOOK_TOKEN = TOKEN;
    process.env.ENABLE_LIVE = "true";
    delete process.env.SHEET_API_URL; // force MemoryStore
    resetStore();
  });

  afterEach(() => {
    process.env.INBOUND_WEBHOOK_TOKEN = prevToken;
    process.env.ENABLE_LIVE = prevLive;
    if (prevSheetUrl) process.env.SHEET_API_URL = prevSheetUrl;
    resetStore();
  });

  it("lehnt einen falschen Token mit 401 ab", async () => {
    const res = await POST(request(forwarderPayload(), "falscher-token"));
    expect(res.status).toBe(401);
    const recent = await getStore().listRecent(10);
    expect(recent).toHaveLength(0);
  });

  it("lehnt einen fehlenden Token mit 401 ab", async () => {
    const res = await POST(request(forwarderPayload(), ""));
    expect(res.status).toBe(401);
  });

  it("speichert ein gültiges Ticket und verarbeitet es (200)", async () => {
    const res = await POST(request(forwarderPayload()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.ticket_id).toBeTruthy();

    const recent = await getStore().listRecent(10);
    expect(recent).toHaveLength(1);
    const t = recent[0];
    expect(t.ticket_id).toBe(json.ticket_id);
    expect(t.from_masked).toBe("k***@example.com");
    expect(JSON.stringify(t)).not.toContain("k.weber@example.com");
    expect(t.status).not.toBe("processing");
    expect(t.final_reply).toContain("Unser Team prüft");
    const stepNames = t.steps.map((s) => s.step);
    expect(stepNames).toEqual(["received", "triage", "triage", "context", "context", "draft", "draft", "compliance", "compliance", "decision"]);
  });

  it("ignoriert eine automatische Antwort (Auto-Submitted)", async () => {
    const res = await POST(request(forwarderPayload({ Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }] })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toMatch(/Auto-Submitted/);
    expect(await getStore().listRecent(10)).toHaveLength(0);
  });

  it("ignoriert noreply-Absender und Massenmails", async () => {
    await POST(request(forwarderPayload({ FromFull: { Email: "noreply@shop.example" } })));
    await POST(request(forwarderPayload({ Headers: [{ Name: "Precedence", Value: "bulk" }] })));
    expect(await getStore().listRecent(10)).toHaveLength(0);
  });

  it("verarbeitet dieselbe MessageID nicht zweimal", async () => {
    const payload = forwarderPayload({ MessageID: "fixed-id-1" });
    await POST(request(payload));
    await POST(request(payload));
    const recent = await getStore().listRecent(10);
    expect(recent).toHaveLength(1);
  });
});
