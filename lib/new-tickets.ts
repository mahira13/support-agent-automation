// What the demo page does when the live list changes between two polls.
// Kept free of React and the DOM so it can be tested.

export type Selection = { kind: "example" | "live"; id: string } | { kind: "words" } | { kind: "write" };

/**
 * IDs that are new compared to the previous successful poll, newest first (the list is newest first).
 * `prev === null` = first load: nothing is new. A failed live read must not be passed in here
 * (its list is empty, so every ticket would look new on the next poll).
 */
export function findNewTickets(prev: Set<string> | null, liveIds: string[]): string[] {
  if (!prev) return [];
  return liveIds.filter((id) => !prev.has(id));
}

export type NewTicketAction = { kind: "none" } | { kind: "open"; id: string } | { kind: "toast"; id: string };

/**
 * `wasAway`: the tab was in the background or the window lost focus at some point since the previous poll.
 * Every view counts as "something selected" – a ticket, but also "Eigene Nachricht senden" and
 * "Wortliste live testen" – so a visitor who is looking at the page is never switched away from what they do.
 */
export function newTicketAction(newestId: string, selection: Selection, wasAway: boolean): NewTicketAction {
  if (selection.kind === "live" && selection.id === newestId) return { kind: "none" }; // own message, already open
  if (wasAway) return { kind: "open", id: newestId };
  return { kind: "toast", id: newestId };
}
