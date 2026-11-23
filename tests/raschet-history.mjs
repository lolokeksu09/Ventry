import assert from 'node:assert/strict';
import test from 'node:test';
import { filterHistory } from '../site/raschet/history.js';

const book = {
  clients: [{ id: 'a', name: 'Анна' }, { id: 'b', name: 'Борис' }],
  entries: [
    { id: 'debt', clientId: 'a', type: 'debt', date: '2026-11-01', note: 'Хлеб' },
    { id: 'payment', clientId: 'a', type: 'payment', date: '2026-11-02T15:30:00', note: 'Возврат' },
    { id: 'reversal', clientId: 'a', type: 'reversal', date: '2026-11-03T00:00:00', note: 'Ошибка' },
    { id: 'other', clientId: 'b', type: 'payment', date: '2026-11-02T16:30:00', note: 'Оплата' },
  ],
};
const ids = filters => filterHistory(book, {
  query: '', kind: '', from: '', to: '', ...filters,
}).map(entry => entry.id);

test('combines customer, operation kind and inclusive dates', () => {
  assert.deepEqual(ids({query: ' АННА ', kind: 'payment', from: '2026-11-02', to: '2026-11-02'}), ['payment']);
  assert.deepEqual(ids({ to: '2026-11-01' }), ['debt']);
  assert.deepEqual(ids({ from: '2026-11-03' }), ['reversal']);
});
test('finds notes and keeps reversals visible in the audit trail', () => {
  assert.deepEqual(ids({ query: 'возвРАТ' }), ['payment']);
  assert.deepEqual(ids({ kind: 'reversal', query: 'ошиб' }), ['reversal']);
  assert.deepEqual(ids({ query: 'Анна' }), ['debt', 'payment', 'reversal']);
  assert.deepEqual(ids({ query: 'нет совпадений' }), []);
});
