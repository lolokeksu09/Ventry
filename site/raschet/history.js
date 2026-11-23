function localDay(timestamp) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp;
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function filterHistory(book, { query, kind, from, to }) {
  const search = query.trim().toLocaleLowerCase('ru');
  const names = new Map(book.clients.map(client => [client.id, client.name]));
  return book.entries.filter(entry => {
    if (kind && entry.type !== kind) return false;
    if (from || to) {
      const day = localDay(entry.date);
      if ((from && day < from) || (to && day > to)) return false;
    }
    return !search || [names.get(entry.clientId), entry.note]
      .some(text => text.toLocaleLowerCase('ru').includes(search));
  });
}
