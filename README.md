# Support-Agent mit Compliance-Check – Prototyp für maorika & nedura

**Demo:** https://DEINE-APP.vercel.app · **Live-Tickets im Google Sheet:** [Google Sheet](https://LINK-ZUM-SHEET)

Ein KI-Agent für den Kundenservice. Er liest eine Kunden-E-Mail, sucht Bestellung und Charge, schreibt eine Antwort
auf Deutsch und prüft sie auf **Heilversprechen**, bevor ein Mensch sie sieht.

> Prototyp mit **erfundenen Beispieldaten**. Ich habe keinen Zugang zu echten Systemen von maorika oder nedura.
> Produktnamen sind öffentlich (Shop Apotheke, dm). Bestellungen, Kunden und Chargen sind ausgedacht.

## Probieren Sie es aus: Schreiben Sie eine echte E-Mail

Schreiben Sie eine E-Mail an **DEMO-EMAIL@gmail.com**. Nach ca. 1 Minute erscheint sie auf der
[Demo-Seite](https://DEINE-APP.vercel.app). Dort sehen Sie, wie der Agent Schritt für Schritt arbeitet.

- Ihre Nachricht ist auf der Seite für alle sichtbar. Ihre Adresse wird gekürzt (z. B. `j***@firma.de`).
  Die volle Adresse wird nirgends gespeichert. Bitte schreiben Sie keine persönlichen Daten.
- Sie bekommen **keine Antwort-E-Mail**. Die Antwort des Agenten sehen Sie nur auf der Seite.
- Ohne E-Mail geht es auch: Auf der Seite können Sie eine Nachricht direkt eintippen. Sie läuft durch denselben Code.

## Warum dieses Problem?

Bei der Recherche habe ich drei Dinge gesehen:

1. **Viele Kundenstimmen.** nedura hat bei Trusted Shops fast 900 Bewertungen, fast alle aus den letzten 12 Monaten.
   Viele Bewertungen bedeuten auch viele Support-Anfragen.
2. **Kunden fragen nach Krankheiten.** In Bewertungen schreiben Kunden über Diabetes oder Ekzeme. Eine schnelle
   KI-Antwort ist hier gefährlich: Ein Satz wie „hilft gegen Diabetes“ ist für Nahrungsergänzungsmittel nicht
   erlaubt (Health-Claims-Verordnung).
3. **Jede Charge ist laborgeprüft.** Kunden fragen nach dem Laborzertifikat. Diese Antwort kann ein Agent sicher
   und schnell geben.

Darum: schnell bei einfachen Fragen, **streng** bei Gesundheitsfragen.

## So funktioniert es

```
E-Mail an die Demo-Adresse (Gmail)
   │
   ▼
apps-script/GmailForwarder.gs   läuft jede Minute im Demo-Gmail-Konto
   │  POST /api/inbound-email?token=…   (JSON im Inbound-Format von Postmark)
   ▼
Next.js-Webhook   prüft Token, filtert Auto-Replies/Newsletter/Duplikate, prüft Limits
   │  antwortet sofort mit 200 ──► Forwarder markiert die E-Mail als gelesen
   ▼  (läuft danach weiter, mit after() aus next/server)
Agent
   ├─ empfangen
   ├─ 1. Einordnung ............ KI (Kategorie, Risiken)
   ├─ 2. Daten ................. Code: Bestellung, Charge, Produkt (Beispieldaten als JSON)
   ├─ 3. Antwortentwurf ........ KI (nur Fakten aus Schritt 2)
   ├─ 4. Compliance ............ Wortliste (Code) + KI-Prüfung – die Wortliste hat das letzte Wort
   └─ 5. Entscheidung .......... Code: sendefertig / Prüfung durch Mensch / blockiert
   │
   ▼  (jeder Schritt wird sofort geschrieben)
Google Sheet   über apps-script/Code.gs (Apps-Script-Web-App)
   │
   ▼
Demo-Seite   fragt alle 3 Sekunden /api/inbox ab und zeigt neue Tickets und Schritte live
```

Das Textfeld auf der Seite (`/api/submit`) nutzt **dieselbe** Funktion wie der Webhook, mit denselben Limits.

## Meine wichtigsten Entscheidungen

| Entscheidung | Warum |
|---|---|
| **Webhook antwortet zuerst, arbeitet danach** | Der Agent braucht mehrere KI-Aufrufe (10–20 Sekunden). Der Absender des Webhooks soll nicht so lange warten. Darum antwortet der Webhook sofort mit 200 und der Agent läuft danach in `after()` weiter. |
| **Fakten kommen aus Code, nicht aus der KI** | Sendungsnummer, Bestellstatus und Zertifikat-Link darf ein Modell nie raten. Schritt 2 ist normaler Code (`lib/data.ts`). |
| **Der Compliance-Check ist Code** | Zwei Ebenen: Die Wortliste ist schnell und kostet nichts. Die KI findet versteckte Aussagen („viele Kunden berichten, dass …“). Die Wortliste hat das letzte Wort: Die KI kann sie nicht überstimmen. Auch „senden oder Mensch“ ist eine feste Regel im Code (`lib/pipeline.ts`) und getestet. Gesundheit, Medikamente, Schwangerschaft, Kinder, Geld → immer ein Mensch. |
| **Die E-Mail ist nicht vertrauenswürdig** | Jeder kann der Demo-Adresse schreiben, auch „Ignoriere alle Regeln …“. Der Kundentext steht in jedem Prompt zwischen klaren Markierungen, mit dem Hinweis: Das ist Lesestoff, keine Anweisung. Und die Wortliste prüft die fertige Antwort trotzdem. Ein Beispiel-Ticket (T-1013) testet genau das: Es endet nie als „sendefertig“. |
| **Warum Google Sheets** | Das Team kann das Sheet ohne technisches Wissen öffnen, filtern und lesen. Jeder Schritt des Agenten steht dort als eigene Zeile. Nachteil: Sheets ist langsam und hat Limits (siehe unten). |
| **Warum eine Gmail-Weiterleitung** | Für die Demo braucht es keinen E-Mail-Dienst: Ein kleines Apps Script holt jede Minute neue E-Mails ab. In Produktion würde Gorgias denselben Webhook direkt aufrufen, ohne Verzögerung. Der Webhook bleibt gleich. |
| **Strukturierte Antworten** | Jeder KI-Aufruf muss JSON nach Schema liefern (Function Calling + zod). Falsches Format = Fehler, keine kaputte Antwort an Kunden. |
| **KI-Anbieter austauschbar** | Alle KI-Aufrufe laufen über eine Funktion (`lib/llm.ts`). OpenAI ist Standard. Claude, Gemini oder ein lokales Modell (Ollama) gehen auch – eine Zeile in `.env`. |
| **Schutz für die öffentliche Demo** | Token im Webhook-Link (Vergleich in konstanter Zeit), höchstens 60 Tickets pro Tag und 5 pro Absender und Stunde, Text wird nach 2.000 Zeichen abgeschnitten. Die KI läuft nur, wenn `ENABLE_LIVE=true` gesetzt ist. |

## Was die Demo zeigt

- **Live:** Ihre E-Mail oder Ihre Nachricht aus dem Textfeld, mit Zeitleiste (Spinner, solange ein Schritt läuft).
  Neue Tickets stehen oben und leuchten kurz auf.
- **Beispiele:** 13 Beispiel-Tickets, darunter ein Versuch, den Agenten zu manipulieren (T-1013). Zu jedem
  Ticket gibt es das gespeicherte Ergebnis eines echten Durchlaufs.
- **Wortliste live testen:** Ebene 1 des Compliance-Checks, ohne KI, sofort und kostenlos.

## Grenzen (ehrlich)

- **Ca. 1 Minute Verzögerung.** Das Gmail-Script läuft nur einmal pro Minute. Mit Gorgias wäre es sofort.
- **Google Sheets ist langsam und begrenzt.** Jeder Schritt ist ein eigener Aufruf an das Apps Script
  (oft eine Sekunde oder mehr), und Google begrenzt die Zahl der Aufrufe. Für eine Demo reicht das, für viele
  Tickets gleichzeitig nicht.
- **Bestelldaten sind erfunden.** Bestellungen, Chargen und Produkte kommen aus JSON-Dateien in `data/`. In Produktion
  würde `lib/data.ts` die **Shopify Admin API**, die **Amazon SP-API** und das **ERP** abfragen. Der Rest des Agenten
  bleibt gleich.
- **Keine Antwort-E-Mails.** Es wird nichts an den Kunden geschickt. Die Antwort steht nur auf der Seite und im Sheet.
- **Einfache Verneinung in der Wortliste.** Sie schaut nur in der Nähe eines Treffers nach „nicht“, „kein“ usw.
  Ein Satz wie „kein Arzneimittel, hilft aber gegen …“ kann durchrutschen. Dafür gibt es die KI-Prüfung, aber die
  Liste sollte mit echten Tickets wachsen.
- **Rechtliches:** Die Compliance-Regeln sind ein vereinfachtes Beispiel, keine Rechtsberatung.

## Lokal starten

```bash
npm install
cp .env.example .env.local      # KI-Schlüssel eintragen (Standard: OpenAI)
npm test                        # Tests, ohne API-Key und ohne Internet
npm run cli                     # alle Beispiel-Tickets im Terminal
npm run cli -- T-1003           # ein Ticket mit allen Details
npm run precompute              # Ergebnisse der Beispiele speichern (data/demo-results.json)
npm run dev                     # http://localhost:3000
```

Ohne `SHEET_API_URL` speichert die App die Live-Tickets im Arbeitsspeicher (`MemoryStore`). Das ist gut zum Testen,
aber nach einem Neustart sind sie weg. Ohne `ENABLE_LIVE=true` wird jedes Ticket nur gespeichert („Live-Modus aus“)
und nicht an die KI geschickt.

Webhook ohne echte E-Mail testen (schickt dasselbe JSON wie die Gmail-Weiterleitung):

```bash
./scripts/send-test-email-webhook.sh http://localhost:3000 dein-webhook-token
```

Die Einrichtung von Google Sheet, Gmail und Vercel steht Schritt für Schritt in [docs/SETUP-EN.md](docs/SETUP-EN.md).

## Projektstruktur

```
app/page.tsx                  Demo-Seite (Live, Beispiele, Wortliste)
app/api/inbound-email/        Webhook für E-Mails (Token, Filter, Limits, after())
app/api/submit/               Textfeld auf der Seite – derselbe Ablauf wie der Webhook
app/api/inbox/                Daten für die Seite (Live-Tickets, Beispiele, Einstellungen)
app/api/check-words/          Wortliste ohne KI testen
lib/intake.ts                 Gemeinsamer Einstieg: Duplikate, Limits, Ticket anlegen, Agent starten
lib/inbound.ts                E-Mail-JSON → Ticket, erkennt Auto-Replies, Newsletter, noreply
lib/pipeline.ts               Ablauf des Agenten + Entscheidung (senden / Mensch / blockiert)
lib/agent.ts                  KI: Einordnung und Antwortentwurf
lib/compliance.ts             Compliance-Check (Wortliste + KI)
lib/rules.ts                  Wortliste (Regex)
lib/data.ts                   Datenzugriff (heute JSON, später Shopify / Amazon / ERP)
lib/llm.ts                    Ein Zugang für alle KI-Anbieter (OpenAI, Claude, Gemini, Ollama)
lib/store.ts                  Google Sheet (SheetStore) + Arbeitsspeicher (MemoryStore)
lib/privacy.ts                Adresse maskieren, Absender-Hash für Limits
lib/background.ts             Hülle um after(), damit die Routen ohne Server testbar sind
apps-script/Code.gs           Apps-Script-Web-App: schreibt und liest das Google Sheet
apps-script/GmailForwarder.gs Apps Script im Demo-Gmail-Konto: schickt neue E-Mails an den Webhook
rules/                        Compliance-Regeln (für Menschen lesbar, ohne Programmierung änderbar)
data/                         Beispieldaten (erfunden) + gespeicherte Ergebnisse der Beispiele
scripts/                      CLI und Test-Skript für den Webhook
tests/                        Tests: Wortliste, Routing, E-Mail-JSON, Filter, Limits, Store, Webhook, Prompt-Injection
docs/SETUP-EN.md              Einrichtung Schritt für Schritt (Englisch)
```

## Nächster Schritt: Phase 2

Heute ist der Ablauf fest: Einordnung → Daten → Entwurf → Prüfung → Entscheidung. In Phase 2 wählt der Agent seine
Werkzeuge selbst (z. B. „Bestellung suchen“, „Zertifikat holen“, „Sendung verfolgen“) und entscheidet, was er für
ein Ticket braucht. Die Compliance-Prüfung und die Regel „senden oder Mensch“ bleiben fester Code am Ende.

---
Gebaut von Mahira Ahmad mit Claude Code. Die gespeicherten Beispiel-Ergebnisse wurden mit [MODELL EINTRAGEN] erzeugt. · [GitHub](https://github.com/mahira13)
