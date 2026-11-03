// Run the agent on the example tickets from the terminal.
//   npm run cli              → all tickets, prints a summary table
//   npm run cli -- T-1003    → one ticket, prints full details
//   npm run precompute       → all tickets, saves results to data/demo-results.json for the demo page

import "./load-env"; // first, so lib/llm.ts sees the variables from .env.local
import { listTickets } from "@/lib/data";
import { runAgent } from "@/lib/pipeline";
import { writeSavedResults } from "@/lib/saved-results";
import type { AgentResult } from "@/lib/types";

const args = process.argv.slice(2);
const save = args.includes("--save");
const ids = args.filter((a) => !a.startsWith("--"));
const tickets = ids.length ? listTickets().filter((t) => ids.includes(t.id)) : listTickets();

const ICON = { ready_to_send: "✅", needs_review: "🟡", blocked: "⛔" } as const;

async function main() {
  const results: Record<string, AgentResult> = {};
  for (const t of tickets) {
    process.stdout.write(`${t.id}  ${t.subject.padEnd(40).slice(0, 40)} … `);
    try {
      const r = await runAgent(t);
      results[t.id] = r;
      console.log(
        `${ICON[r.status]} ${r.status.padEnd(13)} ${r.triage.category.padEnd(17)} ${(r.meta.total_ms / 1000).toFixed(1)}s`,
      );
      if (ids.length) {
        const steps = Object.entries(r.meta.steps)
          .map(([name, m]) => `${name} ${(m.ms / 1000).toFixed(1)}s${m.output_tokens ? ` (${m.input_tokens}→${m.output_tokens} Tokens)` : ""}`)
          .join(" · ");
        console.log(`\nZeit pro Schritt: ${steps} · gesamt ${(r.meta.total_ms / 1000).toFixed(1)}s (${r.meta.model})`);
        console.log("\nEinordnung:", r.triage);
        console.log("\nRegel-Treffer im Entwurf:", r.compliance.rule_hits_draft);
        console.log("\nEntwurf:\n" + r.draft.reply_de);
        console.log("\nPrüfung:", r.compliance.review.verdict, r.compliance.review.issues);
        console.log("\nFinale Antwort:\n" + (r.compliance.final_reply_de || "(keine – manuell beantworten)"));
        console.log("\nGründe:", r.status_reasons, "→", r.route_to, "\n");
      }
    } catch (err) {
      console.log("❌ Fehler:", err instanceof Error ? err.message : err);
    }
  }
  if (save) {
    writeSavedResults(results);
    console.log(`\n${Object.keys(results).length} Ergebnisse gespeichert in data/demo-results.json`);
  }
}

main();
