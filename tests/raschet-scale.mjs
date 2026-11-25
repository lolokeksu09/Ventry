import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { validateBook, debtOverview, addEntry } from '../site/raschet/ledger.js';
import { filterHistory } from '../site/raschet/history.js';

const count = 100_000;
function largeBook() {
  const clients = Array.from({length: 1000}, (_, i) => ({
    id: 'c' + i, name: 'Клиент ' + i, phone: '',
  }));
  const entries = Array.from({length: count}, (_, i) => {
    const debt = Math.floor(i / clients.length) % 2 === 0;
    return {
      id: 'e' + i, clientId: clients[i % clients.length].id,
      type: debt ? 'debt' : 'payment', amount: debt ? 10_000 : 4_000,
      date: '2026-11-23T12:00:00.000Z', due: debt ? '2026-11-24' : '', note: '',
    };
  });
  return {version: 2, clients, entries};
}

test('100,000 operations: validation, exact balances, history and JSON round trip', t => {
  const raw = largeBook();
  let start = performance.now();
  const book = validateBook(raw);
  t.diagnostic('validation_ms=' + Math.round(performance.now() - start));
  start = performance.now();
  const summary = debtOverview(book, '2026-11-26');
  t.diagnostic('overview_ms=' + Math.round(performance.now() - start));
  assert.equal(summary.size, 1000);
  for (const row of summary.values()) {
    assert.equal(row.balance, 300_000);
    assert.equal(row.overdue, 300_000);
    assert.equal(row.soon, 0);
  }
  assert.equal([...summary.values()].reduce((n, row) => n + row.balance, 0), 300_000_000);
  start = performance.now();
  const history = filterHistory(book, {query:'', kind:'payment', from:'2026-11-23', to:'2026-11-23'});
  t.diagnostic('history_ms=' + Math.round(performance.now() - start));
  assert.equal(history.length, 50_000);
  const json = JSON.stringify(book);
  t.diagnostic('json_utf8_bytes=' + Buffer.byteLength(json));
  assert.deepEqual(validateBook(JSON.parse(json)), book);
  assert.throws(() => addEntry(book, {...book.entries[0], id:'overflow'}), /Неверный формат/);
});

test('large ledger rejects overpayment and duplicate operation ID', () => {
  const book = largeBook();
  book.entries.at(-1).amount = 100_000_000;
  assert.throws(() => validateBook(book), /превышает долг/);
  book.entries.at(-1).amount = 4_000;
  book.entries.at(-1).id = book.entries[0].id;
  assert.throws(() => validateBook(book), /Некорректная операция/);
});
