// Everything the demo page needs, polled every few seconds for the live part.
import { NextResponse } from "next/server";
import { listTickets } from "@/lib/data";
import { loadSavedResults } from "@/lib/saved-results";
import { getStore, type StoredTicket } from "@/lib/store";
import { MODEL } from "@/lib/llm";
import { liveEnabled } from "@/lib/intake";

export const dynamic = "force-dynamic";

export async function GET() {
  const saved = loadSavedResults();

  // If the Sheet can't be read, still show the examples; the page says the live list is unavailable.
  let live: StoredTicket[] = [];
  let live_error = false;
  try {
    live = await getStore().listRecent(20);
  } catch (err) {
    console.error("[inbox] Live-Tickets nicht lesbar:", err instanceof Error ? err.message : err);
    live_error = true;
  }

  return NextResponse.json({
    live,
    live_error,
    examples: listTickets().map((ticket) => ({ ticket, result: saved[ticket.id] ?? null })),
    inbound_address: process.env.INBOUND_EMAIL_ADDRESS || null,
    sheet_public_url: process.env.SHEET_PUBLIC_URL || null,
    github_url: process.env.GITHUB_URL || null,
    model: MODEL,
    live_enabled: liveEnabled(),
    max_body_chars: Number(process.env.LIVE_BODY_MAX_CHARS || 2000),
  });
}
