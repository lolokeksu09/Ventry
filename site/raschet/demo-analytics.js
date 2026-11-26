function localDay(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}

export function periodRange(preset, day, entries) {
  const d = new Date(day+'T12:00:00Z');
  if (preset === 'week') d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  if (preset === 'month') d.setUTCDate(1);
  const from = preset === 'all' ? entries.map(e=>localDay(e.date)).filter(x=>x<=day).sort()[0] || day : d.toISOString().slice(0,10);
  return {from,to:day};
}

export function projectDemo(book, {from,to}, clientId='') {
  const entries=book.entries.filter(e=>!clientId||e.clientId===clientId);
  const originals=new Map(entries.map(e=>[e.id,e]));
  const cancelled=new Set(entries.filter(e=>e.type==='reversal'&&localDay(e.date)<=to).map(e=>e.reverses));
  const rows=new Map(book.clients.filter(c=>!clientId||c.id===clientId).map(c=>[c.id,{id:c.id,name:c.name,start:0,end:0,debt:0,payment:0,debtCount:0,paymentCount:0,cancelDebt:0,cancelPayment:0,maxDebt:0}]));
  const days=new Map();
  for(const e of entries){
    const day=localDay(e.date);
    if(day>to)continue;
    const r=rows.get(e.clientId);
    const kind=e.type==='reversal'?originals.get(e.reverses).type:e.type;
    const delta=(kind==='debt'?1:-1)*(e.type==='reversal'?-1:1)*e.amount;
    r.end+=delta;
    if(day<from){r.start+=delta;continue;}
    if(e.type==='reversal'){r[kind==='debt'?'cancelDebt':'cancelPayment']+=e.amount;continue;}
    if(cancelled.has(e.id))continue;
    r[kind]+=e.amount;r[kind+'Count']++;
    if(kind==='debt')r.maxDebt=Math.max(r.maxDebt,e.amount);
    const daily=days.get(day)||{day,debt:0,payment:0};
    daily[kind]+=e.amount;days.set(day,daily);
  }
  const customers=[...rows.values()];
  const totals={};
  for(const key of ['start','end','debt','payment','debtCount','paymentCount','cancelDebt','cancelPayment'])totals[key]=customers.reduce((n,c)=>n+c[key],0);
  totals.maxDebt=Math.max(0,...customers.map(c=>c.maxDebt));
  totals.debtors=customers.filter(c=>c.end>0).length;
  return {totals,customers,days:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day))};
}
