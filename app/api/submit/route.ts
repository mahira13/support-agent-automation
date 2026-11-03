// Text box on the demo page ("write your own message instead of an email").
// Goes through the exact same intake as the email webhook (same functions,
// same limits) — just with source "web" and the client IP (hashed, never
// stored) standing in for a sender identity.
import { NextResponse } from "next/server";
import { z } from "zod";
import { beginIntake, continueIntake } from "@/lib/intake";
import { runInBackground } from "@/lib/background";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(4000),
});

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bitte einen Text eingeben." }, { status: 400 });

  let begun;
  try {
    begun = await beginIntake({
      source: "web",
      senderId: clientIp(req),
      subject: parsed.data.subject?.trim() || "Testanfrage über das Formular",
      body: parsed.data.body.trim(),
    });
  } catch (err) {
    console.error("[submit] Speicher nicht erreichbar:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Gerade nicht möglich. Bitte in einer Minute noch einmal versuchen." }, { status: 503 });
  }

  const { ticket_id, ticket } = begun;
  if (ticket) {
    const bg = runInBackground(() => continueIntake(ticket_id, ticket));
    if (bg) await bg; // only happens outside a real request scope (tests)
  }

  return NextResponse.json({ ticket_id });
}
