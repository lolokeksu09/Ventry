function localDay(timestamp) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function filterHistory(book, { query, kind, from, to, clientId = '' }) {
  const search = query.trim().toLocaleLowerCase('ru');
  const names = new Map(book.clients.map(client => [client.id, [client.name, client.phone || '']]));
  return book.entries.filter(entry => {
    if (clientId && entry.clientId !== clientId) return false;
    if (kind && entry.type !== kind) return false;
    if (from || to) {
      const day = localDay(entry.date);
      if ((from && day < from) || (to && day > to)) return false;
    }
    return !search || [...(names.get(entry.clientId) || []), entry.note || '']
      .some(text => text.toLocaleLowerCase('ru').includes(search));
  });
}

// Keep chronological order inside a page: historyRows renders it newest first.
export const HISTORY_PAGE_SIZE = 100;
export function historyPage(entries, requestedPage = 0) {
  const pages = Math.max(1, Math.ceil(entries.length / HISTORY_PAGE_SIZE));
  const page = Math.max(0, Math.min(pages - 1, Number.isInteger(requestedPage) ? requestedPage : 0));
  const end = Math.max(0, entries.length - page * HISTORY_PAGE_SIZE);
  const start = Math.max(0, end - HISTORY_PAGE_SIZE);
  return { page, pages, entries: entries.slice(start, end) };
}
