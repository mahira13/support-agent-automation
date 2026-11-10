import { describe, expect, it } from "vitest";
import { findNewTickets, newTicketAction, type Selection } from "@/lib/new-tickets";

describe("findNewTickets", () => {
  it("erster Seitenaufruf: nichts ist neu, auch wenn schon Tickets da sind", () => {
    expect(findNewTickets(null, ["MAIL-2", "MAIL-1"])).toEqual([]);
  });

  it("neu = ID, die beim vorigen Abruf fehlte (neueste zuerst)", () => {
    expect(findNewTickets(new Set(["MAIL-1"]), ["WEB-3", "MAIL-2", "MAIL-1"])).toEqual(["WEB-3", "MAIL-2"]);
    expect(findNewTickets(new Set(["MAIL-1"]), ["MAIL-1"])).toEqual([]);
  });
});

describe("newTicketAction", () => {
  const views: [string, Selection][] = [
    ["Beispiel-Ticket", { kind: "example", id: "T-1003" }],
    ["anderes Live-Ticket", { kind: "live", id: "MAIL-1" }],
    ["Eigene Nachricht senden", { kind: "write" }],
    ["Wortliste live testen", { kind: "words" }],
  ];

  for (const [name, selection] of views) {
    it(`${name} offen, Besucher war da → kein Wechsel, nur Hinweis`, () => {
      expect(newTicketAction("MAIL-2", selection, false)).toEqual({ kind: "toast", id: "MAIL-2" });
    });
    it(`${name} offen, Tab war im Hintergrund → neue E-Mail öffnen`, () => {
      expect(newTicketAction("MAIL-2", selection, true)).toEqual({ kind: "open", id: "MAIL-2" });
    });
  }

  it("eigene Nachricht aus dem Formular ist schon geöffnet → nichts tun", () => {
    expect(newTicketAction("WEB-3", { kind: "live", id: "WEB-3" }, false)).toEqual({ kind: "none" });
    expect(newTicketAction("WEB-3", { kind: "live", id: "WEB-3" }, true)).toEqual({ kind: "none" });
  });
});
