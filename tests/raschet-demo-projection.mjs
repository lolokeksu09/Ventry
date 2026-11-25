import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAnalytics,calendarDays,localDay,periodRange} from '../site/raschet/demo-projection.js';
const clients=[{id:'a',name:'А',phone:''},{id:'b',name:'Б',phone:''}];
const op=(id,clientId,type,amount,date,reverses)=>({id,clientId,type,amount,date:date+'T12:00:00',due:'',note:'Демо',...(reverses?{reverses}:{})});
const book={version:2,clients,entries:[
 op('d1','a','debt',35000,'2026-10-31'),
 op('d2','a','debt',20000,'2026-11-02'),
 op('p1','a','payment',10000,'2026-11-03'),
 op('d3','b','debt',5000,'2026-11-04'),
 op('r1','a','reversal',10000,'2026-11-05','p1'),
 op('p2','b','payment',5000,'2026-11-06'),
 op('r2','a','reversal',20000,'2026-12-01','d2')
]};
test('historical cutoff: later reversal does not rewrite prior period',()=>{
 const r=projectAnalytics(book,'2026-11-01','2026-11-04');
 assert.equal(r.opening,35000);assert.equal(r.closing,50000);
 assert.equal(r.debts,25000);assert.equal(r.payments,10000);
 assert.equal(r.debtCount,2);assert.equal(r.paymentCount,1);
});
test('reversals distinguish movements and effective operations',()=>{
 const r=projectAnalytics(book,'2026-11-01','2026-11-30');
 assert.equal(r.closing,55000);assert.equal(r.paymentReversals,10000);
 assert.equal(r.effectivePayments,5000);assert.equal(r.effectivePaymentCount,1);
 assert.equal(r.closingDebtors,1);
 assert.equal(r.series.at(-1).closing,r.closing);
});
test('personal statistics are scoped to client',()=>{
 const r=projectAnalytics(book,'2026-11-01','2026-11-30','a');
 assert.equal(r.opening,35000);assert.equal(r.closing,55000);
 assert.equal(r.effectiveDebtCount,1);assert.equal(r.effectivePayments,0);
 assert.equal(r.clients.length,1);
});
test('calendar groups local dates and retains reversals',()=>{
 const days=calendarDays(book);
 assert.equal(days.find(d=>d.date==='2026-11-05').entries[0].id,'r1');
 assert.equal(localDay('2026-11-05T12:00:00'),'2026-11-05');
 assert.equal(days.length,7);
});
test('period boundaries and sparse series',()=>{
 assert.deepEqual(periodRange('week','2026-11-26'),{from:'2026-11-23',to:'2026-11-26'});
 assert.deepEqual(periodRange('month','2026-11-26'),{from:'2026-11-01',to:'2026-11-26'});
 assert.throws(()=>projectAnalytics(book,'2026-12-01','2026-11-01'));
 const r=projectAnalytics(book,'2000-01-01','2026-11-30');
 assert.ok(r.series.length<=book.entries.length+2);
});
