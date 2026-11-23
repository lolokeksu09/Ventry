import assert from 'node:assert/strict';
import test from 'node:test';
import { addEntry, balance, debtOverview, overdue } from '../site/raschet/ledger.js';

const empty = {version: 2, clients: [{id: 'c', name: 'Тест', phone: ''}], entries: []};
const date = '2026-12-29';
const operation = {clientId: 'c', date: '2026-12-20T12:00:00Z', note: '', due: '', type: 'debt'};
const book = [
  {id: 'old', due: '2026-12-28', amount: 10000},
  {id: 'today', due: date, amount: 17000},
  {id: 'last', due: '2027-01-04', amount: 24000},
  {id: 'outside', due: '2027-01-05', amount: 32000},
  {id: 'undated', amount: 39000},
].reduce((state, entry) => addEntry(state, {...operation, ...entry}), empty);
const pay = (state, amount) => addEntry(state, {...operation, id:'payment', type:'payment', amount});

test('uses inclusive dates and assigns partial payments to the oldest debt', () => {
  const partiallyPaid = pay(book, 5000);
  const info = debtOverview(partiallyPaid, date).get('c');
  assert.equal(info.balance, balance(partiallyPaid, 'c'));
  assert.equal(info.overdue, 5000);
  assert.equal(overdue(partiallyPaid, 'c', date), info.overdue);
  assert.equal(info.soon, 41000);
  assert.equal(info.nextDue, '2026-12-28');
  assert.equal(info.soonDate, date);
});

test('hides covered deadlines and reopens them when the payment is cancelled', () => {
  const paid = pay(book, 27000);
  const info = debtOverview(paid, date).get('c');
  assert.equal(info.overdue, 0);
  assert.equal(info.soon, 24000);
  assert.equal(info.nextDue, '2027-01-04');
  assert.equal(info.soonDate, info.nextDue);
  const reverted = addEntry(paid, {...operation, id:'reversal', type:'reversal', amount:27000, reverses:'payment', note:'Ошибка'});
  assert.deepEqual(debtOverview(reverted, date), debtOverview(book, date));
  assert.deepEqual(debtOverview(pay(book, balance(book, 'c')), date).get('c'), {
    balance: 0, overdue: 0, soon: 0, soonDate: '', nextDue: '',
  });
});
