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
