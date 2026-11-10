# Setup: from this repo to a live, email-driven demo

How the pieces fit together: a visitor emails the demo Gmail address. `apps-script/GmailForwarder.gs` runs every
minute in that Gmail account and posts each new email to the app's webhook `/api/inbound-email`. The app answers
right away, then runs the agent and writes every step to a Google Sheet through `apps-script/Code.gs`. The demo
page polls `/api/inbox` every 3 seconds and shows the steps live. No reply emails are ever sent.

Values of the live demo used below: `support-agent-automation.vercel.app` (Vercel domain) and
`maorika.demo.support@gmail.com` (demo Gmail address). If you set up your own copy, use your own domain and address.

## 1. OpenAI API key with a spend limit
1. platform.openai.com/api-keys → **Create new secret key**. Copy it once, you can't see it again.
2. platform.openai.com → Settings → **Limits / Billing**: buy a small prepaid credit and set a low monthly budget
   (a few dollars is plenty for the demo; the app also limits itself to 60 tickets per day).
3. Locally: `cp .env.example .env.local`, set `OPENAI_API_KEY`, keep `LLM_PROVIDER=openai`, choose `OPENAI_MODEL`.
4. `npm test` runs without any key. `npm run cli` really calls OpenAI.
5. `npm run precompute` saves the results of the example tickets to `data/demo-results.json` (commit that file).
   Check the results: T-1003, T-1005, T-1006, T-1009, T-1011, T-1012 and the prompt-injection ticket T-1013
   must be 🟡 or ⛔, never ✅.

## 2. Google Sheet + `Code.gs` deployment
1. Create a new Google Sheet (e.g. "Support-Agent Live-Log").
2. In the Sheet: **Extensions → Apps Script**. Delete the default code and paste all of `apps-script/Code.gs`.
3. **Project Settings** (gear icon) → **Script Properties** → add `SECRET` = a long random string
   (e.g. `openssl rand -hex 24`). The same value goes into `SHEET_API_SECRET`.
4. **Deploy → New deployment** → type **Web app** → Execute as **Me**, Who has access **Anyone** → Deploy.
   Allow the permissions. Copy the web app URL (ends with `/exec`) → this is `SHEET_API_URL`.
5. **Gotcha: "new deployment version".** Saving the script does **not** change the live web app. After every change
   to `Code.gs`: **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same.
6. The tabs `Tickets` and `Steps` are created on the first call. The columns `sender_hash` and `message_id` are
   hidden; they hold a hash (not the address) for the limits and the email ID for de-duplication.
7. Optional: **Share** the Sheet itself (not the script) as "Anyone with the link: Viewer" → `SHEET_PUBLIC_URL`.

## 3. Demo Gmail account
1. Create a new Gmail account just for the demo (here: `maorika.demo.support@gmail.com`). Don't use your private account:
   the forwarder sends **every** unread inbox email to the webhook, and the content is public on the page.
2. **Before** setting up the forwarder, open the inbox and **mark all welcome emails as read** (select all → Mark as
   read). Otherwise Google's welcome emails become the first live tickets.

## 4. Environment variables
Generate the webhook token: `openssl rand -hex 24` → `INBOUND_WEBHOOK_TOKEN`.

| Name | Value |
|---|---|
| `LLM_PROVIDER` | `openai` |
| `OPENAI_API_KEY` | key from step 1 |
| `OPENAI_MODEL` | e.g. `gpt-5-mini` |
| `OPENAI_REASONING_EFFORT` | `low` (default; `minimal` is faster). Only sent for reasoning models (`gpt-5*`, `o*`) |
| `ENABLE_LIVE` | `true` (anything else: tickets are stored, but no AI runs) |
| `SHEET_API_URL` | web app URL from step 2 |
| `SHEET_API_SECRET` | the `SECRET` script property from step 2 |
| `SHEET_PUBLIC_URL` | optional, view link of the Sheet (shown on the page as "Alle Live-Tickets im Google Sheet ansehen (nur lesen)") |
| `INBOUND_WEBHOOK_TOKEN` | random string from above |
| `INBOUND_EMAIL_ADDRESS` | `maorika.demo.support@gmail.com` (shown in the banner on the page) |
| `GITHUB_URL` | optional, link to the repo (shown on the page) |
| `LIVE_DAILY_LIMIT` | `60` (default) |
| `LIVE_PER_SENDER_HOUR` | `5` (default) |
| `LIVE_BODY_MAX_CHARS` | optional, `2000` (default): characters kept from a message |

