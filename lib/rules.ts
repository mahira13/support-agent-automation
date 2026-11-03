// Layer 1 of the compliance check: fast, deterministic, free.
// It cannot be "talked out of" a finding, which is why the final reply must pass it
// even after the AI review.

import fs from "node:fs";
import path from "node:path";
import blockedJson from "@/rules/blocked-phrases.json";
import type { RuleHit } from "./types";

type BlockedPhrase = { id: string; pattern: string; reason: string };
const blocked = blockedJson as BlockedPhrase[];

// A reply like "Bitte reduzieren Sie Ihre Medikamente nicht" is fine.
// Simple negation check close to the match; the AI review is the second safety net.
const NEGATION = /\b(nicht|kein|keine|keinen|keinesfalls|niemals|nie)\b/i;
const WINDOW_BEFORE = 15;
const WINDOW_AFTER = 10;

export function checkRules(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  // Split into sentences so a negation in one sentence does not hide a claim in another
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    for (const rule of blocked) {
      const m = new RegExp(rule.pattern, "i").exec(sentence);
      if (!m) continue;
      const start = Math.max(0, m.index - WINDOW_BEFORE);
      const end = m.index + m[0].length + WINDOW_AFTER;
      if (NEGATION.test(sentence.slice(start, end))) continue;
      hits.push({ rule_id: rule.id, reason: rule.reason, match: m[0] });
    }
  }
  return hits;
}

let cachedRules: string | null = null;
export function loadRulesMarkdown(): string {
  if (cachedRules) return cachedRules;
  cachedRules = fs.readFileSync(path.join(process.cwd(), "rules", "compliance-rules.md"), "utf8");
  return cachedRules;
}
