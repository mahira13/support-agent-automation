"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentResult, ComplianceResult, Context, Draft, FinalStatus, RuleHit, Ticket, Triage } from "@/lib/types";
import type { StoredStep, StoredTicket } from "@/lib/store";

type ExampleEntry = { ticket: Ticket; result: AgentResult | null };

type InboxData = {
  live: StoredTicket[];
  live_error: boolean;
  examples: ExampleEntry[];
  inbound_address: string | null;
  sheet_public_url: string | null;
  github_url: string | null;
  model: string;
  live_enabled: boolean;
  max_body_chars: number;
};

type Selection = { kind: "example" | "live"; id: string } | { kind: "words" } | { kind: "write" };

const STATUS_TEXT: Record<FinalStatus, { icon: string; title: string; text: string }> = {
  ready_to_send: { icon: "✅", title: "Sendefertig", text: "Die Antwort kann so raus (in Produktion: Entwurf in Gorgias, ein Klick zum Senden)." },
  needs_review: { icon: "🟡", title: "Prüfung durch Mensch", text: "Der Entwurf ist fertig, aber ein Mensch soll ihn vor dem Senden lesen." },
  blocked: { icon: "⛔", title: "Blockiert", text: "Keine sichere Antwort möglich. Das Ticket geht ohne Entwurf an das Team." },
};

const ROUTE_TEXT: Record<string, string> = { support: "Support-Team", support_lead: "Support-Lead", sales: "Vertrieb" };

const STEP_ORDER: { key: string; label: string }[] = [
  { key: "received", label: "Empfangen" },
  { key: "triage", label: "Einordnung" },
  { key: "context", label: "Daten aus Shop & ERP" },
  { key: "draft", label: "Antwortentwurf" },
  { key: "compliance", label: "Compliance-Check" },
  { key: "decision", label: "Entscheidung" },
];

const WORD_LIST_EXAMPLES = [
  "Unser Schwarzkümmelöl hilft gegen Diabetes.",
  "Manuka Honig stärkt Ihr Immunsystem.",
  "Bitte reduzieren Sie Ihre Medikamente nicht ohne Ihre Ärztin.",
  "Ihr Paket ist mit DHL unterwegs.",
];

