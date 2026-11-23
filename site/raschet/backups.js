export const BACKUP_LIMIT = 5;
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

let database;
function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('raschet-backups', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('books');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => {
      database = undefined;
      throw error;
    });
  }
  return database;
}

export function addSnapshot(previous, next) {
  if (previous[0]?.raw === next.raw) return previous;
  return [next, ...previous].slice(0, BACKUP_LIMIT);
}

async function backupsFor(bookKey, snapshot) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('books', snapshot ? 'readwrite' : 'readonly');
    const store = tx.objectStore('books');
    const request = store.get(bookKey);
    let result;
    request.onsuccess = () => {
      const previous = request.result ?? [];
      result = snapshot ? addSnapshot(previous, snapshot) : previous;
      if (previous !== result) store.put(result, bookKey);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error);
  });
}

export const listBackups = bookKey => backupsFor(bookKey);
export const storeBackup = (bookKey, raw, summary) => backupsFor(bookKey, {
  raw, summary, date: new Date().toISOString(),
});
