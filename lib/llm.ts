// One function for all AI calls: callStructured().
// The rest of the project does not know which model runs behind it.
//
//   LLM_PROVIDER=gemini     Google Gemini (free tier for own testing, no credit card)
//   LLM_PROVIDER=ollama     local open model on your laptop (free, offline)
//   LLM_PROVIDER=anthropic  Claude API (paid)
//   LLM_PROVIDER=openai     OpenAI API (paid, prepaid credit)
//
// Every provider must return JSON that matches the schema. The JSON is then checked
// with zod: if the model returns something unexpected, we fail loudly instead of
// sending a broken reply to a customer.

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { StepMeta } from "./types";

type Provider = "anthropic" | "gemini" | "ollama" | "openai";

export const PROVIDER: Provider = (() => {
  const p = (process.env.LLM_PROVIDER || "").toLowerCase();
  if (p === "anthropic" || p === "gemini" || p === "ollama" || p === "openai") return p;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "gemini";
})();

const MODELS: Record<Provider, string> = {
  anthropic: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
  gemini: process.env.GEMINI_MODEL || "gemini-3.8-flash",
  ollama: process.env.OLLAMA_MODEL || "qwen3:8b",
  openai: process.env.OPENAI_MODEL || "gpt-5-mini",
};
export const MODEL = `${PROVIDER} · ${MODELS[PROVIDER]}`;

/** True when this server can run the AI (key set or Ollama chosen). */
export function aiConfigured(): boolean {
  if (PROVIDER === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (PROVIDER === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (PROVIDER === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return true;
}

type CallOpts<T> = {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  inputSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  maxTokens?: number;
};

type Raw = { json: unknown; input_tokens?: number; output_tokens?: number };

export async function callStructured<T>(opts: CallOpts<T>): Promise<{ data: T; meta: StepMeta }> {
  const started = Date.now();
  const raw =
    PROVIDER === "anthropic"
      ? await callAnthropic(opts)
      : PROVIDER === "openai"
        ? await callOpenAI(opts)
        : PROVIDER === "gemini"
          ? await callGemini(opts)
          : await callOllama(opts);

  const parsed = opts.validator.safeParse(raw.json);
  if (!parsed.success) {
    throw new Error(`Ungültiges JSON vom Modell (${opts.toolName}): ${parsed.error.message}`);
  }
  return {
    data: parsed.data,
    meta: { ms: Date.now() - started, input_tokens: raw.input_tokens, output_tokens: raw.output_tokens },
  };
}

// ---------------- Claude (paid) ----------------

let anthropic: Anthropic | null = null;
async function callAnthropic<T>(opts: CallOpts<T>): Promise<Raw> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY fehlt (.env.local).");
  anthropic ??= new Anthropic();
  const res = await anthropic.messages.create({
    model: MODELS.anthropic,
    max_tokens: opts.maxTokens ?? 1500,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.inputSchema as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name: opts.toolName },
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error(`Kein strukturiertes Ergebnis für ${opts.toolName}.`);
  return { json: block.input, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
}

// ---------------- OpenAI (paid, prepaid credit) ----------------

async function callOpenAI<T>(opts: CallOpts<T>): Promise<Raw> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY fehlt (.env.local).");
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  // Reasoning models (gpt-5*, o1/o3/o4…) think before answering; "low" keeps a ticket well under
  // Vercel's 60 s limit. Other models reject the parameter, so it is only sent for these.
  const reasoning = /^(gpt-5|o)/i.test(MODELS.openai)
    ? { reasoning_effort: process.env.OPENAI_REASONING_EFFORT || "low" }
    : {};
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODELS.openai,
      ...reasoning,
      // Newer OpenAI models count hidden reasoning tokens here too, so leave headroom
      max_completion_tokens: (opts.maxTokens ?? 1500) * 3,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      tools: [
        {
          type: "function",
          function: { name: opts.toolName, description: opts.toolDescription, parameters: opts.inputSchema },
        },
      ],
      tool_choice: { type: "function", function: { name: opts.toolName } },
    }),
  });
  if (res.status === 429) throw new Error("OpenAI: Limit oder Guthaben erreicht (429).");
  if (!res.ok) throw new Error(`OpenAI Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error(`OpenAI hat kein strukturiertes Ergebnis für ${opts.toolName} geliefert.`);
  let json: unknown;
  try {
    json = JSON.parse(args);
  } catch {
    throw new Error(`OpenAI hat ungültiges JSON für ${opts.toolName} geliefert.`);
  }
  return { json, input_tokens: data?.usage?.prompt_tokens, output_tokens: data?.usage?.completion_tokens };
}

// ---------------- Gemini (free tier for own testing) ----------------

// Gemini accepts a subset of JSON Schema with upper-case type names.
function toGeminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toGeminiSchema);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (k === "minimum" || k === "maximum" || k === "additionalProperties") continue;
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "properties" && v && typeof v === "object")
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

async function callGemini<T>(opts: CallOpts<T>): Promise<Raw> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY fehlt (.env.local). Kostenlos unter aistudio.google.com.");
  const base = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
  const res = await fetch(`${base}/v1beta/models/${MODELS.gemini}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      tools: [
        {
          functionDeclarations: [
            { name: opts.toolName, description: opts.toolDescription, parameters: toGeminiSchema(opts.inputSchema) },
          ],
        },
      ],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [opts.toolName] } },
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 1500, temperature: 0.2 },
    }),
  });
  if (res.status === 429) throw new Error("Gemini: kostenloses Limit erreicht. Kurz warten und noch einmal versuchen.");
  if (!res.ok) throw new Error(`Gemini Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parts: { functionCall?: { name: string; args: unknown } }[] = data?.candidates?.[0]?.content?.parts ?? [];
  const call = parts.find((p) => p.functionCall)?.functionCall;
  if (!call) throw new Error(`Gemini hat kein strukturiertes Ergebnis für ${opts.toolName} geliefert.`);
  return {
    json: call.args,
    input_tokens: data?.usageMetadata?.promptTokenCount,
    output_tokens: data?.usageMetadata?.candidatesTokenCount,
  };
}

// ---------------- Ollama (local, free, offline) ----------------

async function callOllama<T>(opts: CallOpts<T>): Promise<Raw> {
  const base = process.env.OLLAMA_URL || "http://localhost:11434";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELS.ollama,
      stream: false,
      format: opts.inputSchema, // Ollama structured output: JSON Schema
      options: { temperature: 0.2, num_predict: opts.maxTokens ?? 1500 },
      messages: [
        { role: "system", content: `${opts.system}\n\nAntworte nur mit JSON nach dem vorgegebenen Schema.` },
        { role: "user", content: opts.user },
      ],
    }),
  }).catch(() => {
    throw new Error(`Ollama nicht erreichbar unter ${base}. Läuft "ollama serve"?`);
  });
  if (!res.ok) throw new Error(`Ollama Fehler ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let json: unknown;
  try {
    json = JSON.parse(data?.message?.content ?? "");
  } catch {
    throw new Error(`Ollama hat kein gültiges JSON für ${opts.toolName} geliefert.`);
  }
  return { json, input_tokens: data?.prompt_eval_count, output_tokens: data?.eval_count };
}
