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

import { previousRange, bookDays, calendarDays } from '../site/raschet/demo-analytics.js';
test('calendar handles Monday start and leap years',()=>{
  assert.equal(calendarDays('2026-02').length,34);
  assert.equal(calendarDays('2024-02').at(-1),'2024-02-29');
  assert.equal(bookDays(analyticsBook,'debt')[0].total,0);
  assert.equal(bookDays(analyticsBook,'debt')[0].entries.length,1);
});
test('comparison matches Android calendar policy',()=>{
  assert.deepEqual(previousRange('month',periodRange('month','2026-03-31',[])),{from:'2026-02-01',to:'2026-02-28'});
  assert.deepEqual(previousRange('custom',{from:'2026-11-03',to:'2026-11-05'}),{from:'2026-10-31',to:'2026-11-02'});
  assert.equal(periodRange('quarter','2026-11-26',[]).from,'2026-10-01');
  assert.equal(previousRange('all',{from:'2026-01-01',to:'2026-11-26'}),null);
});

test('movement includes cancelled operations, effective counts do not',()=>{
  const p=projectDemo(analyticsBook,{from:'2026-11-03',to:'2026-11-06'}),t=p.totals;
  assert.deepEqual([t.movementDebt,t.debt,t.active,t.borrowers,t.newBorrowers],[5000,0,2,0,0]);
  assert.deepEqual(p.days.map(d=>d.closing),[7000,12000,7000]);
  assert.equal(p.days.at(-1).cancelDebt,5000);
  assert.equal(projectDemo(analyticsBook,{from:'2026-11-03',to:'2026-11-05'}).totals.newBorrowers,1);
});

import { analyticsBuckets, analyticsRankValue, collectionRows } from '../site/raschet/demo-analytics.js';
test('exact history scope is independent of name and combines with dates',()=>{
  assert.deepEqual(ids({clientId:'a',from:'2026-11-02',to:'2026-11-02'}),['payment']);
  assert.deepEqual(ids({clientId:'b',query:'Анна'}),[]);
});
test('book filters retain global cancellation and inclusive dates',()=>{
  const groups=bookDays(analyticsBook,'debt',{clientId:'b',from:'2026-11-04',to:'2026-11-04'});
  assert.equal(groups.length,1);assert.equal(groups[0].total,0);assert.equal(groups[0].entries[0].id,'3');
  assert.deepEqual(bookDays(analyticsBook,'debt',{from:'2026-11-05'}),[]);
});
test('interactive chart partitions every day and reconciles balance and movement',()=>{
  const range={from:'2026-11-01',to:'2026-11-30'},data=projectDemo(analyticsBook,range);
  const buckets=analyticsBuckets(data,range,4);
  assert.equal(buckets.length,4);assert.equal(buckets[0].from,range.from);assert.equal(buckets.at(-1).to,range.to);
  assert.equal(buckets.at(-1).closing,data.totals.end);
  assert.equal(buckets.reduce((n,b)=>n+b.debt,0),data.totals.movementDebt);
  assert.equal(buckets.reduce((n,b)=>n+b.cancelDebt,0),data.totals.cancelDebt);
  assert.ok(buckets.slice(1).every((b,i)=>b.opening===buckets[i].closing));
  assert.equal(analyticsBuckets(projectDemo(analyticsBook,{from:'2026-11-30',to:'2026-11-30'}),{from:'2026-11-30',to:'2026-11-30'}).length,1);
});
test('new and settled rankings use amounts rather than boolean flags',()=>{
  const range={from:'2026-11-01',to:'2026-11-30'};
  assert.equal(analyticsRankValue({firstDebt:'2026-11-02',debt:1200},'new',null,range),1200);
  assert.equal(analyticsRankValue({start:2000,end:0},'settled',null,range),2000);
  assert.equal(analyticsRankValue({firstDebt:'2026-10-01',debt:1200},'new',null,range),0);
});
test('collections prioritize overdue, then upcoming and exclude closed customers',()=>{
  const items=[{id:'a',name:'А',balance:900,overdue:0,soon:0},{id:'b',name:'Б',balance:50,overdue:50,soon:0},{id:'c',name:'В',balance:200,overdue:0,soon:200},{id:'d',name:'Г',balance:0,overdue:0,soon:0}];
  assert.deepEqual(collectionRows(items).map(c=>c.id),['b','c','a']);
  assert.deepEqual(collectionRows(items,'','urgent').map(c=>c.id),['b','c']);
  assert.deepEqual(collectionRows(items,'в','soon').map(c=>c.id),['c']);
});
