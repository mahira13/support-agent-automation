// Helpers so a customer's real address never gets stored or shown anywhere.

import { createHash } from "node:crypto";

/**
 * "j.becker@example.com" -> "j***@example.com"
 * Used for display only. The full address is never written to the sheet.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

/**
 * One-way hash of a sender identity (email address or, for the web form,
 * the client IP). Stored instead of the real value so per-sender rate
 * limits work without keeping personal data around.
 */
export function hashSender(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16);
}
