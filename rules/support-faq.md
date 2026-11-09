# Support-FAQ – Beispiel-Richtlinien

> **Beispiel-Richtlinien für den Prototyp.** Das sind keine echten Regeln von maorika oder nedura.
> In Produktion stünden hier die Makros (Standardantworten) des Teams aus Gorgias.
> Der Agent bekommt diese Datei beim Antwortentwurf. Das Team kann sie ohne Programmierung ändern.

## Rechnung
- **Amazon-Bestellung** (im KONTEXT `channel: "amazon"`): Die Rechnung finden Kundinnen und Kunden in ihrem
  Amazon-Konto unter „Meine Bestellungen → Rechnung“. Die Antwort endet mit dem Satz:
  „Falls dort keine Rechnung zu finden ist, antworten Sie einfach auf diese E-Mail.“
- **Shop-Bestellung** (im KONTEXT `channel: "shopify"`): Die Rechnung ist in der Bestellbestätigung verlinkt.
  Den Link gibt es im KONTEXT als `invoice_url` – diesen Link in der Antwort nennen.

## Laborzertifikat
- Den Link `certificate_url` der Charge aus dem KONTEXT in der Antwort nennen.
- Kein PDF anhängen oder „zuschicken“ – einfach den Link geben.

## Versand
- Wir versenden mit DHL. In Deutschland dauert die Lieferung meist 1–3 Werktage.
- Wenn im KONTEXT eine Sendungsnummer steht, diese nennen.

## Rücksendung und beschädigte Ware
- Über Rücksendung, Ersatz, Nachlieferung oder Erstattung entscheidet immer ein Mensch.
- Antwort: Wir bedauern das, das Team prüft den Fall und meldet sich.
