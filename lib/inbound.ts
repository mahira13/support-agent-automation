// Turns the webhook's JSON into the plain fields the rest of the app needs.
// The JSON uses the field names of Postmark's inbound format (FromFull,
// TextBody, HtmlBody, MessageID, Headers, …). We don't use Postmark: our
// Gmail forwarder (apps-script/GmailForwarder.gs) sends this shape. Any other
// sender (e.g. a Gorgias webhook in production) only has to send the same shape.

export type InboundHeader = { Name: string; Value: string };

export type InboundPayload = {
  FromFull?: { Email?: string; Name?: string };
  FromName?: string;
  Subject?: string;
  StrippedTextReply?: string;
  TextBody?: string;
  HtmlBody?: string;
  MessageID?: string;
  Headers?: InboundHeader[];
  Date?: string;
};

export type InboundEmail = {
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
  messageId: string;
  receivedAt: string;
  headers: Record<string, string>;
};

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headerMap(headers: InboundHeader[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers ?? []) {
    if (h?.Name) map[h.Name.toLowerCase()] = h.Value ?? "";
  }
  return map;
}

/** Inbound JSON (Postmark's field names) -> the plain fields the rest of the app needs. */
export function parseInboundEmail(payload: InboundPayload): InboundEmail {
  const body = (payload.StrippedTextReply?.trim() || payload.TextBody?.trim() || stripHtml(payload.HtmlBody ?? "")).trim();
  return {
    fromEmail: payload.FromFull?.Email?.trim().toLowerCase() ?? "",
    fromName: payload.FromFull?.Name?.trim() || payload.FromName?.trim() || "",
    subject: payload.Subject?.trim() ?? "",
    body,
    messageId: payload.MessageID?.trim() ?? "",
    receivedAt: payload.Date ? new Date(payload.Date).toISOString() : new Date().toISOString(),
    headers: headerMap(payload.Headers),
  };
}

const AUTO_SENDER = /^(mailer-daemon|postmaster|noreply|no-reply|donotreply|do-not-reply)@/i;
const BULK_PRECEDENCE = /^(bulk|list|junk)$/i;

/** Returns a short reason to ignore the email, or null if it should be processed. */
export function ignoreReason(email: InboundEmail): string | null {
  const autoSubmitted = email.headers["auto-submitted"];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return `Auto-Submitted: ${autoSubmitted}`;
  if (email.headers["x-autoreply"]) return "X-Autoreply gesetzt";
  if (email.headers["x-autorespond"]) return "X-Autorespond gesetzt";
  if (BULK_PRECEDENCE.test(email.headers["precedence"] ?? "")) return `Precedence: ${email.headers["precedence"]}`;
  if (AUTO_SENDER.test(email.fromEmail)) return `automatischer Absender: ${email.fromEmail}`;
  if (!email.fromEmail) return "keine Absenderadresse";
  if (!email.body.trim()) return "leerer Text";
  return null;
}
