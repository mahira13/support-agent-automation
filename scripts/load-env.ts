// Loads .env.local (or .env) for the CLI scripts. Must be the FIRST import of a
// script: imports run before the script's own code, and lib/llm.ts reads
// process.env when it is imported. Variables already set in the shell win.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
    break;
  } catch {
    /* file not there */
  }
}
