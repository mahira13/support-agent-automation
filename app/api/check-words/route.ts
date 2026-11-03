// Free live check without any AI: runs only the word list (compliance layer 1).
// Visitors can test it on the public demo at zero cost.
import { NextResponse } from "next/server";
import { checkRules } from "@/lib/rules";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.slice(0, 1500) : "";
  if (!text.trim()) return NextResponse.json({ error: "Bitte einen Text eingeben." }, { status: 400 });
  return NextResponse.json({ hits: checkRules(text) });
}