function highlight(text: string, hits: RuleHit[]) {
  if (!hits.length) return text;
  const parts: (string | React.ReactElement)[] = [];
  const words = [...new Set(hits.map((h) => h.match))].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${words.join("|")})`, "gi");
  text.split(re).forEach((part, i) => parts.push(i % 2 ? <mark key={i}>{part}</mark> : part));
  return parts;
}

function detailOf<T>(steps: StoredStep[], step: string): T | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].step === step && steps[i].state === "done") return steps[i].detail as T;
  }
  return undefined;
}

// A single shape the result view can render, built either from a saved
// example result or reconstructed live from a ticket's steps.
type ResultView = {
  idLabel: string;
  channel: string;
  fromLabel: string;
  subject: string;
  body: string;
  triage?: Triage;
  context?: Context;
  draft?: Draft;
  compliance?: ComplianceResult;
  status: FinalStatus | "processing";
  status_reasons: string[];
  route_to?: AgentResult["route_to"];
  metaLine: string;
  /** Set when the ticket never ran the agent at all (limit, live mode off, …). */
  notProcessedLabel?: string;
};

function exampleToView(ticket: Ticket, result: AgentResult): ResultView {
  return {
    idLabel: ticket.id,
    channel: ticket.channel,
    fromLabel: ticket.from_email,
    subject: ticket.subject,
    body: ticket.body,
    triage: result.triage,
    context: result.context,
    draft: result.draft,
    compliance: result.compliance,
    status: result.status,
    status_reasons: result.status_reasons,
    route_to: result.route_to,
    metaLine: `Gespeichertes Ergebnis eines echten Durchlaufs (${result.meta.model}) · ${(result.meta.total_ms / 1000).toFixed(1)} s`,
  };
}

function liveToView(t: StoredTicket): ResultView {
  const triage = detailOf<Triage>(t.steps, "triage");
  const context = detailOf<Context>(t.steps, "context");
  const draft = detailOf<Draft>(t.steps, "draft");
  const compliance = detailOf<ComplianceResult>(t.steps, "compliance");
  const decision = detailOf<{ status: FinalStatus; reasons: string[]; route_to: AgentResult["route_to"] }>(t.steps, "decision");
  const received = t.steps.find((s) => s.step === "received");
  const notProcessedLabel = !triage && t.status !== "processing" ? received?.label_de : undefined;
  const ms = Math.max(0, new Date(t.updated_at).getTime() - new Date(t.received_at).getTime());
  return {
    idLabel: t.ticket_id,
    channel: t.source,
    fromLabel: t.from_masked,
    subject: t.subject,
    body: t.body,
    triage,
    context,
    draft,
    compliance,
    status: (t.status as FinalStatus) || "processing",
    status_reasons: decision?.reasons ?? [],
    route_to: (t.route_to as AgentResult["route_to"]) || undefined,
    metaLine: triage ? `Live · ${(ms / 1000).toFixed(1)} s` : "Live",
    notProcessedLabel,
  };
}

function Timeline({ ticket }: { ticket: StoredTicket }) {
  const errorStep = ticket.steps.find((s) => s.step === "error");
  return (
    <ol className="timeline">
      {STEP_ORDER.map(({ key, label }) => {
        const matches = ticket.steps.filter((s) => s.step === key);
        const last = matches[matches.length - 1];
        if (!last) {
          if (ticket.status !== "processing") return null; // ticket already finished early, nothing more will happen
          return (
            <li key={key} className="pending">
              <span className="dot" />
              {label} …
            </li>
          );
        }
        return (
          <li key={key} className={last.state}>
            <span className="dot">{last.state === "running" ? <span className="spinner" /> : last.state === "error" ? "✕" : "✓"}</span>
            {last.label_de}
          </li>
        );
      })}
      {errorStep && (
        <li className="error">
          <span className="dot">✕</span>
          {errorStep.label_de}
        </li>
      )}
    </ol>
  );
}

function TicketPreview({ view }: { view: ResultView }) {
  return (
    <div className="ticket">
      <div className="meta">
        {view.idLabel} · {view.channel} · {view.fromLabel}
      </div>
      <h3>{view.subject}</h3>
      <p className="body">{view.body}</p>
    </div>
  );
}

function ResultPanels({ view }: { view: ResultView }) {
  if (view.notProcessedLabel) {
    return (
      <div className="panel empty" style={{ marginTop: 12 }}>
        {view.notProcessedLabel}
      </div>
    );
  }
  if (view.status === "processing" || !view.triage) {
    return (
      <div className="panel empty" style={{ marginTop: 12 }}>
        <span className="spinner" />
        Der Agent arbeitet noch …
      </div>
    );
  }
  const r = view;
  const status = STATUS_TEXT[r.status as FinalStatus];
  return (
    <>
      <div className={`status ${r.status}`}>
        <span className="icon">{status.icon}</span>
        <div>
          <strong>{status.title}</strong> {r.route_to && <>→ {ROUTE_TEXT[r.route_to]}</>}
          <div className="small">{status.text}</div>
          {r.status_reasons.length > 0 && <ul>{r.status_reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
          <div className="small" style={{ marginTop: 6 }}>{r.metaLine}</div>
        </div>
      </div>

      <div className="steps">
        <div className="panel step">
          <div className="step-head">
            <h4><span className="num">1</span>Einordnung</h4>
            <span className="who">KI</span>
          </div>
          <dl className="kv">
            <dt>Kategorie</dt><dd>{r.triage!.category}</dd>
            <dt>Marke</dt><dd>{r.triage!.brand}</dd>
            <dt>Stimmung</dt><dd>{r.triage!.sentiment}</dd>
            <dt>Risiken</dt>
            <dd>
              {r.triage!.risk_flags.length
                ? r.triage!.risk_flags.map((f) => <span key={f} className="tag risk">{f}</span>)
                : "keine"}
            </dd>
            <dt>Zusammenfassung</dt><dd>{r.triage!.summary_de}</dd>
            <dt>Sicherheit</dt><dd>{Math.round(r.triage!.confidence * 100)} %</dd>
          </dl>
        </div>

        <div className="panel step">
          <div className="step-head">
            <h4><span className="num">2</span>Daten aus Shop &amp; ERP</h4>
            <span className="who">Code, keine KI</span>
          </div>
          {r.context ? (
            <dl className="kv">
              <dt>Bestellung</dt>
              <dd>
                {r.context.order ? (
                  <>
                    {r.context.order.order_number} ({r.context.order.channel}) · {r.context.order.status}
                    {r.context.order.tracking_number && <> · {r.context.order.carrier} {r.context.order.tracking_number}</>}
                    <div className="small">gefunden über {r.context.order_found_by === "email" ? "E-Mail-Adresse" : "Bestellnummer im Text"}</div>
                  </>
                ) : "keine gefunden"}
              </dd>
              <dt>Charge</dt>
              <dd>{r.context.batch ? `${r.context.batch.batch} · ${r.context.batch.tested_value}` : "–"}</dd>
              <dt>Produkte</dt>
              <dd>
                {r.context.products.slice(0, 3).map((p) => <span key={p.sku} className="tag">{p.name}</span>)}
                {r.context.products.length > 3 && <span className="small"> +{r.context.products.length - 3} weitere</span>}
              </dd>
            </dl>
          ) : (
            <p className="small">noch keine Daten</p>
          )}
        </div>

        <div className="panel step">
          <div className="step-head">
            <h4><span className="num">3</span>Antwortentwurf</h4>
            <span className="who">KI</span>
          </div>
          {r.draft ? (
            <>
              <div className="reply">{highlight(r.draft.reply_de, r.compliance?.rule_hits_draft ?? [])}</div>
              {r.draft.note_for_team && <p className="small">Notiz fürs Team: {r.draft.note_for_team}</p>}
            </>
          ) : (
            <p className="small">noch kein Entwurf</p>
          )}
        </div>

        <div className="panel step">
          <div className="step-head">
            <h4><span className="num">4</span>Compliance-Check</h4>
            <span className="who">Wortliste + KI</span>
          </div>
          {r.compliance ? (
            <>
              <div className="cols">
                <div>
                  <div className="small">Ebene 1 · Wortliste</div>
                  {r.compliance.rule_hits_draft.length
                    ? r.compliance.rule_hits_draft.map((h, i) => (
                        <div key={i} className="issue"><q>{h.match}</q> – {h.reason}</div>
                      ))
                    : <p>Keine Treffer</p>}
                </div>
                <div>
                  <div className="small">Ebene 2 · KI-Prüfung: <strong>{r.compliance.review.verdict}</strong></div>
                  {r.compliance.review.issues.length
                    ? r.compliance.review.issues.map((x, i) => (
                        <div key={i} className="issue"><q>{x.quote}</q><div className="small">{x.rule}: {x.explanation_de}</div></div>
                      ))
                    : <p>Keine Probleme gefunden</p>}
                </div>
              </div>
              <div className="small" style={{ marginTop: 10 }}>Finale Antwort</div>
              <div className="reply">{r.compliance.final_reply_de || "— keine Antwort, Ticket geht an das Team —"}</div>
            </>
          ) : (
            <p className="small">noch keine Prüfung</p>
          )}
        </div>
      </div>
    </>
  );
}

function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    /* clipboard blocked – user can still select the text manually */
  });
}

export default function Page() {
  const [data, setData] = useState<InboxData | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: "example", id: "T-1003" });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [wordText, setWordText] = useState("");
  const [wordHits, setWordHits] = useState<RuleHit[] | null>(null);

  const [writeText, setWriteText] = useState("");
  const [sending, setSending] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const seenIds = useRef<Set<string> | null>(null);

  async function poll() {
    try {
      const res = await fetch("/api/inbox");
      const json: InboxData = await res.json();
      if (seenIds.current) {
        const freshlyArrived = json.live.map((t) => t.ticket_id).filter((id) => !seenIds.current!.has(id));
        if (freshlyArrived.length) {
          setNewIds((prev) => new Set([...prev, ...freshlyArrived]));
          for (const id of freshlyArrived) {
            setTimeout(() => setNewIds((prev) => { const next = new Set(prev); next.delete(id); return next; }), 4000);
          }
        }
      }
      seenIds.current = new Set(json.live.map((t) => t.ticket_id));
      setData(json);
      setError(null);
    } catch {
      setError("Der Posteingang konnte nicht geladen werden.");
    }
  }

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view: ResultView | null = useMemo(() => {
    if (!data) return null;
    if (selection.kind === "example") {
      const entry = data.examples.find((e) => e.ticket.id === selection.id);
      if (!entry) return null;
      return entry.result ? exampleToView(entry.ticket, entry.result) : null;
    }
    if (selection.kind === "live") {
      const t = data.live.find((t) => t.ticket_id === selection.id);
      return t ? liveToView(t) : null;
    }
    return null;
  }, [data, selection]);

  const liveTicket = selection.kind === "live" ? data?.live.find((t) => t.ticket_id === selection.id) : undefined;

  async function checkWords() {
    setError(null);
    try {
      const res = await fetch("/api/check-words", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: wordText }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `Fehler ${res.status}`);
      setWordHits(result.hits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    }
  }

  async function sendMessage() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: writeText }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? `Fehler ${res.status}`);
      setWriteText("");
      setSelection({ kind: "live", id: result.ticket_id });
      poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unbekannter Fehler");
    } finally {
      setSending(false);
    }
  }

  if (!data) return <main className="wrap">{error ?? <p className="empty"><span className="spinner" />Lade…</p>}</main>;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Support-Agent mit Compliance-Check</h1>
        </div>
        <div className="chips">
          <span className="chip warn">Prototyp · Beispieldaten</span>
          <span className="chip">KI · {data.model}</span>
          {!data.live_enabled && <span className="chip">Live-Modus aus</span>}
        </div>
      </header>
      <p className="sub">
        Idee für maorika &amp; nedura: Ein Agent liest Support-Tickets, sucht Bestellung und Charge, schreibt eine
        Antwort auf Deutsch und prüft sie auf Heilversprechen, bevor ein Mensch sie sieht. Alle Kundendaten hier sind
        erfunden.
      </p>

      {data.inbound_address && (
        <div className="banner">
          <div>
            Schreiben Sie eine E-Mail an <strong className="address">{data.inbound_address}</strong> – sie erscheint hier in ca. 1 Minute.
            <button className="btn ghost copy" onClick={() => { copyToClipboard(data.inbound_address!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? "Kopiert ✓" : "Adresse kopieren"}
            </button>
          </div>
          <p className="small" style={{ margin: "4px 0 0" }}>
            Ihre Nachricht ist hier für alle sichtbar. Ihre Adresse wird gekürzt angezeigt (z. B. j***@firma.de).
            Bitte schreiben Sie keine persönlichen Daten.
          </p>
        </div>
      )}

      <div className="grid">
        <aside className="panel">
          <h2>Live ({data.live.length})</h2>
          <ul className="inbox">
            {data.live_error && (
              <li className="empty-hint">Die Live-Tickets können gerade nicht geladen werden. Neuer Versuch in wenigen Sekunden.</li>
            )}
            {!data.live_error && data.live.length === 0 && (
              <li className="empty-hint">Noch keine Live-Tickets. E-Mail schreiben oder unten eine Nachricht senden.</li>
            )}
            {data.live.map((t) => (
              <li key={t.ticket_id}>
                <button
                  aria-pressed={selection.kind === "live" && selection.id === t.ticket_id}
                  className={newIds.has(t.ticket_id) ? "is-new" : ""}
                  onClick={() => setSelection({ kind: "live", id: t.ticket_id })}
                >
                  <div className="row1">
                    <span>{t.from_masked} · {t.source}</span>
                    <span>{t.status === "processing" ? <span className="spinner" /> : STATUS_TEXT[t.status as FinalStatus]?.icon ?? ""}</span>
                  </div>
                  <div className="subj">{t.subject}</div>
                </button>
              </li>
            ))}
          </ul>
          <ul className="inbox">
            <li>
              <button aria-pressed={selection.kind === "write"} onClick={() => setSelection({ kind: "write" })}>
                <div className="row1"><span>Eigene Nachricht senden</span><span>✏️</span></div>
                <div className="subj">Statt einer E-Mail: hier direkt schreiben</div>
              </button>
            </li>
            <li>
              <button aria-pressed={selection.kind === "words"} onClick={() => setSelection({ kind: "words" })}>
                <div className="row1"><span>Wortliste live testen</span><span>🔍</span></div>
                <div className="subj">Compliance Ebene 1, ohne KI</div>
              </button>
            </li>
          </ul>

          <h2>Beispiele ({data.examples.length})</h2>
          <p className="small examples-note">
            {data.examples.length} Beispiel-Tickets, darunter ein Versuch, den Agenten zu manipulieren.
          </p>
          <ul className="inbox">
            {data.examples.map(({ ticket, result }) => (
              <li key={ticket.id}>
                <button aria-pressed={selection.kind === "example" && selection.id === ticket.id} onClick={() => setSelection({ kind: "example", id: ticket.id })}>
                  <div className="row1">
                    <span>{ticket.id} · {ticket.channel}</span>
                    <span>{result ? STATUS_TEXT[result.status].icon : ""}</span>
                  </div>
                  <div className="subj">{ticket.subject}</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section>
          <div className="panel">
            {selection.kind === "words" ? (
              <div className="custom">
                <h3 style={{ margin: "0 0 6px" }}>Compliance-Wortliste live testen</h3>
                <p className="hint" style={{ margin: 0 }}>
                  Das ist Ebene 1 des Compliance-Checks. Sie läuft ohne KI, sofort und kostenlos.
                  Schreiben Sie einen Satz, wie ihn ein Support-Mitarbeiter schreiben könnte.
                </p>
                <div className="examples">
                  {WORD_LIST_EXAMPLES.map((e) => (
                    <button key={e} onClick={() => { setWordText(e); setWordHits(null); }}>{e}</button>
                  ))}
                </div>
                <textarea value={wordText} maxLength={1500} onChange={(e) => { setWordText(e.target.value); setWordHits(null); }} placeholder="z. B. Propolis wirkt antibakteriell." />
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                  <button className="btn" onClick={checkWords} disabled={!wordText.trim()}>Prüfen</button>
                  <span className="small">Ebene 2 (KI-Prüfung) sehen Sie in den Beispiel-Tickets.</span>
                </div>
                {wordHits && (
                  <div className={`status ${wordHits.length ? "blocked" : "ready_to_send"}`}>
                    <span className="icon">{wordHits.length ? "⛔" : "✅"}</span>
                    <div>
                      <strong>{wordHits.length ? `${wordHits.length} Treffer` : "Keine Treffer"}</strong>
                      <div className="reply">{highlight(wordText, wordHits)}</div>
                      {wordHits.map((h, i) => <div key={i} className="issue"><q>{h.match}</q> – {h.reason}</div>)}
                    </div>
                  </div>
                )}
              </div>
            ) : selection.kind === "write" ? (
              <div className="custom">
                <h3 style={{ margin: "0 0 6px" }}>Eigene Nachricht senden</h3>
                <p className="hint" style={{ margin: 0 }}>
                  {data.live_enabled
                    ? "Schreiben Sie wie eine Kundin oder ein Kunde. Die Nachricht läuft genau wie eine E-Mail durch den Agenten und erscheint oben bei „Live“."
                    : "Der Live-Modus ist auf diesem Server aus. Die Nachricht wird gespeichert, aber nicht von der KI bearbeitet."}
                </p>
                <textarea
                  value={writeText}
                  maxLength={data.max_body_chars}
                  onChange={(e) => setWriteText(e.target.value)}
                  placeholder="z. B. Hilft Schwarzkümmelöl bei Bluthochdruck?"
                />
                <div className="actions" style={{ padding: "10px 0 0" }}>
                  <button className="btn" onClick={sendMessage} disabled={sending || writeText.trim().length < 5}>
                    {sending ? <><span className="spinner" />Wird gesendet…</> : "Senden"}
                  </button>
                </div>
              </div>
            ) : (
              view && <TicketPreview view={view} />
            )}
          </div>

          {error && <div className="error">⚠️ {error}</div>}

          {selection.kind === "live" && liveTicket && (
            <div className="panel" style={{ marginTop: 12, padding: 14 }}>
              <div className="small" style={{ marginBottom: 6 }}>Ablauf</div>
              <Timeline ticket={liveTicket} />
            </div>
          )}

          {(selection.kind === "example" || selection.kind === "live") && !view && !error && (
            <div className="panel empty" style={{ marginTop: 12 }}>
              {selection.kind === "live" ? "Lade Ticket …" : "Für dieses Ticket gibt es noch kein gespeichertes Ergebnis."}
            </div>
          )}

          {(selection.kind === "example" || selection.kind === "live") && view && <ResultPanels view={view} />}
        </section>
      </div>

      <section className="panel how">
        <h3 style={{ margin: 0 }}>So funktioniert es</h3>
        <div className="flow">
          <span>E-Mail an Gmail</span><i>→</i>
          <span>Apps Script (jede Minute)</span><i>→</i>
          <span>Webhook</span><i>→</i>
          <span className="ai">1 Einordnung</span><i>→</i>
          <span>2 Shopify / Amazon / ERP</span><i>→</i>
          <span className="ai">3 Entwurf</span><i>→</i>
          <span>4a Wortliste</span><i>→</i>
          <span className="ai">4b Prüfung</span><i>→</i>
          <span>Regeln: senden / prüfen / blockieren</span><i>→</i>
          <span>Google Sheet + Live-Seite</span>
        </div>
        <p className="small" style={{ margin: 0 }}>
          Fakten (Bestellstatus, Sendungsnummer, Zertifikat) kommen immer aus dem Code, nie aus der KI.
          Die Entscheidung „senden oder Mensch“ ist eine feste Regel im Code, nicht im Prompt.
          Die Compliance-Regeln stehen in einer Textdatei, die das Team ohne Programmierung ändern kann.
          {data.sheet_public_url && (
            <> <a href={data.sheet_public_url} target="_blank" rel="noreferrer">Alle Live-Tickets im Google Sheet ansehen</a>.</>
          )}
          {data.github_url && (
            <> <a href={data.github_url} target="_blank" rel="noreferrer">Code auf GitHub</a>.</>
          )}
        </p>
      </section>
    </main>
  );
}
