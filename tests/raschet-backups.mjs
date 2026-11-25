import assert from 'node:assert/strict';
import test from 'node:test';
import { addSnapshot, BACKUP_LIMIT } from '../site/raschet/backups.js';
import { addEntry, balance, validateBook } from '../site/raschet/ledger.js';

test('keeps five latest versions and skips consecutive duplicates', () => {
  const versions = Array.from({ length: 7 }, (_, i) => ({raw: String(i)}));
  const backups = versions.reduce(addSnapshot, []);
  assert.deepEqual(backups, versions.slice(-BACKUP_LIMIT).reverse());
  assert.equal(addSnapshot(backups, {...versions.at(-1)}), backups);
  assert.deepEqual(addSnapshot(backups, versions[1]).slice(0, 2), [versions[1], versions[6]]);
});

test('portable copies preserve partial payments, cancellations and remaining balance', () => {
  const base = {version: 2, clients: [{id: 'customer', name: 'Проверка', phone: ''}], entries: []};
  const entry = {clientId: 'customer', date: '2026-11-23T12:00:00.000Z', due: '', note: ''};
  const debt = addEntry(base, {...entry, id: 'debt', type: 'debt', amount: 300000});
  const paid = addEntry(debt, {...entry, id: 'payment', type: 'payment', amount: 100000});
  const reversed = addEntry(paid, {...entry, id: 'refund', type: 'reversal', amount: 100000, reverses: 'payment', note: 'Ошибка'});
  const copies = [debt, paid, reversed].reduce((items, book) => addSnapshot(items, {raw: JSON.stringify(book)}), []);
  const restored = copies.map(copy => validateBook(JSON.parse(copy.raw)));
  assert.deepEqual(restored, [reversed, paid, debt]);
  assert.deepEqual(restored.map(book => balance(book, 'customer')), [300000, 200000, 300000]);
});

import { writeBookSnapshot, BookWriteError } from '../site/raschet/book-storage.js';

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function fakeLocks() {
  const held = new Set();
  return {
    async request(name, options, callback) {
      assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({name}); } finally { held.delete(name); }
    },
  };
}

test('two tabs starting from the same snapshot cannot overwrite each other', async () => {
  const storage = fakeStorage({own: 'before'});
  const locks = fakeLocks();
  await writeBookSnapshot({storage, locks, key: 'own', expected: 'before', raw: 'first'});
  await assert.rejects(
    writeBookSnapshot({storage, locks, key: 'own', expected: 'before', raw: 'second'}),
    e => e instanceof BookWriteError && e.code === 'STALE_BOOK'
  );
  assert.equal(storage.getItem('own'), 'first');
  await writeBookSnapshot({storage, locks, key: 'own', expected: 'first', raw: 'reopened'});
  assert.equal(storage.getItem('own'), 'reopened');
});

test('concurrent first writes and independent demo storage', async () => {
  const storage = fakeStorage(), locks = fakeLocks();
  const outcomes = await Promise.allSettled([
    writeBookSnapshot({storage, locks, key: 'own', expected: null, raw: 'A'}),
    writeBookSnapshot({storage, locks, key: 'own', expected: null, raw: 'B'}),
    writeBookSnapshot({storage, locks, key: 'demo', expected: null, raw: 'demo'}),
  ]);
  assert.equal(outcomes.slice(0, 2).filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes[2].status, 'fulfilled');
  assert.equal(storage.getItem('demo'), 'demo');
  assert.ok(['A','B'].includes(storage.getItem('own')));
});

test('missing lock support, unreadable snapshot and quota failure preserve data', async () => {
  const storage = fakeStorage({own: 'original'}), locks = fakeLocks();
  await assert.rejects(writeBookSnapshot({storage, key:'own', expected:'original', raw:'new'}), e => e.code === 'LOCK_UNAVAILABLE');
  await assert.rejects(writeBookSnapshot({storage, locks, key:'own', expected:undefined, raw:'new'}), e => e.code === 'READ_FAILED');
  const broken = {...storage, setItem() { throw Error('quota'); }};
  await assert.rejects(writeBookSnapshot({storage:broken, locks, key:'own', expected:'original', raw:'new'}), e => e.code === 'WRITE_FAILED');
  assert.equal(storage.getItem('own'), 'original');
});

test('a restoration cannot replace a newer snapshot after confirmation', async () => {
  const storage = fakeStorage({own:'old'}), locks = fakeLocks();
  storage.setItem('own', 'another tab');
  await assert.rejects(writeBookSnapshot({storage, locks, key:'own', expected:'old', raw:'backup'}), e => e.code === 'STALE_BOOK');
  assert.equal(storage.getItem('own'), 'another tab');
});
