// The book remains in its existing localStorage key and JSON format.
// Web Locks serializes cooperating tabs of this origin. Comparing the exact
// snapshot inside the lock prevents a stale UI from replacing newer records.
export class BookWriteError extends Error {
  constructor(code, message) { super(message); this.name = 'BookWriteError'; this.code = code; }
}

export async function writeBookSnapshot({ storage, locks, key, expected, raw }) {
  if (expected !== null && typeof expected !== 'string') {
    throw new BookWriteError('READ_FAILED', 'Не удалось прочитать исходную книгу. Изменения не сохранены.');
  }
  if (!locks || typeof locks.request !== 'function') {
    throw new BookWriteError('LOCK_UNAVAILABLE', 'Этот браузер не поддерживает безопасную запись. Откройте книгу в актуальном браузере. Экспорт остаётся доступным.');
  }
  return locks.request('ventry:book:' + key, { mode: 'exclusive', ifAvailable: true }, lock => {
    if (!lock) throw new BookWriteError('BOOK_BUSY', 'Другая вкладка сохраняет книгу. Повторите действие после завершения записи.');
    let current;
    try { current = storage.getItem(key); }
    catch { throw new BookWriteError('READ_FAILED', 'Не удалось прочитать книгу. Изменения не сохранены.'); }
    if (current !== expected) {
      throw new BookWriteError('STALE_BOOK', 'Книга изменилась в другой вкладке. Закройте это окно, проверьте актуальные записи и повторите действие.');
    }
    try { storage.setItem(key, raw); }
    catch { throw new BookWriteError('WRITE_FAILED', 'Браузер не сохранил запись. Проверьте свободное место и разрешение на хранение данных.'); }
  });
}
