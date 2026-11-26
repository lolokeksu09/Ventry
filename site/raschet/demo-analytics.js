function localDay(value){if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}

export function shiftDay(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}

export function periodRange(preset,day,entries,custom=null){
  const d=new Date(day+'T12:00:00Z');
  if(preset==='custom'){if(!custom?.from||!custom?.to||custom.from>custom.to||custom.to>day)throw Error('Укажите корректный период без будущих дат.');return {from:custom.from,to:custom.to}}
  if(preset==='week')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  if(['month','quarter','year'].includes(preset))d.setUTCDate(1);
  if(preset==='quarter')d.setUTCMonth(Math.floor(d.getUTCMonth()/3)*3);
  if(preset==='year')d.setUTCMonth(0);
  return {from:preset==='all'?entries.map(e=>localDay(e.date)).filter(x=>x<=day).sort()[0]||day:d.toISOString().slice(0,10),to:day};
}

export function previousRange(preset,range){
  if(preset==='all')return null;
  const elapsed=Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000);
  let from;
  if(['custom','today','week'].includes(preset))from=shiftDay(range.from,preset==='week'?-7:-elapsed-1);
  else{const d=new Date(range.from+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-({month:1,quarter:3,year:12}[preset]));from=d.toISOString().slice(0,10)}
  return {from,to:[shiftDay(from,elapsed),shiftDay(range.from,-1)].sort()[0]};
}

export function bookDays(book,kind,{clientId='',from='',to=''}={}){
  const reversed=new Set(book.entries.filter(e=>e.type==='reversal').map(e=>e.reverses)),groups=new Map();
  for(const e of book.entries.filter(e=>e.type===kind)){const day=localDay(e.date);if((clientId&&e.clientId!==clientId)||(from&&day<from)||(to&&day>to))continue;const g=groups.get(day)||{day,entries:[],total:0};g.entries.push(e);if(!reversed.has(e.id))g.total+=e.amount;groups.set(day,g)}
  return [...groups.values()].sort((a,b)=>b.day.localeCompare(a.day));
}

export function calendarDays(month){
  const start=month+'-01',d=new Date(start+'T12:00:00Z'),offset=(d.getUTCDay()+6)%7;
  d.setUTCMonth(d.getUTCMonth()+1);
  const count=Math.round((d-Date.parse(start+'T12:00:00Z'))/86400000);
  return [...Array(offset).fill(null),...Array.from({length:count},(_,i)=>shiftDay(start,i))];
}

