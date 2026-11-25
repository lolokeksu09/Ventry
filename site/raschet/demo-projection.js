import { today } from './ledger.js';

export function localDay(value) {
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))throw Error('Некорректная дата');
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
const dateObject = value => new Date(value+'T12:00:00');
export function shiftDay(value,delta){const d=dateObject(value);d.setDate(d.getDate()+delta);return localDay(d);}
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(dateObject(value).getTime())&&localDay(dateObject(value))===value;

export function periodRange(preset,now=today(),book=null){
  if(!validDay(now))throw Error('Некорректная дата');
  const d=dateObject(now),year=d.getFullYear(),month=d.getMonth()+1;
  const first=m=>year+'-'+String(m).padStart(2,'0')+'-01';
  let from;
  switch(preset){
    case 'day':from=now;break;
    case 'week':from=shiftDay(now,-((d.getDay()+6)%7));break;
    case 'month':from=first(month);break;
    case 'quarter':from=first(Math.floor((month-1)/3)*3+1);break;
    case 'year':from=first(1);break;
    case 'all':from=(book?.entries||[]).map(e=>localDay(e.date)).filter(day=>day<=now).sort()[0]||now;break;
    default:throw Error('Неизвестный период');
  }
  return {from,to:now};
}
export function previousRange(from,to){
  if(!validDay(from)||!validDay(to)||from>to)throw Error('Некорректный период');
  const length=Math.round((Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000)+1;
  return {from:shiftDay(from,-length),to:shiftDay(from,-1)};
}
export function calendarDays(book){
  const groups=new Map();
  for(const e of book.entries){
    const date=localDay(e.date);
    if(!groups.has(date))groups.set(date,[]);
    groups.get(date).push(e);
  }
  return [...groups].sort(([a],[b])=>b.localeCompare(a)).map(([date,entries])=>({date,entries}));
}
const sum = values => values.reduce((a,b)=>a+b,0);

export function projectAnalytics(book,from,to,clientId=null){
  if(!validDay(from)||!validDay(to)||from>to)throw Error('Дата начала позже окончания или неверна');
  const clients=book.clients.filter(c=>!clientId||c.id===clientId);
  const ids=new Set(clients.map(c=>c.id));
  const entries=book.entries.filter(e=>ids.has(e.clientId)&&localDay(e.date)<=to);
  const originals=new Map(book.entries.map(e=>[e.id,e]));
  const reversed=new Set(entries.filter(e=>e.type==='reversal').map(e=>e.reverses));
  const delta=e=>e.type==='debt'?e.amount:e.type==='payment'?-e.amount:originals.get(e.reverses)?.type==='debt'?-e.amount:e.amount;
  const openingBy=new Map(clients.map(c=>[c.id,0])),closingBy=new Map(openingBy),stats=new Map(clients.map(c=>[c.id,{id:c.id,name:c.name,debts:0,payments:0,debtCount:0,paymentCount:0}]));
  const range=entries.filter(e=>localDay(e.date)>=from);
  for(const e of entries){
    closingBy.set(e.clientId,closingBy.get(e.clientId)+delta(e));
    if(localDay(e.date)<from)openingBy.set(e.clientId,openingBy.get(e.clientId)+delta(e));
  }
  const totals={debts:0,payments:0,debtCount:0,paymentCount:0,debtReversals:0,paymentReversals:0,effectiveDebts:0,effectivePayments:0,effectiveDebtCount:0,effectivePaymentCount:0,maximumDebt:0};
  const days=new Map();
  for(const e of range){
    const day=localDay(e.date),bucket=days.get(day)||{delta:0,debts:0,payments:0};
    bucket.delta+=delta(e);
    if(e.type==='debt'){
      totals.debts+=e.amount;totals.debtCount++;bucket.debts+=e.amount;
      if(!reversed.has(e.id)){const c=stats.get(e.clientId);totals.effectiveDebts+=e.amount;totals.effectiveDebtCount++;totals.maximumDebt=Math.max(totals.maximumDebt,e.amount);c.debts+=e.amount;c.debtCount++;}
    }else if(e.type==='payment'){
      totals.payments+=e.amount;totals.paymentCount++;bucket.payments+=e.amount;
      if(!reversed.has(e.id)){const c=stats.get(e.clientId);totals.effectivePayments+=e.amount;totals.effectivePaymentCount++;c.payments+=e.amount;c.paymentCount++;}
    }else if(originals.get(e.reverses)?.type==='debt')totals.debtReversals+=e.amount;
    else totals.paymentReversals+=e.amount;
    days.set(day,bucket);
  }
  const opening=sum([...openingBy.values()]),closing=sum([...closingBy.values()]);
  let running=opening;
  const series=[{date:from,closing:opening,debts:0,payments:0,opening:true}];
  for(const [date,bucket] of [...days].sort(([a],[b])=>a.localeCompare(b))){running+=bucket.delta;series.push({date,closing:running,debts:bucket.debts,payments:bucket.payments});}
  if(series.at(-1).date!==to||series.length===1)series.push({date:to,closing,debts:0,payments:0});
  return {...totals,opening,closing,net:closing-opening,closingDebtors:[...closingBy.values()].filter(n=>n>0).length,activeCustomers:new Set(range.map(e=>e.clientId)).size,borrowingCustomers:[...stats.values()].filter(c=>c.debtCount>0).length,clients:[...stats.values()].map(c=>({...c,opening:openingBy.get(c.id),closing:closingBy.get(c.id)})),series};
}