Other AI providers (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL`,
`OLLAMA_URL`, `OLLAMA_MODEL`) and `OPENAI_BASE_URL` are optional, see `.env.example`.
Put the same values into `.env.local` if you want to test against the real Sheet locally.

## 5. GitHub
1. Check that no secrets are in the repo:
   ```bash
   git grep -nE "sk-[A-Za-z0-9]|AKfy[c]|-----BEGI[N]" || echo "no secrets"
   git ls-files | grep -i env        # must show only .env.example
   ```
2. Push to `main` of https://github.com/mahira13/support-agent-automation. The folder `private/` and `.env*` files
   are in `.gitignore`.

## 6. Vercel
1. vercel.com → **Add New → Project** → import the GitHub repo. Framework: Next.js (auto-detected).
2. **Settings → Environment Variables**: add all variables from step 4. Tick **Production** and **Preview**.
3. Deploy. Vercel deploys `main` to production. After changing a variable, **redeploy** (Deployments → ⋯ → Redeploy),
   because variables are only read at deploy time.
4. Open `https://support-agent-automation.vercel.app` — the banner should show the demo address.

## 7. `GmailForwarder.gs` in the demo Gmail account
1. Logged in as the demo Gmail account: script.google.com → **New project** → paste all of
   `apps-script/GmailForwarder.gs`.
2. **Project Settings → Script Properties** → add `WEBHOOK_URL` =
   `https://support-agent-automation.vercel.app/api/inbound-email?token=<INBOUND_WEBHOOK_TOKEN>`
3. Select the function `forwardNewEmails` → **Run** once by hand → allow the permissions (Gmail + external requests).
4. **Triggers** (clock icon) → **Add Trigger** → function `forwardNewEmails` → event source **Time-driven** →
   **Minutes timer** → **Every minute** → Save.

## 8. End-to-end test
- [ ] Without email: `./scripts/send-test-email-webhook.sh https://support-agent-automation.vercel.app <token>` → `HTTP 200`
      and a `ticket_id`. The ticket appears on the page under "Live" and in the Sheet.
- [ ] Same script with a wrong token → `HTTP 401`.
- [ ] From another email account, send an email to `maorika.demo.support@gmail.com`. Within about 1 minute it appears under
      "Live", the steps tick off one by one, and a final status appears. In Gmail the email is now marked as read.
- [ ] Type a message in "Eigene Nachricht senden" → same flow.
- [ ] Open the page on a phone (390 px width) in light and dark mode: no horizontal scroll.

## 9. Troubleshooting
- **Nothing arrives from Gmail:** in the forwarder project open **Executions**. Every run is listed with its log.
  "WEBHOOK_URL fehlt" = script property missing. No runs at all = the trigger is missing.
- **Gmail label `webhook-fehler`:** the webhook answered 4xx (usually a wrong token in `WEBHOOK_URL`). The email
  was marked read and labelled so it isn't retried forever. Fix the URL, then mark the email as unread again.
- **5xx from the webhook:** the email stays unread and is retried next minute. Check Vercel Logs.
- **Vercel Logs:** Project → **Logs**. Look for `[inbound-email]`, `[intake]`, `[store]` and `[inbox]` lines
  (e.g. `[store] addStep fehlgeschlagen: Sheet-API: Falsches Secret.`).
- **Sheet stays empty:** `SHEET_API_SECRET` must equal the `SECRET` script property; after editing `Code.gs` you
  need a new deployment version (step 2.5). In the Sheet's Apps Script project, **Executions** shows errors too.
- **Ticket shows "Live-Modus aus":** `ENABLE_LIVE` is not exactly `true`, or `OPENAI_API_KEY` is missing (redeploy
  after changing it).
- **Ticket shows "Limit erreicht":** daily or per-sender limit reached (`LIVE_DAILY_LIMIT`, `LIVE_PER_SENDER_HOUR`).
- **Test email never shows up:** check the demo account's **Spam** folder — the forwarder only reads the inbox.
  Move the email to the inbox and mark it unread.
