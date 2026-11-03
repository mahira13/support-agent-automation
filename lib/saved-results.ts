// Saved agent results for the example tickets (created with `npm run precompute`).
// They let the demo show the examples instantly, without spending API credit.

import fs from "node:fs";
import path from "node:path";
import type { AgentResult } from "./types";

const FILE = path.join(process.cwd(), "data", "demo-results.json");

export function loadSavedResults(): Record<string, AgentResult> {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

export function writeSavedResults(results: Record<string, AgentResult>) {
  fs.writeFileSync(FILE, JSON.stringify(results, null, 2) + "\n", "utf8");
}
