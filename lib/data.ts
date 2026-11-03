// Data access layer. In this prototype it reads JSON files.
// In production these functions would call the Shopify Admin API, Amazon SP-API
// and the in-house ERP. The rest of the pipeline does not need to change.

import ordersJson from "@/data/orders.json";
import productsJson from "@/data/products.json";
import batchesJson from "@/data/batches.json";
import ticketsJson from "@/data/tickets.json";
import type { Batch, Context, Order, Product, Ticket } from "./types";

const orders = ordersJson as Order[];
const products = productsJson as Product[];
const batches = batchesJson as Batch[];
const tickets = ticketsJson as Ticket[];

export function listTickets(): Ticket[] {
  return tickets;
}

export function getTicket(id: string): Ticket | undefined {
  return tickets.find((t) => t.id === id);
}

// Shopify order numbers (MA-12345 / NE-12345) and Amazon order ids (123-1234567-1234567)
const ORDER_PATTERNS = [/\b(?:MA|NE)-\d{5}\b/gi, /\b\d{3}-\d{7}-\d{7}\b/g];
// Batch ids like M550-2409, SK-2608-B, SKK-2607
const BATCH_PATTERN = /\b[A-Z]{1,4}\d{0,4}-\d{4}(?:-[A-Z])?\b/g;

export function extractOrderNumbers(text: string): string[] {
  const found = ORDER_PATTERNS.flatMap((p) => text.match(p) ?? []);
  return [...new Set(found.map((s) => s.toUpperCase()))];
}

export function extractBatchIds(text: string): string[] {
  return [...new Set(text.match(BATCH_PATTERN) ?? [])];
}

export function findOrder(orderNumber: string): Order | undefined {
  return orders.find((o) => o.order_number.toUpperCase() === orderNumber.toUpperCase());
}

export function findLatestOrderByEmail(email: string): Order | undefined {
  return orders
    .filter((o) => o.customer_email.toLowerCase() === email.toLowerCase())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function findBatch(id: string): Batch | undefined {
  return batches.find((b) => b.batch === id);
}

export function findProduct(sku: string): Product | undefined {
  return products.find((p) => p.sku === sku);
}

/**
 * Step 2 of the pipeline. Deliberately plain code, not AI:
 * facts like order status or tracking numbers must never be guessed by a model.
 */
export function buildContext(ticket: Ticket): Context {
  const text = `${ticket.subject}\n${ticket.body}`;

  let order: Order | null = null;
  let order_found_by: Context["order_found_by"] = null;
  for (const nr of extractOrderNumbers(text)) {
    const o = findOrder(nr);
    if (o) {
      order = o;
      order_found_by = "order_number";
      break;
    }
  }
  if (!order) {
    const o = findLatestOrderByEmail(ticket.from_email);
    if (o) {
      order = o;
      order_found_by = "email";
    }
  }

  let batch: Batch | null = null;
  for (const id of extractBatchIds(text)) {
    const b = findBatch(id);
    if (b) {
      batch = b;
      break;
    }
  }

  const skus = new Set<string>(order?.items.map((i) => i.sku) ?? []);
  if (batch) skus.add(batch.sku);
  const relevant = [...skus].map(findProduct).filter((p): p is Product => Boolean(p));

  return { order, order_found_by, products: relevant.length ? relevant : products, batch };
}
