import { describe, expect, it } from "vitest";
import { buildContext, extractBatchIds, extractOrderNumbers, getTicket } from "@/lib/data";
import { decideStatus } from "@/lib/pipeline";
import type { ComplianceResult, Draft, Triage } from "@/lib/types";

describe("Kontext (ohne KI)", () => {
  it("erkennt Shopify- und Amazon-Bestellnummern", () => {
    expect(extractOrderNumbers("Bestellung NE-20417 und 302-8841123-5521904")).toEqual([
      "NE-20417",
      "302-8841123-5521904",
    ]);
  });

  it("verwechselt Bestellnummern nicht mit Chargen", () => {
    expect(extractBatchIds("Bestellung MA-10388, Charge M550-2409")).toEqual(["M550-2409"]);
  });

  it("findet Bestellung über die Nummer", () => {
    const ctx = buildContext(getTicket("T-1001")!);
    expect(ctx.order?.order_number).toBe("NE-20417");
    expect(ctx.order_found_by).toBe("order_number");
  });

  it("findet Charge und Zertifikat", () => {
    const ctx = buildContext(getTicket("T-1002")!);
    expect(ctx.batch?.certificate_url).toContain("M800-2407");
  });

  it("findet keine Bestellung für unbekannte Kunden", () => {
    const ctx = buildContext(getTicket("T-1005")!);
    expect(ctx.order).toBeNull();
  });
});

describe("Routing-Entscheidung", () => {
  const triage = (over: Partial<Triage> = {}): Triage => ({
    category: "order_status",
    brand: "nedura",
    sentiment: "neutral",
    risk_flags: [],
    summary_de: "",
    confidence: 0.95,
    ...over,
  });
  const draft: Draft = { reply_de: "Hallo", facts_used: [], agent_wants_human: false, note_for_team: "" };
  const compliance = (verdict: "pass" | "revised" | "block"): ComplianceResult => ({
    rule_hits_draft: [],
    review: { verdict, issues: [], revised_reply_de: "" },
    rule_hits_final: [],
    final_reply_de: verdict === "block" ? "" : "Hallo",
  });
  const ctx = buildContext(getTicket("T-1001")!);

  it("einfacher Bestellstatus → sendefertig", () => {
    expect(decideStatus(triage(), ctx, draft, compliance("pass")).status).toBe("ready_to_send");
  });

  it("Gesundheitsfrage → immer Mensch", () => {
    const d = decideStatus(
      triage({ category: "health_question", risk_flags: ["health_condition", "medication"] }),
      ctx,
      draft,
      compliance("pass"),
    );
    expect(d.status).toBe("needs_review");
    expect(d.route_to).toBe("support_lead");
  });

  it("Compliance blockiert → blocked", () => {
    expect(decideStatus(triage(), ctx, draft, compliance("block")).status).toBe("blocked");
  });

  it("Händleranfrage → Vertrieb", () => {
    expect(decideStatus(triage({ category: "b2b_inquiry" }), ctx, draft, compliance("pass")).route_to).toBe("sales");
  });
});
