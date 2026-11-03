// The whole agent: triage → context → draft → compliance → routing decision.
// The routing decision at the end is plain code on purpose: business rules
// ("health questions always go to a human") should be explicit and testable,
// not hidden inside a prompt.

import { draftReply, triageTicket } from "./agent";
import { MODEL } from "./llm";
import { checkCompliance } from "./compliance";
import { buildContext } from "./data";
import type { AgentResult, ComplianceResult, Context, Draft, FinalStatus, Ticket, Triage } from "./types";

// Progress callback so a caller (the live inbound pipeline) can write each
// step to the store as it happens, for the live-ticking timeline on the page.
export type PipelineStep = "triage" | "context" | "draft" | "compliance" | "decision" | "error";
export type StepState = "running" | "done" | "error";
export type OnStep = (step: PipelineStep, state: StepState, label_de: string, detail?: unknown) => void | Promise<void>;

async function emit(onStep: OnStep | undefined, step: PipelineStep, state: StepState, label_de: string, detail?: unknown) {
  if (onStep) await onStep(step, state, label_de, detail);
}

const ROUTE_LABEL = { support: "Support-Team", support_lead: "Support-Lead", sales: "Vertrieb" } as const;

function contextLabel(context: Context): string {
  if (context.order) return `Bestellung ${context.order.order_number} gefunden`;
  if (context.batch) return `Charge ${context.batch.batch} gefunden`;
  return "Keine passende Bestellung gefunden";
}

function complianceLabel(compliance: ComplianceResult): string {
  if (compliance.review.verdict === "block") return "Blockiert: keine sichere Antwort möglich";
  if (compliance.review.verdict === "revised") {
    const quote = compliance.review.issues[0]?.quote;
    return quote ? `Heilversprechen entfernt: „${quote}“` : "Entwurf korrigiert";
  }
  return "Keine Probleme gefunden";
}

function decisionLabel(status: FinalStatus, route_to: AgentResult["route_to"]): string {
  if (status === "ready_to_send") return "Sendefertig";
  if (status === "blocked") return "Blockiert – an Team";
  return `Zur Prüfung an ${ROUTE_LABEL[route_to]}`;
}

const HUMAN_FLAGS = new Set([
  "health_condition",
  "medication",
  "pregnancy",
  "child_under_12_months",
  "child",
  "allergy",
  "money_request",
]);

export function decideStatus(
  triage: Triage,
  context: Context,
  draft: Draft,
  compliance: ComplianceResult,
): { status: FinalStatus; reasons: string[]; route_to: AgentResult["route_to"] } {
  const reasons: string[] = [];

  if (compliance.review.verdict === "block") {
    return {
      status: "blocked",
      reasons: ["Compliance: keine sichere Antwort möglich – bitte manuell beantworten"],
      route_to: "support_lead",
    };
  }

  if (compliance.review.verdict === "revised") reasons.push("Compliance hat den Entwurf korrigiert");
  for (const f of triage.risk_flags) if (HUMAN_FLAGS.has(f)) reasons.push(`Risiko-Flag: ${f}`);
  if (triage.category === "health_question") reasons.push("Gesundheitsfrage");
  if (triage.category === "b2b_inquiry") reasons.push("Händleranfrage → Vertrieb");
  if (["order_status", "damage_return", "cancellation", "invoice"].includes(triage.category) && !context.order)
    reasons.push("Keine passende Bestellung gefunden");
  if (triage.confidence < 0.7) reasons.push(`Unsichere Einordnung (${triage.confidence})`);
  if (draft.agent_wants_human) reasons.push("Agent empfiehlt menschliche Prüfung");

  const route_to =
    triage.category === "b2b_inquiry"
      ? "sales"
      : triage.risk_flags.some((f) => f !== "money_request") || triage.category === "health_question"
        ? "support_lead"
        : "support";

  return { status: reasons.length ? "needs_review" : "ready_to_send", reasons, route_to };
}

export async function runAgent(ticket: Ticket, onStep?: OnStep): Promise<AgentResult> {
  const started = Date.now();
  const steps: AgentResult["meta"]["steps"] = {};

  try {
    await emit(onStep, "triage", "running", "Ticket wird eingeordnet …");
    const triage = await triageTicket(ticket);
    steps.triage = triage.meta;
    await emit(onStep, "triage", "done", `Kategorie: ${triage.data.category}`, triage.data);

    await emit(onStep, "context", "running", "Suche Bestellung, Charge und Produkt …");
    const t0 = Date.now();
    const context = buildContext(ticket);
    steps.context = { ms: Date.now() - t0 };
    await emit(onStep, "context", "done", contextLabel(context), context);

    await emit(onStep, "draft", "running", "Antwortentwurf wird geschrieben …");
    const draft = await draftReply(ticket, triage.data, context);
    steps.draft = draft.meta;
    await emit(onStep, "draft", "done", "Entwurf fertig", draft.data);

    await emit(onStep, "compliance", "running", "Compliance-Prüfung läuft …");
    const compliance = await checkCompliance(ticket, draft.data);
    steps.compliance = compliance.meta;
    await emit(onStep, "compliance", "done", complianceLabel(compliance.result), compliance.result);

    const decision = decideStatus(triage.data, context, draft.data, compliance.result);
    await emit(onStep, "decision", "done", decisionLabel(decision.status, decision.route_to), decision);

    return {
      ticket,
      triage: triage.data,
      context,
      draft: draft.data,
      compliance: compliance.result,
      status: decision.status,
      status_reasons: decision.reasons,
      route_to: decision.route_to,
      meta: { model: MODEL, total_ms: Date.now() - started, steps },
    };
  } catch (err) {
    await emit(onStep, "error", "error", err instanceof Error ? err.message : "Unbekannter Fehler");
    throw err;
  }
}
