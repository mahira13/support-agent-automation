// Gmail Forwarder for the support-agent demo.
// Runs every minute in the DEMO Gmail account. Sends each new email to the
// Vercel webhook in the same JSON shape Postmark would use, then marks it read.
//
// Setup:
// 1. Logged in as the demo Gmail account: script.google.com → New project → paste this.
// 2. Project Settings → Script properties → WEBHOOK_URL =
//    https://support-agent-automation.vercel.app/api/inbound-email?token=YOUR_INBOUND_WEBHOOK_TOKEN
// 3. Run forwardNewEmails once by hand and allow the permissions.
// 4. Triggers → Add Trigger → forwardNewEmails → Time-driven → Minutes timer → Every minute.

function forwardNewEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // previous run still busy

  try {
    const url = PropertiesService.getScriptProperties().getProperty("WEBHOOK_URL");
    if (!url) throw new Error("WEBHOOK_URL fehlt in den Script properties");

    const threads = GmailApp.search("in:inbox is:unread", 0, 10);
    for (const thread of threads) {
      for (const msg of thread.getMessages()) {
        if (!msg.isUnread()) continue;

        const from = msg.getFrom(); // e.g. "Jana Becker <jana@example.com>"
        const match = from.match(/<([^>]+)>/);
        const email = match ? match[1] : from;
        const name = match ? from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() : "";

        const payload = {
          FromFull: { Email: email, Name: name },
          FromName: name,
          Subject: msg.getSubject(),
          TextBody: msg.getPlainBody(),
          HtmlBody: msg.getBody(),
          MessageID: msg.getHeader("Message-ID") || msg.getId(),
          Date: msg.getDate().toISOString(),
          Headers: ["Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond"]
            .map((h) => ({ Name: h, Value: msg.getHeader(h) || "" }))
            .filter((h) => h.Value),
        };

        const res = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        const code = res.getResponseCode();

        if (code >= 200 && code < 300) {
          msg.markRead();
        } else if (code >= 400 && code < 500) {
          // wrong token or bad data: don't retry forever
          console.error(`Webhook ${code}: ${res.getContentText().slice(0, 200)}`);
          msg.markRead();
          thread.addLabel(GmailApp.getUserLabelByName("webhook-fehler") || GmailApp.createLabel("webhook-fehler"));
        } else {
          // server error: leave unread, try again next minute
          console.error(`Webhook ${code}, neuer Versuch in 1 Minute`);
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}
