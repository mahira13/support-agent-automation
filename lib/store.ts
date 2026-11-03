// Storage for live tickets. A Google Sheet (via an Apps Script web app, see
// apps-script/Code.gs) in production, plain memory for local dev and tests.
//
// Why Google Sheets and not a database: the whole team can open it, filter it
// and read it without any technical setup. The trade-off is speed (one write
// per step, a few hundred ms each) and no real transactions — fine for a
// support-ticket log, not fine for anything that needs strict consistency.

export type StepState = "running" | "done" | "error";

export type StoredStep = {
  step: string;
  time: string;
  state: StepState;
  label_de: string;
  detail?: unknown;
};

export type StoredTicket = {
  ticket_id: string;
  received_at: string;
  source: string;
  from_masked: string;
  subject: string;
  body: string;
  status: string;
  route_to: string;
  final_reply: string;
  updated_at: string;
  steps: StoredStep[];
};

export type CreateTicketInput = {
  ticket_id: string;
  received_at: string;
  source: string;
  from_masked: string;
  subject: string;
  body: string;
  status: string;
  route_to: string;
  final_reply: string;
  /** Hash only, never the real address/IP. Used for per-sender rate limits. */
  sender_hash: string;
  /** Email Message-ID, for dedupe. Empty for web submissions. */
  message_id: string;
};

export type FinishTicketInput = {
  status: string;
  route_to: string;
  final_reply: string;
};

export interface TicketStore {
  createTicket(input: CreateTicketInput): Promise<void>;
  addStep(ticket_id: string, step: string, state: StepState, label_de: string, detail?: unknown): Promise<void>;
  finishTicket(ticket_id: string, fields: FinishTicketInput): Promise<void>;
  listRecent(limit: number): Promise<StoredTicket[]>;
  /** Tickets received since `iso`, optionally only from one sender (by hash). */
  countSince(iso: string, senderHash?: string): Promise<number>;
  hasMessageId(messageId: string): Promise<boolean>;
}

const CELL_LIMIT = 45_000; // Sheets cells max out at 50,000 chars; leave headroom
function truncate(s: string): string {
  return s.length > CELL_LIMIT ? s.slice(0, CELL_LIMIT) : s;
}

// ---------------- Memory store (local dev, tests, no SHEET_API_URL set) ----------------

export class MemoryStore implements TicketStore {
  private tickets = new Map<string, StoredTicket & { sender_hash: string; message_id: string }>();

  async createTicket(input: CreateTicketInput): Promise<void> {
    this.tickets.set(input.ticket_id, {
      ...input,
      body: truncate(input.body),
      updated_at: input.received_at,
      steps: [],
    });
  }

  async addStep(ticket_id: string, step: string, state: StepState, label_de: string, detail?: unknown): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    t.steps.push({ step, time: new Date().toISOString(), state, label_de, detail });
  }

  async finishTicket(ticket_id: string, fields: FinishTicketInput): Promise<void> {
    const t = this.tickets.get(ticket_id);
    if (!t) return;
    t.status = fields.status;
    t.route_to = fields.route_to;
    t.final_reply = truncate(fields.final_reply);
    t.updated_at = new Date().toISOString();
  }

  async listRecent(limit: number): Promise<StoredTicket[]> {
    return [...this.tickets.values()]
      .sort((a, b) => b.received_at.localeCompare(a.received_at))
      .slice(0, limit)
      .map(({ sender_hash: _s, message_id: _m, ...rest }) => rest);
  }

  async countSince(iso: string, senderHash?: string): Promise<number> {
    let n = 0;
    for (const t of this.tickets.values()) {
      if (t.received_at < iso) continue;
      if (senderHash && t.sender_hash !== senderHash) continue;
      n++;
    }
    return n;
  }

  async hasMessageId(messageId: string): Promise<boolean> {
    if (!messageId) return false;
    for (const t of this.tickets.values()) if (t.message_id === messageId) return true;
    return false;
  }

  /** Test-only: wipe all tickets so tests don't leak state into each other. */
  clear() {
    this.tickets.clear();
  }
}

// ---------------- Sheet store (production) ----------------

class SheetStore implements TicketStore {
  private cache: { at: number; limit: number; data: StoredTicket[] } | null = null;
  private readonly CACHE_MS = 3000;

  constructor(
    private url: string,
    private secret: string,
  ) {}

  private async call(action: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Apps Script web apps answer with a 302 redirect to the actual content;
    // fetch must follow it (the default), not treat it as the final response.
    const res = await fetch(this.url, {
      method: "POST",
      redirect: "follow",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: this.secret, action, ...body }),
    });
    if (!res.ok) throw new Error(`Sheet-API Fehler ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(`Sheet-API: ${data.error}`);
    return data;
  }

  async createTicket(input: CreateTicketInput): Promise<void> {
    await this.call("createTicket", { ...input, body: truncate(input.body) });
    this.cache = null;
  }

  async addStep(ticket_id: string, step: string, state: StepState, label_de: string, detail?: unknown): Promise<void> {
    await this.call("addStep", { ticket_id, step, state, label_de, detail_json: truncate(JSON.stringify(detail ?? {})) });
    this.cache = null;
  }

  async finishTicket(ticket_id: string, fields: FinishTicketInput): Promise<void> {
    await this.call("finishTicket", { ticket_id, ...fields, final_reply: truncate(fields.final_reply) });
    this.cache = null;
  }

  async listRecent(limit: number): Promise<StoredTicket[]> {
    const now = Date.now();
    if (this.cache && this.cache.limit >= limit && now - this.cache.at < this.CACHE_MS) {
      return this.cache.data.slice(0, limit);
    }
    const url = `${this.url}?secret=${encodeURIComponent(this.secret)}&action=list&limit=${limit}`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`Sheet-API Fehler ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(`Sheet-API: ${data.error}`);
    const tickets = (data.tickets ?? []) as StoredTicket[];
    this.cache = { at: now, limit, data: tickets };
    return tickets;
  }

  async countSince(iso: string, senderHash?: string): Promise<number> {
    const data = await this.call("countSince", { since: iso, sender_hash: senderHash ?? "" });
    return Number(data.count ?? 0);
  }

  async hasMessageId(messageId: string): Promise<boolean> {
    if (!messageId) return false;
    const data = await this.call("hasMessageId", { message_id: messageId });
    return Boolean(data.exists);
  }
}

let store: TicketStore | null = null;

/** Writes must never crash the agent. Wraps a store call, logs failures, swallows them. */
export async function safeWrite(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[store] ${label} fehlgeschlagen:`, err instanceof Error ? err.message : err);
  }
}

export function getStore(): TicketStore {
  if (store) return store;
  const url = process.env.SHEET_API_URL;
  const secret = process.env.SHEET_API_SECRET;
  store = url && secret ? new SheetStore(url, secret) : new MemoryStore();
  return store;
}

/** Test-only: force a fresh store (e.g. a clean MemoryStore) next time getStore() is called. */
export function resetStore(): void {
  store = null;
}
