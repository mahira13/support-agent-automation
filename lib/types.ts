import { z } from "zod";

// ---------- Mock data (would come from Gorgias / Shopify / ERP in production) ----------

export type Ticket = {
  id: string;
  channel: "email" | "chat" | string;
  from_email: string;
  subject: string;
  body: string;
  received_at: string;
};

export type OrderItem = { sku: string; qty: number; batch: string | null };

export type Order = {
  order_number: string;
  channel: "shopify" | "amazon" | string;
  customer_email: string;
  customer_name: string;
  created_at: string;
  status: "processing" | "shipped" | "delivered" | string;
  carrier: string | null;
  tracking_number: string | null;
  /** Shop orders: link from the order confirmation. Amazon orders: null (invoice is in the Amazon account). */
  invoice_url: string | null;
  items: OrderItem[];
};

export type Product = {
  sku: string;
  brand: "maorika" | "nedura";
  name: string;
  type: string;
  usage_note: string;
};

export type Batch = {
  batch: string;
  sku: string;
  tested_value: string;
  lab: string;
  test_date: string;
  certificate_url: string;
};

// ---------- Step 1: triage (AI, structured output) ----------

export const CATEGORIES = [
  "order_status",
  "batch_certificate",
  "damage_return",
  "product_usage",
  "health_question",
  "cancellation",
  "invoice",
  "b2b_inquiry",
  "other",
] as const;

export const RISK_FLAGS = [
  "health_condition",
  "medication",
  "pregnancy",
  "child_under_12_months",
  "child",
  "allergy",
  "money_request",
] as const;

export const TriageSchema = z.object({
  category: z.enum(CATEGORIES),
  brand: z.enum(["maorika", "nedura", "unknown"]),
  sentiment: z.enum(["positive", "neutral", "frustrated", "angry"]),
  risk_flags: z.array(z.enum(RISK_FLAGS)),
  summary_de: z.string(),
  confidence: z.number().min(0).max(1),
});
export type Triage = z.infer<typeof TriageSchema>;

// ---------- Step 2: context lookup (plain code, no AI) ----------

export type Context = {
  order: Order | null;
  order_found_by: "order_number" | "email" | null;
  products: Product[];
  batch: Batch | null;
};

// ---------- Step 3: draft reply (AI) ----------

export const DraftSchema = z.object({
  reply_de: z.string(),
  facts_used: z.array(z.string()),
  agent_wants_human: z.boolean(),
  note_for_team: z.string(),
});
export type Draft = z.infer<typeof DraftSchema>;

// ---------- Step 4: compliance (rules + AI) ----------

export type RuleHit = { rule_id: string; reason: string; match: string };

export const ComplianceSchema = z.object({
  verdict: z.enum(["pass", "revised", "block"]),
  issues: z.array(
    z.object({
      quote: z.string(),
      rule: z.string(),
      explanation_de: z.string(),
    }),
  ),
  revised_reply_de: z.string(),
});
export type ComplianceReview = z.infer<typeof ComplianceSchema>;

export type ComplianceResult = {
  rule_hits_draft: RuleHit[];
  review: ComplianceReview;
  rule_hits_final: RuleHit[];
  final_reply_de: string;
};

// ---------- Final result ----------

export type FinalStatus = "ready_to_send" | "needs_review" | "blocked";

export type StepMeta = { ms: number; input_tokens?: number; output_tokens?: number };

export type AgentResult = {
  ticket: Ticket;
  triage: Triage;
  context: Context;
  draft: Draft;
  compliance: ComplianceResult;
  status: FinalStatus;
  status_reasons: string[];
  route_to: "support" | "support_lead" | "sales";
  meta: { model: string; total_ms: number; steps: Record<string, StepMeta> };
};
