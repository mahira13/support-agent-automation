// Thin wrapper around Next.js's `after()`.
//
// `after()` schedules work to run once the response has been sent, and it
// only works inside a real Next.js request (it reads request-scoped context
// that Next sets up internally). That means it throws when a route handler
// is invoked directly in a unit test, outside Next's server runtime.
//
// To keep routes testable without a running Next server (and without
// touching the network), this wrapper falls back to running the work
// immediately — and returns its promise — when `after()` isn't usable. Routes
// can then do `const bg = runInBackground(fn); if (bg) await bg;`: in
// production `after()` succeeds, `bg` is undefined, and the response is not
// delayed. In tests, the work runs inline and the test can await it.
import { after } from "next/server";

export function runInBackground(fn: () => Promise<void>): Promise<void> | undefined {
  try {
    after(fn);
    return undefined;
  } catch {
    return fn();
  }
}
