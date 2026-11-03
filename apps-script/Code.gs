/**
 * Apps Script backend for the live support-agent demo.
 * Stores one row per ticket and one row per pipeline step in a Google Sheet,
 * and answers a small JSON API that lib/store.ts (SheetStore) talks to.
 *
 * SETUP
 * 1. Create a new Google Sheet (any name, e.g. "Support-Agent Live-Log").
 * 2. Extensions → Apps Script. Delete the default code, paste this whole file.
 * 3. Project Settings (gear icon) → Script Properties → add a property
 *    named SECRET with a long random value. Put the same value into
 *    SHEET_API_SECRET in the app's environment variables.
 * 4. Deploy → New deployment → type "Web app".
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Copy the web app URL into SHEET_API_URL in the app's environment.
 * 5. IMPORTANT: every time you change this file, you must create a NEW
 *    deployment version (Deploy → Manage deployments → pencil icon → New
 *    version → Deploy) — just saving the script does not update the live
 *    web app URL's behavior.
 * 6. The two tabs (Tickets, Steps) and their header rows are created
 *    automatically the first time the web app is called. The last two
 *    columns of Tickets (sender_hash, message_id) are internal bookkeeping
 *    for rate limits and de-duplication — not the customer's real address —
 *    and are hidden by default.
 * 7. Optional: File → Share → "Anyone with the link: Viewer" on the Sheet
 *    itself (not the web app) if you want to put the link in SHEET_PUBLIC_URL
 *    so visitors can see the raw log.
 */

var TICKETS_SHEET = "Tickets";
var STEPS_SHEET = "Steps";
var TICKETS_HEADERS = [
  "ticket_id", "received_at", "source", "from_masked", "subject", "body",
  "status", "route_to", "final_reply", "updated_at", "sender_hash", "message_id",
];
var STEPS_HEADERS = ["ticket_id", "time", "step", "state", "label_de", "detail_json"];
var CELL_LIMIT = 45000;

function truncate_(value) {
  var s = value == null ? "" : String(value);
  return s.length > CELL_LIMIT ? s.slice(0, CELL_LIMIT) : s;
}

function nowIso_() {
  return new Date().toISOString();
}

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    if (name === TICKETS_SHEET) {
      // sender_hash, message_id: internal only, hide them from casual viewers
      sheet.hideColumns(headers.length - 1, 2);
    }
  }
  return sheet;
}

function ensureSetup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tickets = getOrCreateSheet_(ss, TICKETS_SHEET, TICKETS_HEADERS);
  var steps = getOrCreateSheet_(ss, STEPS_SHEET, STEPS_HEADERS);
  return { tickets: tickets, steps: steps };
}

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty("SECRET") || "";
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorOutput_(message) {
  return jsonOutput_({ error: message });
}

function sheetAsObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
    rows.push(row);
  }
  return rows;
}

function findRowByTicketId_(sheet, ticketId) {
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(ticketId)) return i + 1; // 1-based sheet row
  }
  return -1;
}

// ---------------- doPost ----------------

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return errorOutput_("Ungültiges JSON im Request-Body.");
  }

  if (!body.secret || body.secret !== getSecret_()) {
    return errorOutput_("Falsches Secret.");
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheets = ensureSetup_();
    switch (body.action) {
      case "createTicket":
        return handleCreateTicket_(sheets.tickets, body);
      case "addStep":
        return handleAddStep_(sheets.steps, body);
      case "finishTicket":
        return handleFinishTicket_(sheets.tickets, body);
      case "countSince":
        return handleCountSince_(sheets.tickets, body);
      case "hasMessageId":
        return handleHasMessageId_(sheets.tickets, body);
      default:
        return errorOutput_("Unbekannte action: " + body.action);
    }
  } catch (err) {
    return errorOutput_("Serverfehler: " + err);
  } finally {
    lock.releaseLock();
  }
}

