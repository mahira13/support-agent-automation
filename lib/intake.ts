// Shared entry point for a live ticket, whatever channel it came from
// (email webhook or the on-page form). Both routes call these two
// functions so there is exactly one place that creates tickets, applies
// limits, and runs the agent — no separate "demo" code path.
//
// Split in two so a route can respond fast (beginIntake) and do the slow
// AI work afterwards (continueIntake), via lib/background.ts.

import { hashSender, maskEmail } from "./privacy";
import { runAgent } from "./pipeline";
import { aiConfigured } from "./llm";
import { getStore, safeWrite } from "./store";
import type { Ticket } from "./types";

export type IntakeSource = "email" | "web";

export type IntakeInput = {
  source: IntakeSource;
  /** Email address for "email", client IP for "web" — used only to mask/hash, never stored raw. */
  senderId: string;
  subject: string;
  body: string;
  /** Email Message-ID, for dedupe. Omit for web submissions. */
  messageId?: string;
};

// Read on every call (not once at import) so tests can change them.
function limits() {
  return {
    bodyMaxChars: Number(process.env.LIVE_BODY_MAX_CHARS || 2000),
    daily: Number(process.env.LIVE_DAILY_LIMIT || 60),
    perSenderHour: Number(process.env.LIVE_PER_SENDER_HOUR || 5),
  };
}

export function liveEnabled(): boolean {
  return process.env.ENABLE_LIVE === "true" && aiConfigured();
}

function newTicketId(source: IntakeSource): string {
  const prefix = source === "email" ? "MAIL" : "WEB";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function fromDisplay(source: IntakeSource, senderId: string): string {
  return source === "email" ? maskEmail(senderId) : "Formular-Besucher";
}

export type BeginResult = { ticket_id: string; ticket: Ticket | null };

/**
 * Fast part: dedupe, apply limits, create the ticket row. Returns a Ticket to
 * run the agent on only when everything is fine; otherwise the ticket is
 * already stored with an explanatory step and `ticket` is null.
 *
 * Throws only if the store can't be READ (dedupe / limit counts). That happens
 * before anything is written, so the caller can answer 503 and the Gmail
 * forwarder simply tries again a minute later.
 */
export async function beginIntake(input: IntakeInput): Promise<BeginResult> {
  const store = getStore();
  const limit = limits();
  // Server time, not the email's Date header: a sender could fake that header
  // to slip past the daily count.
  const received_at = new Date().toISOString();
  const body = input.body.slice(0, limit.bodyMaxChars);
  const subject = input.subject.slice(0, 300);

  if (input.messageId && (await store.hasMessageId(input.messageId))) {
    console.log(`[intake] doppelte MessageID, ignoriert: ${input.messageId}`);
    return { ticket_id: "", ticket: null };
  }

  const ticket_id = newTicketId(input.source);
  const sender_hash = hashSender(input.senderId);
  const live = liveEnabled();

  // Count BEFORE creating this ticket: "limit 5" = 5 tickets are processed, the 6th is not.
  let overLimit: { dailyCount: number; senderCount: number } | null = null;
  if (live) {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [dailyCount, senderCount] = await Promise.all([
      store.countSince(dayStart.toISOString()),
      store.countSince(hourAgo, sender_hash),
    ]);
    if (dailyCount >= limit.daily || senderCount >= limit.perSenderHour) overLimit = { dailyCount, senderCount };
  }

  await safeWrite("createTicket", () =>
    store.createTicket({
      ticket_id,
      received_at,
      source: input.source,
      from_masked: fromDisplay(input.source, input.senderId),
      subject,
      body,
      status: "processing",
      route_to: "",
      final_reply: "",
      sender_hash,
      message_id: input.messageId ?? "",
    }),
  );

  if (!live) {
    await safeWrite("addStep", () => store.addStep(ticket_id, "received", "done", "Live-Modus aus"));
    await safeWrite("finishTicket", () => store.finishTicket(ticket_id, { status: "blocked", route_to: "support", final_reply: "" }));
    return { ticket_id, ticket: null };
  }

  if (overLimit) {
    await safeWrite("addStep", () =>
      store.addStep(ticket_id, "received", "done", "Limit erreicht – nicht verarbeitet", overLimit),
    );
    await safeWrite("finishTicket", () => store.finishTicket(ticket_id, { status: "blocked", route_to: "support", final_reply: "" }));
    return { ticket_id, ticket: null };
  }

  await safeWrite("addStep", () => store.addStep(ticket_id, "received", "done", "Ticket empfangen"));

  const ticket: Ticket = {
    id: ticket_id,
    channel: input.source,
    from_email: input.source === "email" ? input.senderId : "formular@demo.local",
    subject,
    body,
    received_at,
  };
  return { ticket_id, ticket };
}

/** Slow part: run the agent, writing each step as it happens, then finish the ticket. */
export async function continueIntake(ticket_id: string, ticket: Ticket): Promise<void> {
  const store = getStore();
  try {
    const result = await runAgent(ticket, async (step, state, label_de, detail) => {
      await safeWrite("addStep", () => store.addStep(ticket_id, step, state, label_de, detail));
    });
    await safeWrite("finishTicket", () =>
      store.finishTicket(ticket_id, {
        status: result.status,
        route_to: result.route_to,
        final_reply: result.compliance.final_reply_de,
      }),
    );
  } catch (err) {
    console.error(`[intake] Agent-Fehler für ${ticket_id}:`, err instanceof Error ? err.message : err);
    await safeWrite("finishTicket", () => store.finishTicket(ticket_id, { status: "blocked", route_to: "support", final_reply: "" }));
  }
}
