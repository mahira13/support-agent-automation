// Email webhook. apps-script/GmailForwarder.gs posts every new email of the
// demo Gmail inbox here (JSON in Postmark's inbound format). Answers fast,
// then runs the agent in the background (see lib/background.ts for why
// `after()` is wrapped).
//
// Auth: ?token=... must equal INBOUND_WEBHOOK_TOKEN. Compared via hashing
// both sides to a fixed-length digest first, so the comparison time never
// depends on the token's length or how many characters match.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ignoreReason, parseInboundEmail, type InboundPayload } from "@/lib/inbound";
import { beginIntake, continueIntake } from "@/lib/intake";
import { runInBackground } from "@/lib/background";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function tokenMatches(given: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!tokenMatches(token, process.env.INBOUND_WEBHOOK_TOKEN ?? "")) {
    return NextResponse.json({ error: "Nicht autorisiert." }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as InboundPayload | null;
  if (!payload) return NextResponse.json({ ok: true });

  const email = parseInboundEmail(payload);
  const reason = ignoreReason(email);
  if (reason) {
    console.log(`[inbound-email] ignoriert: ${reason}`);
    return NextResponse.json({ ok: true, ignored: reason });
  }

  let begun;
  try {
    begun = await beginIntake({
      source: "email",
      senderId: email.fromEmail,
      subject: email.subject,
      body: email.body,
      messageId: email.messageId,
    });
  } catch (err) {
    // Store not readable right now. 5xx → the Gmail forwarder keeps the email unread and retries.
    console.error("[inbound-email] Speicher nicht erreichbar:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Speicher gerade nicht erreichbar." }, { status: 503 });
  }

  const { ticket_id, ticket } = begun;
  if (ticket) {
    const bg = runInBackground(() => continueIntake(ticket_id, ticket));
    if (bg) await bg; // only happens outside a real request scope (tests)
  }

  return NextResponse.json({ ok: true, ticket_id: ticket_id || undefined });
}
