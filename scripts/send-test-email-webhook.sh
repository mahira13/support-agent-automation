#!/usr/bin/env bash
# Sends the same JSON that apps-script/GmailForwarder.gs sends (field names of
# Postmark's inbound format) to the webhook, so you can test the live pipeline
# without sending a real email.
#
# Usage:
#   ./scripts/send-test-email-webhook.sh http://localhost:3000 your-webhook-token
#   ./scripts/send-test-email-webhook.sh https://DEINE-APP.vercel.app your-webhook-token
set -euo pipefail
BASE_URL="${1:?Bitte die Basis-URL angeben, z. B. http://localhost:3000}"
TOKEN="${2:?Bitte das INBOUND_WEBHOOK_TOKEN angeben}"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MSG_ID="<test-$(date +%s)-$RANDOM@mail.gmail.com>"

read -r -d '' PAYLOAD <<JSON || true
{
  "FromFull": { "Email": "jana.test@example.com", "Name": "Jana Test" },
  "FromName": "Jana Test",
  "Subject": "Hilft Manuka Honig bei Erkältung?",
  "TextBody": "Hallo,\nich bin seit drei Tagen erkältet. Hilft Ihr Manuka Honig MGO 550+ dagegen? Wie viel soll ich am Tag nehmen?\n\nViele Grüße\nJana",
  "HtmlBody": "<div dir=\"ltr\">Hallo,<br>ich bin seit drei Tagen erkältet. Hilft Ihr Manuka Honig MGO 550+ dagegen? Wie viel soll ich am Tag nehmen?<br><br>Viele Grüße<br>Jana</div>",
  "MessageID": "${MSG_ID}",
  "Date": "${NOW}",
  "Headers": []
}
JSON

echo "POST ${BASE_URL%/}/api/inbound-email"
curl -sS -X POST "${BASE_URL%/}/api/inbound-email?token=${TOKEN}" \
  -H "content-type: application/json" \
  --data-binary "$PAYLOAD" \
  -w '\nHTTP %{http_code}\n'

echo "Jetzt die Demo-Seite öffnen oder ${BASE_URL%/}/api/inbox aufrufen, um das Ticket zu sehen."
