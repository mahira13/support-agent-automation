import { describe, expect, it } from "vitest";
import { ignoreReason, parseInboundEmail } from "@/lib/inbound";

describe("parseInboundEmail", () => {
  it("nutzt StrippedTextReply, wenn vorhanden", () => {
    const email = parseInboundEmail({
      FromFull: { Email: "k.weber@example.com", Name: "Klaus Weber" },
      Subject: "Frage",
      StrippedTextReply: "Hier ist meine Frage.",
      TextBody: "Hier ist meine Frage.\n\n> Am ... schrieb Support:\nAlter Verlauf",
      MessageID: "abc-123",
      Date: "2026-11-03T10:00:00Z",
    });
    expect(email.body).toBe("Hier ist meine Frage.");
    expect(email.fromEmail).toBe("k.weber@example.com");
    expect(email.messageId).toBe("abc-123");
  });

  it("fällt auf TextBody zurück, wenn StrippedTextReply fehlt", () => {
    const email = parseInboundEmail({
      FromFull: { Email: "a@example.com" },
      TextBody: "Nur TextBody vorhanden.",
    });
    expect(email.body).toBe("Nur TextBody vorhanden.");
  });

  it("fällt auf von HTML befreiten Text zurück, wenn nur HtmlBody da ist", () => {
    const email = parseInboundEmail({
      FromFull: { Email: "a@example.com" },
      HtmlBody: "<p>Hallo <b>Welt</b></p><p>Zweite Zeile</p>",
    });
    expect(email.body).toContain("Hallo");
    expect(email.body).toContain("Welt");
    expect(email.body).toContain("Zweite Zeile");
    expect(email.body).not.toContain("<");
  });

  it("baut aus Headers eine Map (Groß-/Kleinschreibung egal)", () => {
    const email = parseInboundEmail({
      FromFull: { Email: "a@example.com" },
      TextBody: "Hallo",
      Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }],
    });
    expect(email.headers["auto-submitted"]).toBe("auto-replied");
  });
});

describe("ignoreReason", () => {
  const base = {
    fromEmail: "kundin@example.com",
    fromName: "Kundin",
    subject: "Frage",
    body: "Ich habe eine Frage.",
    messageId: "m-1",
    receivedAt: "2026-11-03T10:00:00Z",
    headers: {} as Record<string, string>,
  };

  it("verarbeitet eine normale Kundennachricht", () => {
    expect(ignoreReason(base)).toBeNull();
  });

  it("ignoriert Auto-Submitted ungleich 'no'", () => {
    expect(ignoreReason({ ...base, headers: { "auto-submitted": "auto-replied" } })).toMatch(/Auto-Submitted/);
  });

  it("verarbeitet Auto-Submitted: no normal", () => {
    expect(ignoreReason({ ...base, headers: { "auto-submitted": "no" } })).toBeNull();
  });

  it("ignoriert X-Autoreply", () => {
    expect(ignoreReason({ ...base, headers: { "x-autoreply": "yes" } })).toMatch(/X-Autoreply/);
  });

  it("ignoriert X-Autorespond", () => {
    expect(ignoreReason({ ...base, headers: { "x-autorespond": "yes" } })).toMatch(/X-Autorespond/);
  });

  it("ignoriert Precedence: bulk/list/junk", () => {
    expect(ignoreReason({ ...base, headers: { precedence: "bulk" } })).toMatch(/Precedence/);
    expect(ignoreReason({ ...base, headers: { precedence: "list" } })).toMatch(/Precedence/);
    expect(ignoreReason({ ...base, headers: { precedence: "junk" } })).toMatch(/Precedence/);
  });

  it("ignoriert mailer-daemon und noreply Absender", () => {
    expect(ignoreReason({ ...base, fromEmail: "mailer-daemon@example.com" })).toMatch(/automatischer Absender/);
    expect(ignoreReason({ ...base, fromEmail: "noreply@example.com" })).toMatch(/automatischer Absender/);
  });

  it("ignoriert leeren Text", () => {
    expect(ignoreReason({ ...base, body: "   " })).toMatch(/leerer Text/);
  });
});
