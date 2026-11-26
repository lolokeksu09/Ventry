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

import { periodRange, projectDemo } from '../site/raschet/demo-analytics.js';
const analyticsBook={"clients":[{"id":"a","name":"А"},{"id":"b","name":"Б"}],"entries":[{"id":"1","clientId":"a","type":"debt","amount":10000,"date":"2026-11-01"},{"id":"2","clientId":"a","type":"payment","amount":3000,"date":"2026-11-03"},{"id":"3","clientId":"b","type":"debt","amount":5000,"date":"2026-11-04"},{"id":"4","clientId":"b","type":"reversal","reverses":"3","amount":5000,"date":"2026-11-06"}]};
test('analytics respects historical cutoffs, cancellation and client scope', () => {
  const a=projectDemo(analyticsBook,{from:'2026-11-03',to:'2026-11-05'}).totals;
  assert.deepEqual([a.start,a.end,a.debt,a.payment,a.debtors],[10000,12000,5000,3000,2]);
  const b=projectDemo(analyticsBook,{from:'2026-11-03',to:'2026-11-06'}).totals;
  assert.deepEqual([b.end,b.debt,b.debtCount,b.cancelDebt,b.debtors],[7000,0,0,5000,1]);
  assert.equal(projectDemo(analyticsBook,{from:'2026-11-01',to:'2026-11-06'},'a').totals.debtCount,1);
  assert.equal(periodRange('week','2026-11-26',analyticsBook.entries).from,'2026-11-23');
});