function handleCreateTicket_(sheet, body) {
  var receivedAt = body.received_at || nowIso_();
  sheet.appendRow([
    body.ticket_id || "",
    receivedAt,
    body.source || "",
    body.from_masked || "",
    truncate_(body.subject),
    truncate_(body.body),
    body.status || "processing",
    body.route_to || "",
    truncate_(body.final_reply),
    receivedAt,
    body.sender_hash || "",
    body.message_id || "",
  ]);
  return jsonOutput_({ ok: true });
}

function handleAddStep_(sheet, body) {
  sheet.appendRow([
    body.ticket_id || "",
    nowIso_(),
    body.step || "",
    body.state || "",
    truncate_(body.label_de),
    truncate_(body.detail_json),
  ]);
  return jsonOutput_({ ok: true });
}

function handleFinishTicket_(sheet, body) {
  var row = findRowByTicketId_(sheet, body.ticket_id);
  if (row === -1) return errorOutput_("Ticket nicht gefunden: " + body.ticket_id);
  // Columns: status=7, route_to=8, final_reply=9, updated_at=10
  sheet.getRange(row, 7, 1, 4).setValues([[
    body.status || "",
    body.route_to || "",
    truncate_(body.final_reply),
    nowIso_(),
  ]]);
  return jsonOutput_({ ok: true });
}

function handleCountSince_(sheet, body) {
  var rows = sheetAsObjects_(sheet);
  var since = body.since || "";
  var senderHash = body.sender_hash || "";
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    var receivedAt = toIsoString_(rows[i].received_at);
    if (receivedAt < since) continue;
    if (senderHash && String(rows[i].sender_hash) !== senderHash) continue;
    count++;
  }
  return jsonOutput_({ count: count });
}

function handleHasMessageId_(sheet, body) {
  var messageId = body.message_id || "";
  if (!messageId) return jsonOutput_({ exists: false });
  var rows = sheetAsObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].message_id) === messageId) return jsonOutput_({ exists: true });
  }
  return jsonOutput_({ exists: false });
}

function toIsoString_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

// ---------------- doGet ----------------

function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!params.secret || params.secret !== getSecret_()) {
    return errorOutput_("Falsches Secret.");
  }
  if (params.action !== "list") {
    return errorOutput_("Unbekannte action: " + params.action);
  }

  var limit = parseInt(params.limit, 10);
  if (!limit || limit < 1) limit = 20;

  var sheets = ensureSetup_();
  var tickets = sheetAsObjects_(sheets.tickets);
  var steps = sheetAsObjects_(sheets.steps);

  tickets.sort(function (a, b) {
    return toIsoString_(b.received_at) < toIsoString_(a.received_at) ? -1 : 1;
  });
  tickets = tickets.slice(0, limit);

  var stepsByTicket = {};
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var tid = s.ticket_id;
    if (!stepsByTicket[tid]) stepsByTicket[tid] = [];
    var detail;
    try {
      detail = s.detail_json ? JSON.parse(s.detail_json) : undefined;
    } catch (err) {
      detail = s.detail_json;
    }
    stepsByTicket[tid].push({
      step: s.step,
      time: toIsoString_(s.time),
      state: s.state,
      label_de: s.label_de,
      detail: detail,
    });
  }
  for (var tid2 in stepsByTicket) {
    stepsByTicket[tid2].sort(function (a, b) { return a.time < b.time ? -1 : 1; });
  }

  var out = tickets.map(function (t) {
    return {
      ticket_id: t.ticket_id,
      received_at: toIsoString_(t.received_at),
      source: t.source,
      from_masked: t.from_masked,
      subject: t.subject,
      body: t.body,
      status: t.status,
      route_to: t.route_to,
      final_reply: t.final_reply,
      updated_at: toIsoString_(t.updated_at),
      steps: stepsByTicket[t.ticket_id] || [],
    };
  });

  return jsonOutput_({ tickets: out });
}