export function projectDemo(book,{from,to},clientId=''){
  const entries=book.entries.filter(e=>!clientId||e.clientId===clientId);
  const originals=new Map(entries.map(e=>[e.id,e]));
  const cancelled=new Set(entries.filter(e=>e.type==='reversal'&&localDay(e.date)<=to).map(e=>e.reverses));
  const rows=new Map(book.clients.filter(c=>!clientId||c.id===clientId).map(c=>[c.id,{id:c.id,name:c.name,start:0,end:0,debt:0,payment:0,debtCount:0,paymentCount:0,cancelDebt:0,cancelPayment:0,maxDebt:0,movementDebt:0,movementPayment:0,activity:0,firstDebt:null,lastDebt:null,lastPayment:null}]));
  const days=new Map();
  for(const e of entries){
    const day=localDay(e.date);if(day>to)continue;
    const r=rows.get(e.clientId),reversal=e.type==='reversal';
    const kind=reversal?originals.get(e.reverses).type:e.type;
    const delta=(kind==='debt'?1:-1)*(reversal?-1:1)*e.amount;
    r.end+=delta;
    if(!reversal&&!cancelled.has(e.id)){
      if(kind==='debt'){if(!r.firstDebt||day<r.firstDebt)r.firstDebt=day;if(!r.lastDebt||day>r.lastDebt)r.lastDebt=day;}
      else if(!r.lastPayment||day>r.lastPayment)r.lastPayment=day;
    }
    if(day<from){r.start+=delta;continue;}
    r.activity++;
    const daily=days.get(day)||{day,debt:0,payment:0,cancelDebt:0,cancelPayment:0,delta:0};
    daily.delta+=delta;
    if(reversal){const key=kind==='debt'?'cancelDebt':'cancelPayment';r[key]+=e.amount;daily[key]+=e.amount;}
    else{
      r[kind==='debt'?'movementDebt':'movementPayment']+=e.amount;daily[kind]+=e.amount;
      if(!cancelled.has(e.id)){r[kind]+=e.amount;r[kind+'Count']++;if(kind==='debt')r.maxDebt=Math.max(r.maxDebt,e.amount);}
    }
    days.set(day,daily);
  }
  const customers=[...rows.values()],totals={};
  for(const key of ['start','end','debt','payment','debtCount','paymentCount','cancelDebt','cancelPayment','movementDebt','movementPayment'])totals[key]=customers.reduce((n,c)=>n+c[key],0);
  totals.maxDebt=Math.max(0,...customers.map(c=>c.maxDebt));
  totals.debtors=customers.filter(c=>c.end>0).length;
  totals.active=customers.filter(c=>c.activity>0).length;
  totals.borrowers=customers.filter(c=>c.debtCount>0).length;
  totals.newBorrowers=customers.filter(c=>c.firstDebt&&c.firstDebt>=from).length;
  totals.settled=customers.filter(c=>c.start>0&&c.end===0).length;
  let closing=totals.start;
  const daily=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(d=>({...d,closing:closing+=d.delta}));
  if(closing!==totals.end)throw Error('Нарушена согласованность остатков.');
  return {totals,customers,days:daily};
}

/** Contiguous bounded intervals for an interactive chart, including days without operations. */
export function analyticsBuckets(data,range,limit=24){
  const count=Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1;
  if(!Number.isSafeInteger(count)||count<1||!Number.isInteger(limit)||limit<1||limit>60)throw Error('Некорректный диапазон графика.');
  const step=Math.ceil(count/limit),buckets=[];let closing=data.totals.start,index=0;
  for(let offset=0;offset<count;offset+=step){
    const from=shiftDay(range.from,offset),to=shiftDay(range.from,Math.min(count-1,offset+step-1));
    const bucket={from,to,opening:closing,closing,debt:0,payment:0,cancelDebt:0,cancelPayment:0};
    while(index<data.days.length&&data.days[index].day<=to){
      const day=data.days[index++];
      for(const key of ['debt','payment','cancelDebt','cancelPayment'])bucket[key]+=day[key];
      closing=day.closing;
    }
    bucket.closing=closing;buckets.push(bucket);
  }
  if(index!==data.days.length||closing!==data.totals.end)throw Error('Некорректный остаток графика.');
  return buckets;
}
/** Android ranking semantics: new borrowers ranked by debts, settled by opening balance. */
export function analyticsRankValue(customer,mode,current,range){
  if(mode==='balance'||mode==='overdue')return current?.[mode]||0;
  if(mode==='new')return customer.firstDebt&&customer.firstDebt>=range.from&&customer.firstDebt<=range.to?customer.debt:0;
  if(mode==='settled')return customer.start>0&&customer.end===0?customer.start:0;
  return ['debt','debtCount','payment'].includes(mode)?customer[mode]:0;
}
export function collectionRows(items,query='',mode='all'){
  const q=query.trim().toLocaleLowerCase('ru');
  const priority=c=>c.overdue>0?0:c.soon>0?1:2;
  return items.filter(c=>c.balance>0&&(!q||[c.name,c.phone||''].some(s=>s.toLocaleLowerCase('ru').includes(q)))&&
    (mode==='urgent'?priority(c)<2:mode==='overdue'?priority(c)===0:mode==='soon'?c.soon>0:true))
    .sort((a,b)=>priority(a)-priority(b)||b.overdue-a.overdue||b.soon-a.soon||b.balance-a.balance||a.name.localeCompare(b.name,'ru'));
}
