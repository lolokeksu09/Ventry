import {MAX_AMOUNT,today,moneyToCents,balance,debtOverview,validateBook,addEntry,demoBook,activeEntries} from './ledger.js';
import { filterHistory, historyPage, HISTORY_PAGE_SIZE } from './history.js';
import { listBackups } from './backups.js';
import { periodRange, previousRange, projectDemo, bookDays, calendarDays, analyticsBuckets, analyticsRankValue, collectionRows } from './demo-analytics.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const blank=()=>({version:2,clients:[],entries:[]});
const mode='demo';
let book=blank(),filter='all',entryClient='',entryType='debt',detailId='',loadBlocked=false,editClientId='',reverseEntryId='';
let writing=false;
const rub=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:n%100?2:0}).format(n/100);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText=s=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(s.length===10?s+'T12:00:00':s));
const id=()=>crypto.randomUUID();
function toast(message){const error=$('dialog[open] .dialog-error');if(error){error.textContent=message;error.hidden=false;}$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),5500);}
function load() {
  book = demoBook();
  render();
}
async function save(next) {
  if (writing) throw Error('Действие уже выполняется.');
  if (next.clients.length > 30 || next.entries.length > 100) throw Error('Лимит демонстрации достигнут. Начните пример заново.');
  writing = true;
  try {
    book = validateBook(next);
    render();
  } finally { writing = false; }
}
function switchView(view){
  if(view==='dates')view='book';
  if(!['book','clients','history','statistics','settings','collections'].includes(view))view='book';
  const changed=!$('#view-'+view).hidden?false:true;
  $$('.view').forEach(el=>el.hidden=el.id!=='view-'+view);
  $$('.sidebar nav [data-view]').forEach(el=>{const active=el.dataset.view===(['statistics','collections'].includes(view)?'book':view);el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current')});
  if(location.hash!=='#'+view)location.hash=view;
  if(changed)window.scrollTo(0,0);
  if(view==='settings')refreshLegacyBackups();
  if(view==='collections')renderCollections();
}
$('#stats-back').onclick=()=>{switchView(statsReturn);statsReturn='book'};
$('#book-collections').onclick=()=>{switchView('collections');$('#collection-search').focus()};
$('#collections-back').onclick=()=>switchView('book');
$$('.report-link').forEach(b=>b.onclick=()=>{statsSection='reports';renderStats();switchView('statistics');$('#stats-history').focus()});
$('#today').textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date());
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));
function resetDemo() {
  if (writing) return;
  lastDemoPayment = null;
  dismissScenario();
  filter = 'all';
  $('#search').value = '';
  historyForm.reset();
  $('#collection-search').value='';$('#collection-mode').value='all';
  $('#book-client').value='';$('#book-from').value='';$('#book-to').value='';$('#book-filter-panel').open=false;
  statsSection='summary';chartSelection=0;chartKey='';
  $('#stats-period').value='month';
  $('#stats-client').value='';$('#stats-rank').value='balance';
  $('#stats-from').value=today();$('#stats-to').value=today();
  dateKind='debt';dateMode='list';dateSelected=today();dateMonth=dateSelected.slice(0,7);
  currentHistoryPage = 0;
  load();
  switchView('book');
  toast('Демонстрация начата заново.');
}
$('#switch-mode').onclick = () => { $('#confirm-dialog').showModal(); };
$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
$('#search').oninput=render;
$$('[data-open-filter]').forEach(button => button.onclick = () => {
  filter = button.dataset.openFilter;
  $('#search').value = '';
  render();
  switchView('clients');$('#client-panel').focus();
});

function deadlineNote(client) {
  if (filter === 'soon' && client.soonDate) {
    return `<small class="deadline-note">До ${dateText(client.soonDate)} · ${rub(client.soon)} за 7 дней</small>`;
  }
  if (client.overdue) return `<small class="deadline-note deadline-late">Просрочено ${rub(client.overdue)}</small>`;
  if (client.nextDue) return `<small class="deadline-note">Ближайший срок: ${dateText(client.nextDue)}</small>`;
  return '';
}
function historyRows(entries){
  if(!entries.length)return '<div class="empty"><p>Операций пока нет.</p></div>';
  const reversed=new Set(book.entries.filter(e=>e.type==='reversal').map(e=>e.reverses));
  const clients = new Map(book.clients.map(client => [client.id, client]));
  const originals = new Map(book.entries.map(entry => [entry.id, entry]));
  return [...entries].reverse().map(e=>{const c=clients.get(e.clientId),cancelled=reversed.has(e.id),original=e.type==='reversal'?originals.get(e.reverses):null;
    const label=original?`Отмена ${original.type==='debt'?'долга':'оплаты'}`:e.type==='payment'?'Принята оплата':'Записан долг';
    const sign=original?(original.type==='debt'?'−':'+'):e.type==='payment'?'−':'+';
    return `<div data-operation-id="${esc(e.id)}" class="history-row ${cancelled?'cancelled':''}"><div><strong>${esc(c.name)}</strong><small>${label} · ${dateText(e.date)}${cancelled?' · Отменено':''}</small>${e.note?`<small>${esc(e.note)}</small>`:''}${e.due?`<small>Вернуть до ${dateText(e.due)}</small>`:''}</div><div class="history-amount ${e.type}"><strong>${sign}${rub(e.amount)}</strong></div></div>`;
  }).join('');
}
const historyForm = $('#history-filters');
const historyControls = historyForm.elements;
const historyExport = $('#history-export');
let currentHistoryPage = 0;

function historySelection() {
  const { query, kind, from, to, clientId } = historyControls;
  const rangeError = Boolean(from.value && to.value && from.value > to.value);
  return {
    rangeError,
    entries: rangeError ? [] : filterHistory(book, {
      query: query.value, kind: kind.value, from: from.value, to: to.value, clientId: clientId.value,
    }),
  };
}

function refreshClientSelect(select,label){
  const current=select.value;
  select.innerHTML='<option value="">'+label+'</option>'+book.clients.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  select.value=book.clients.some(c=>c.id===current)?current:'';
}
function openHistoryScope(clientId='',range=null){
  historyForm.reset();historyControls.clientId.value=clientId;
  if(range){historyControls.from.value=range.from;historyControls.to.value=range.to;}
  currentHistoryPage=0;renderHistory();switchView('history');$('#history-filters').focus();
}
function renderHistory() {
  const { rangeError, entries } = historySelection();
  $('#history-error').hidden = !rangeError;
  historyControls.to.setAttribute('aria-invalid', String(rangeError));
  $('#history-count').textContent = rangeError ? '' : `Найдено: ${entries.length} из ${book.entries.length}`;
  historyExport.disabled = loadBlocked || !entries.length;
  const slice = historyPage(entries, currentHistoryPage);
  currentHistoryPage = slice.page;
  $('#history-pagination').hidden = rangeError || slice.pages <= 1;
  $('#history-page-status').textContent = `Страница ${slice.page + 1} из ${slice.pages}`;
  $('#history-newer').disabled = slice.page === 0;
  $('#history-older').disabled = slice.page + 1 >= slice.pages;
  $('#history').innerHTML = rangeError ? '' : entries.length || !book.entries.length
    ? historyRows(slice.entries)
    : '<div class="empty"><p>По этим фильтрам ничего не найдено.</p></div>';
}

historyForm.addEventListener('submit', event => event.preventDefault());
historyForm.addEventListener('input', () => { currentHistoryPage = 0; renderHistory(); });
$('#history-newer').onclick = () => { currentHistoryPage--; renderHistory(); };
$('#history-older').onclick = () => { currentHistoryPage++; renderHistory(); };
$('#history-reset').addEventListener('click', () => {
  historyForm.reset();
  currentHistoryPage = 0;
  renderHistory();
});
historyExport.addEventListener('click', () => {
  const { entries } = historySelection();
  if (!loadBlocked && entries.length) exportHistoryCsv([...entries].reverse(), true);
});

const demoGuide = $('#demo-guide');
const demoPayment = $('#demo-payment');
const demoOperation = $('#demo-operation');
let demoCustomer;
let demoEntry = false;
let lastDemoPayment = null;

function renderDemoOperation() {
  const payment = !loadBlocked && mode === 'demo' && lastDemoPayment
    ? book.entries.find(entry => entry.id === lastDemoPayment.id)
    : null;
  demoOperation.hidden = !payment;
  $('#demo-result').hidden = !payment;
  if (payment) {
    $('#demo-result-summary').textContent = `Записано ${rub(payment.amount)}. Остаток после оплаты — ${rub(lastDemoPayment.remaining)}.`;
  }
}

demoOperation.onclick = () => {
  historyForm.reset();
  const index = book.entries.findIndex(entry => entry.id === lastDemoPayment?.id);
  currentHistoryPage = index < 0 ? 0 : Math.floor((book.entries.length - 1 - index) / HISTORY_PAGE_SIZE);
  switchView('history');
  renderHistory();
  const row = $$('#history [data-operation-id]').find(item => item.dataset.operationId === lastDemoPayment?.id);
  if (row) {
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'center' });
  }
};

$('#demo-return').onclick = () => {
  switchView('book');
  demoOperation.focus();
};
function renderDemoGuide(clients) {
  demoGuide.hidden = mode !== 'demo';
  if (demoGuide.hidden) return;
  demoCustomer = clients.find(client => client.id === 'demo-0' && client.balance > 1)
    ?? clients.find(client => client.balance > 1);
  const copy = $('#demo-guide-description');
  if (loadBlocked) {
    copy.textContent = 'Не удалось открыть пример. Начните его заново, чтобы продолжить.';
  } else if (demoCustomer) {
    copy.textContent = `У клиента ${demoCustomer.name} остаток ${rub(demoCustomer.balance)}. Отметьте частичную оплату и посмотрите, сколько останется.`;
  } else {
    copy.textContent = 'В этой книге больше нет долга, который можно погасить частично. Начните пример заново, чтобы повторить.';
  }
  demoPayment.disabled = loadBlocked || !demoCustomer;
}

demoPayment.onclick = () => {
  if (mode !== 'demo' || loadBlocked || !demoCustomer) return;
  const amount = Math.min(100_000, Math.floor(demoCustomer.balance / 2));
  openEntry(demoCustomer.id, 'payment', { fromDemoGuide: true });
  entryAmount.value = (amount / 100).toFixed(2).replace('.', ',');
  updateEntryBalance();
};
$('#demo-restart').onclick = () => {
  $('#confirm-dialog').showModal();
};

let quickKind='debt';
function renderQuickActions(){
  const select=$('#quick-client'),selected=select.value;
  const clients=book.clients.filter(c=>quickKind==='debt'||balance(book,c.id)>0);
  select.innerHTML=clients.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  if(clients.some(c=>c.id===selected))select.value=selected;
  $('#quick-continue').disabled=!select.value;
  $('#quick-payment').disabled=!book.clients.some(c=>balance(book,c.id)>0);
}
function openQuick(kind){
  quickKind=kind;renderQuickActions();
  $('#quick-title').textContent=kind==='debt'?'Записать долг':'Принять оплату';
  $('#quick-new').hidden=kind==='payment';
  $('#quick-dialog').showModal();
}
$('#quick-client').onchange=()=>$('#quick-continue').disabled=!$('#quick-client').value;
$('#quick-debt').onclick=()=>openQuick('debt');
$('#quick-payment').onclick=()=>openQuick('payment');
$('#quick-continue').onclick=()=>{const id=$('#quick-client').value;if(!id)return;$('#quick-dialog').close();openEntry(id,quickKind)};
$('#quick-new').onclick=()=>{$('#quick-dialog').close();openClient()};
function render(){
  $('#mode-label').textContent='ДЕМО · ВЫМЫШЛЕННЫЕ ДАННЫЕ';$('#mode-label').classList.add('demo');
  const summary = debtOverview(book);
  const items = book.clients.map(client => ({ ...client, ...summary.get(client.id) }));
  renderDemoGuide(items);
  renderDemoOperation();
  const total = field => rub(items.reduce((sum, client) => sum + client[field], 0));
  $('#total').textContent = total('balance');
  $('#overdue').textContent = total('overdue');
  $('#due-soon').textContent = total('soon');
  $('#active-count').textContent = `Должников: ${items.filter(client => client.balance > 0).length}`;
  $('#paid-month').textContent=rub(activeEntries(book).filter(e=>{const d=new Date(e.date),n=new Date();return e.type==='payment'&&d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();}).reduce((n,e)=>n+e.amount,0));
  $('#client-count').textContent = book.clients.length;
  renderQuickActions();
  $$('[data-filter]').forEach(button => {
    const selected = filter === button.dataset.filter;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const q = $('#search').value.trim().toLowerCase();
  const matches = {
    all: () => true,
    debt: c => c.balance > 0,
    overdue: c => c.overdue > 0,
    soon: c => c.soon > 0,
    closed: c => c.balance === 0,
  };
  const shown = items.filter(c => `${c.name} ${c.phone}`.toLowerCase().includes(q) && matches[filter](c))
    .sort((a, b) => (filter === 'soon' ? a.soonDate.localeCompare(b.soonDate) : b.overdue - a.overdue)
      || b.balance - a.balance || a.name.localeCompare(b.name, 'ru'));
  $('#clients').innerHTML=shown.length?shown.map(c=>`<div class="client-row"><button class="client-person" data-detail="${esc(c.id)}"><span class="avatar">${esc(c.name.split(/\s+/).slice(0,2).map(n=>n[0]).join(''))}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.phone||'Открыть историю клиента')}</small></span></button><div class="balance">${rub(c.balance)}<small>${c.balance?'остаток долга':'всё оплачено'}</small>${deadlineNote(c)}</div><div class="status ${c.overdue?'late':''}">${c.overdue?'◷ Срок прошёл':c.balance?'Ведём учёт':'✓ Расчёт закрыт'}</div><div class="row-actions"><button class="debt" data-entry="debt" data-client="${esc(c.id)}">＋ В долг</button><button class="pay" data-entry="payment" data-client="${esc(c.id)}" ${c.balance?'':'disabled'}>Принять оплату</button></div></div>`).join(''):`<div class="empty"><div class="empty-symbol">д.</div><h3>${book.clients.length?'Ничего не найдено':'Начните с первого клиента'}</h3><p>${book.clients.length?'Попробуйте другое имя или измените фильтр.':'Добавьте имя, запишите сумму — остаток посчитается автоматически.'}</p>${book.clients.length?'':'<button class="secondary" id="empty-add">＋ Добавить клиента</button>'}</div>`;
  $('#empty-add')?.addEventListener('click',openClient);$$('[data-entry]').forEach(b=>b.onclick=()=>openEntry(b.dataset.client,b.dataset.entry));$$('[data-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
  refreshClientSelect($('#history-client'),'Все клиенты');refreshClientSelect($('#book-client'),'Все клиенты');
  renderHistory();
  renderStats();
  renderDates();
  renderCollections();
  $('#book-note').textContent='Это интерактивный пример Android-приложения. Изменения живут только до перезагрузки страницы; реальные данные не вводятся.';
}


function renderCollections(){
  const overview=debtOverview(book),items=book.clients.map(c=>({...c,...overview.get(c.id)}));
  $('#collection-overdue').textContent=rub(items.reduce((n,c)=>n+c.overdue,0));
  $('#collection-soon').textContent=rub(items.reduce((n,c)=>n+c.soon,0));
  const shown=collectionRows(items,$('#collection-search').value,$('#collection-mode').value);
  $('#collection-count').textContent='Должников: '+shown.length;
  $('#collection-list').innerHTML=shown.length?shown.map(c=>'<article class="card collection-row"><div><button type="button" class="collection-name" data-collection-client="'+esc(c.id)+'">'+esc(c.name)+'</button><p class="muted">'+(c.overdue?'Просрочено '+rub(c.overdue):c.soon?'За 7 дней '+rub(c.soon):'Без срочного срока')+'</p></div><strong>'+rub(c.balance)+'</strong><button type="button" class="primary collection-pay" data-collection-pay="'+esc(c.id)+'">Принять оплату</button></article>').join(''):'<p class="empty">Нет должников по выбранным условиям.</p>';
  $$('[data-collection-client]').forEach(b=>b.onclick=()=>openDetail(b.dataset.collectionClient));
  $$('[data-collection-pay]').forEach(b=>b.onclick=()=>openEntry(b.dataset.collectionPay,'payment'));
}
$('#collection-search').oninput=renderCollections;
$('#collection-mode').onchange=renderCollections;
let dateKind='debt',dateMode='list',dateSelected=today(),dateMonth=dateSelected.slice(0,7);
function renderDates(){
  const from=$('#book-from').value,to=$('#book-to').value,clientId=$('#book-client').value;
  const invalid=!!((from&&to&&from>to)||(from&&from>today())||(to&&to>today()));
  const groups=invalid?[]:bookDays(book,dateKind,{from,to,clientId});
  $('#book-filter-error').hidden=!invalid;
  $('#book-from').setAttribute('aria-invalid',String(invalid));$('#book-to').setAttribute('aria-invalid',String(invalid));
  const filtered=!!(from||to||clientId);
  $('#book-filter-status').hidden=!filtered||invalid;
  $('#book-filter-status').textContent='По фильтру: '+rub(groups.reduce((sum,g)=>sum+g.total,0))+' · записей '+groups.reduce((sum,g)=>sum+g.entries.length,0);
  for(const [id,active] of [['dates-debt',dateKind==='debt'],['dates-payment',dateKind==='payment'],['dates-list',dateMode==='list'],['dates-calendar',dateMode==='calendar']])$('#'+id).setAttribute('aria-pressed',String(active));
  $('#calendar-panel').hidden=dateMode!=='calendar';$('#week-grid').hidden=dateMode==='calendar';$('#dates-list').hidden=dateMode==='list';$('#dates-calendar').hidden=dateMode==='calendar';$('#dates-heading').textContent=dateKind==='payment'?'Полученные оплаты':'Записи по датам';
  const counts=new Map(groups.map(g=>[g.day,g.entries.length]));
  $('#calendar-month').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(dateMonth+'-01T12:00:00'));
  const monday=new Date(dateSelected+'T12:00:00Z');monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
  const week=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10)});
  $('#calendar-next').disabled=dateMode==='calendar'?dateMonth>=today().slice(0,7):week.at(-1)>=today();
  const weekdays=['пн','вт','ср','чт','пт','сб','вс'];
  const dateDescription=(day,id)=>'<span hidden id="'+id+'">'+dateText(day)+', записей: '+(counts.get(day)||0)+'</span>';
  $('#week-grid').innerHTML=week.map((day,i)=>{
    const number=Number(day.slice(-2)),count=counts.get(day)||'—',id='week-date-description-'+day;
    return '<button type="button" class="calendar-day week-day" data-day="'+day+'" aria-describedby="'+id+'" aria-pressed="'+(day===dateSelected)+'" '+(day>today()?'disabled':'')+'><small>'+weekdays[i]+'</small> <strong>'+number+'</strong> <small>'+count+'</small>'+dateDescription(day,id)+'</button>';
  }).join('');
  $('#calendar-grid').innerHTML=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=>'<span class="calendar-weekday">'+x+'</span>').join('')+
    calendarDays(dateMonth).map(day=>{
      if(!day)return '<span></span>';
      const number=Number(day.slice(-2)),count=counts.get(day),id='month-date-description-'+day;
      return '<button type="button" class="calendar-day" data-day="'+day+'" aria-describedby="'+id+'" aria-pressed="'+(day===dateSelected)+'" '+(day>today()?'disabled':'')+'>'+number+(counts.has(day)?' <small>'+count+'</small>':'')+dateDescription(day,id)+'</button>';
    }).join('');
  const panel=$('#date-entries'),opened=new Set([...panel.querySelectorAll('details[open]')].map(x=>x.dataset.date));
  if(invalid)panel.textContent='Исправьте даты фильтра.';
  else if(dateMode==='calendar'||dateMode==='day'){const g=groups.find(g=>g.day===dateSelected);panel.innerHTML='<h3>'+dateText(dateSelected)+'</h3><p>Действительные записи: '+rub(g?.total||0)+'</p>'+historyRows(g?.entries||[])}
  else panel.innerHTML=groups.length?groups.map(g=>'<details class="date-group" data-date="'+g.day+'" '+(opened.has(g.day)?'open':'')+'><summary><span>'+dateText(g.day)+' · '+g.entries.length+' зап.</span><strong>'+rub(g.total)+'</strong></summary>'+historyRows(g.entries)+'</details>').join(''):'<p>Нет записей.</p>';
  $$('[data-day]').forEach(b=>b.onclick=()=>{dateSelected=b.dataset.day;dateMonth=dateSelected.slice(0,7);if(dateMode!=='calendar')dateMode='day';renderDates();$$('[data-day]').find(x=>x.dataset.day===dateSelected&&!x.closest('[hidden]'))?.focus()});
}
function moveMonth(delta){const d=new Date((dateMode==='calendar'?dateMonth+'-01':dateSelected)+'T12:00:00Z');if(dateMode==='calendar')d.setUTCMonth(d.getUTCMonth()+delta);else d.setUTCDate(d.getUTCDate()+7*delta);dateSelected=[d.toISOString().slice(0,10),today()].sort()[0];dateMonth=dateSelected.slice(0,7);renderDates()}
$('#dates-debt').onclick=()=>{dateKind='debt';renderDates()};
$('#dates-payment').onclick=()=>{dateKind='payment';renderDates()};
$('#dates-list').onclick=()=>{dateMode='list';renderDates()};
$('#dates-calendar').onclick=()=>{dateMode='calendar';renderDates()};
$('#calendar-prev').onclick=()=>moveMonth(-1);
$('#calendar-next').onclick=()=>moveMonth(1);
$('#calendar-today').onclick=()=>{dateSelected=today();dateMonth=dateSelected.slice(0,7);if(dateMode!=='calendar')dateMode='day';renderDates()};
for(const field of ['book-from','book-to'])$('#'+field).max=today();
for(const field of ['book-client','book-from','book-to'])$('#'+field).onchange=renderDates;
$('#book-filter-reset').onclick=()=>{$('#book-client').value='';$('#book-from').value='';$('#book-to').value='';renderDates()};
$('#stats-from').value=today();$('#stats-to').value=today();
$('#stats-from').max=today();$('#stats-to').max=today();
let statsSection='summary',chartSelection=0,chartKey='',statsRange=null,statsReturn='book';
$$('[data-stats-section]').forEach(b=>b.onclick=()=>{statsSection=b.dataset.statsSection;renderStats()});
$('#stats-history').onclick=()=>{if(statsRange)openHistoryScope($('#stats-client').value,statsRange)};
function renderStats(){
  const select=$('#stats-client'), selected=select.value;
  select.innerHTML='<option value="">Весь магазин</option>'+book.clients.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  select.value=book.clients.some(c=>c.id===selected)?selected:'';
  const scope=select.value,preset=$('#stats-period').value;
  $('#stats-custom').hidden=preset!=='custom';$('#stats-ranking-controls').hidden=!!scope||statsSection!=='details';
  $('#stats-actions').hidden=statsSection!=='reports';statsRange=null;$('#stats-history').disabled=true;
  $$('[data-stats-section]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.statsSection===statsSection)));
  $('#stats-csv').disabled=true;$('#stats-print').disabled=true;
  let range;
  try{range=periodRange(preset,today(),book.entries,{from:$('#stats-from').value,to:$('#stats-to').value})}catch(error){$('#stats-content').textContent=error.message;return}
  const previous=previousRange(preset,range),data=projectDemo(book,range,scope),t=data.totals;
  statsRange=range;$('#stats-history').disabled=false;$('#stats-csv').disabled=false;$('#stats-print').disabled=false;
  const balances=debtOverview(book),current=[...balances].filter(([id])=>!scope||id===scope).map(([,x])=>x);
  const sum=key=>current.reduce((n,x)=>n+x[key],0);
  const metric=(label,value)=>'<div class="stats-value"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';
  const group=(title,items,desc='')=>'<section class="card stats-section"><h3>'+title+'</h3><div class="stats-grid">'+items.join('')+'</div>'+(desc?'<p class="stats-note">'+esc(desc)+'</p>':'')+'</section>';
  const mode=$('#stats-rank').value;
  const rankValue=c=>analyticsRankValue(c,mode,balances.get(c.id),range);
  const rank=data.customers.filter(c=>rankValue(c)>0).sort((a,b)=>rankValue(b)-rankValue(a)||a.name.localeCompare(b.name,'ru'));
  const ranking=scope?'':'<section class="card stats-section"><h3>Рейтинг клиентов · '+esc($('#stats-rank').selectedOptions[0].textContent)+'</h3>'+(rank.length?rank.map(c=>'<button type="button" class="stats-ranking" data-stats-client="'+esc(c.id)+'"><span>'+esc(c.name)+'<small>Долгов за период: '+c.debtCount+' · '+rub(c.debt)+'</small></span><strong>'+(mode==='debtCount'?rankValue(c)+' зап.':rub(rankValue(c)))+' ›</strong></button>').join(''):'<p>Нет клиентов с таким показателем.</p>')+'</section>';
  const prior=previous?projectDemo(book,previous,scope).totals:null;
  const compare=prior?group('Сравнение периодов',['debt','payment','end'].map((key,i)=>{const diff=t[key]-prior[key],percent=prior[key]?' · '+(diff/prior[key]*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%':'';return metric(['Долги','Оплаты','Остаток'][i],(diff>0?'+':'')+rub(diff)+percent)}),'Предыдущий: '+dateText(previous.from)+' — '+dateText(previous.to)):'';
  const buckets=analyticsBuckets(data,range),key=scope+'|'+range.from+'|'+range.to;
  if(chartKey!==key){chartKey=key;chartSelection=buckets.length-1}
  chartSelection=Math.max(0,Math.min(chartSelection,buckets.length-1));
  const max=Math.max(1,...buckets.flatMap(b=>[b.opening,b.closing,b.debt,b.payment])),width=290/buckets.length;
  const x=i=>15+(i+.5)*width,y=n=>120-100*n/max;
  const svg='<svg class="stats-chart" viewBox="0 0 320 136" role="img" aria-label="Динамика задолженности, долгов и оплат"><path d="M15 120H305" class="chart-baseline"/><rect class="chart-selected" x="'+(15+chartSelection*width)+'" y="12" width="'+width+'" height="108"/>'+buckets.map((d,i)=>'<rect x="'+(x(i)-width*.36)+'" y="'+y(d.debt)+'" width="'+width*.32+'" height="'+(120-y(d.debt))+'" class="chart-debt"/><rect x="'+(x(i)+width*.04)+'" y="'+y(d.payment)+'" width="'+width*.32+'" height="'+(120-y(d.payment))+'" class="chart-payment"/>').join('')+'<polyline points="15,'+y(buckets[0].opening)+' '+buckets.map((d,i)=>x(i)+','+y(d.closing)).join(' ')+'" class="chart-balance"/></svg>';
  const chart='<section class="card stats-section"><h3>Динамика задолженности</h3><p class="stats-note">Шкала: 0 — '+rub(max)+'</p>'+svg+'<div class="chart-dates"><span>'+dateText(range.from)+'</span><span>'+dateText(range.to)+'</span></div><div class="chart-legend"><span>━ Остаток</span><span>■ Долги</span><span>■ Оплаты</span></div><div class="chart-controls no-print"><button type="button" class="secondary" id="chart-prev" aria-label="Предыдущий интервал">‹</button><label>Интервал<select id="chart-interval">'+buckets.map((b,i)=>'<option value="'+i+'" '+(i===chartSelection?'selected':'')+'>'+dateText(b.from)+(b.from!==b.to?' — '+dateText(b.to):'')+'</option>').join('')+'</select></label><button type="button" class="secondary" id="chart-next" aria-label="Следующий интервал">›</button></div><div id="chart-values" class="stats-grid" aria-live="polite"></div><p class="stats-note">Движение с учётом отмен; выберите интервал на графике или в списке.</p></section>';
  const daily='<section class="card stats-section"><h3>Операции по дням</h3>'+(data.days.length?data.days.map(d=>'<div class="stats-day"><strong>'+dateText(d.day)+'</strong><span>Долги '+rub(d.debt)+'</span><span>Оплаты '+rub(d.payment)+'</span><span>Отмены '+rub(d.cancelDebt+d.cancelPayment)+'</span><span>Остаток '+rub(d.closing)+'</span></div>').join(''):'<p>Нет операций за период.</p>')+'</section>';
  const customer=scope?data.customers[0]:null;
  const activity=scope?group('История клиента',[metric('Средняя запись долга',t.debtCount?rub(Math.round(t.debt/t.debtCount)):'Нет данных'),metric('Максимальная запись',t.debtCount?rub(t.maxDebt):'Нет данных'),metric('Последний долг',customer.lastDebt?dateText(customer.lastDebt):'Нет данных'),metric('Последняя оплата',customer.lastPayment?dateText(customer.lastPayment):'Нет данных')],'Даты последних действительных операций по конец периода.'):group('Активность клиентов',[metric('Клиентов с операциями',t.active),metric('Брали в долг',t.borrowers),metric('Впервые брали в долг',t.newBorrowers),metric('Погасили остаток',t.settled),metric('Средняя запись долга',t.debtCount?rub(Math.round(t.debt/t.debtCount)):'Нет данных'),metric('Максимальная запись',t.debtCount?rub(t.maxDebt):'Нет данных')]);
  const title=scope?esc(customer.name):'Весь магазин';
  const context='<p class="stats-context">ДЕМО · '+title+' · '+dateText(range.from)+' — '+dateText(range.to)+'</p>';
  const hero='<section class="card stats-hero"><span>Задолженность на сегодня</span><strong>'+rub(sum('balance'))+'</strong><div class="stats-grid">'+metric('Просрочено',rub(sum('overdue')))+(scope?'':metric('Должников',current.filter(x=>x.balance>0).length)+metric('С просрочкой',current.filter(x=>x.overdue>0).length))+'</div></section>';
  const effective=group('Действительные операции',[metric('Выдано в долг',rub(t.debt)),metric('Получено оплат',rub(t.payment)),metric('Записей долга',t.debtCount),metric('Записей оплаты',t.paymentCount)],'Без записей, отменённых к концу периода.');
  const movement=group('Движение за период',[metric('Остаток на начало',rub(t.start)),metric('Остаток на конец',rub(t.end)),metric('Изменение остатка',rub(t.end-t.start)),metric('Записано долгов',rub(t.movementDebt)),metric('Получено оплат',rub(t.movementPayment)),metric('Отменено долгов',rub(t.cancelDebt)),metric('Отменено оплат',rub(t.cancelPayment))],'Включает отмены по дате регистрации. Это движение задолженности, не выручка и не прибыль.');
  $('#stats-content').innerHTML=context+(statsSection==='summary'?hero+effective+chart+compare:statsSection==='details'?activity+ranking:movement+daily);
  $$('[data-stats-client]').forEach(b=>b.onclick=()=>{select.value=b.dataset.statsClient;statsSection='summary';renderStats();select.focus()});
  if(statsSection==='summary'){
    const updateChart=i=>{
      chartSelection=Math.max(0,Math.min(i,buckets.length-1));
      const d=buckets[chartSelection];
      $('#chart-interval').value=String(chartSelection);
      $('#chart-prev').disabled=chartSelection===0;$('#chart-next').disabled=chartSelection===buckets.length-1;
      $('.chart-selected').setAttribute('x',String(15+chartSelection*width));
      $('#chart-values').innerHTML=[metric('Остаток на начало',rub(d.opening)),metric('Остаток на конец',rub(d.closing)),metric('Долги',rub(d.debt)),metric('Оплаты',rub(d.payment)),metric('Отмены долгов',rub(d.cancelDebt)),metric('Отмены оплат',rub(d.cancelPayment))].join('');
    };
    $('#chart-prev').onclick=()=>updateChart(chartSelection-1);$('#chart-next').onclick=()=>updateChart(chartSelection+1);
    $('#chart-interval').onchange=e=>updateChart(Number(e.target.value));
    $('.stats-chart').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();updateChart(Math.floor(((e.clientX-r.left)*320/r.width-15)/width))};
    updateChart(chartSelection);
  }

}
$('#stats-period').onchange=renderStats;
$('#stats-client').onchange=renderStats;
$('#stats-rank').onchange=renderStats;
$('#stats-from').onchange=renderStats;$('#stats-to').onchange=renderStats;

function openClient(clientId=''){
  if(loadBlocked)return toast('Восстановите книгу в разделе «Данные и копии».');
  if(writing)return;
  editClientId=typeof clientId==='string'?clientId:'';
  if(editClientId&&!book.clients.some(c=>c.id===editClientId))return toast('Клиент больше не найден.');
  $('#client-form').reset();$('#client-dialog .dialog-error').hidden=true;
  const c=book.clients.find(c=>c.id===editClientId);
  $('#client-form [name=name]').value=c ? c.name : 'Демо-клиент '+(book.clients.length+1);
  $('#client-submit-debt').hidden=!!c;$('#client-title').textContent=c?'Изменить клиента':'Новый клиент';$('#client-submit').textContent=c?'Сохранить изменения':'Создать карточку';$('#client-hint').textContent=c?'История и остаток клиента сохранятся.':'После создания карточки можно записать долг.';
  $('#client-dialog').showModal();
}
$('#add-client').onclick=()=>openClient();
$('#client-form').onsubmit=async e=>{e.preventDefault();if(writing)return;try{
  const existing=book.clients.find(c=>c.id===editClientId),name=existing?.name||'Демо-клиент '+(book.clients.length+1),phone='';
  const newClientId=editClientId||id();
  await save({...book,clients:editClientId?book.clients.map(c=>c.id===editClientId?{...c,name,phone}:c):[...book.clients,{id:newClientId,name,phone}]});
  const addDebt=!editClientId&&e.submitter?.id==='client-submit-debt';
  $('#client-dialog').close();if(editClientId)openDetail(editClientId);else if(addDebt)openEntry(newClientId,'debt');else toast('Карточка клиента создана.');
}catch(err){toast(err.message);}};
const entryDialog = $('#entry-dialog');
const entryForm = $('#entry-form');
const entryAmount = entryForm.elements.amount;
const entrySubmit = $('#entry-submit');
const entryError = $('#entry-error');
const paymentActions = $('#payment-actions');
const paymentRemaining = $('#payment-remaining');
const fullPayment = $('#full-payment');

function paymentAmount(value, currentBalance) {
  const amount = moneyToCents(value);
  if (amount > currentBalance) throw Error('Оплата превышает остаток долга.');
  return amount;
}

function updateEntryBalance() {
  const current = balance(book, entryClient);
  $('#entry-balance').textContent = 'Текущий остаток: ' + rub(current);
  if (entryType !== 'payment') return;

  fullPayment.disabled = current <= 0 || current > MAX_AMOUNT;
  paymentRemaining.textContent = '';
  entryAmount.removeAttribute('aria-invalid');
  if (!entryAmount.value.trim()) return;
  try {
    const remaining = current - paymentAmount(entryAmount.value, current);
    paymentRemaining.textContent = remaining === 0
      ? 'После оплаты: долг закрыт.'
      : 'После оплаты останется: ' + rub(remaining);
  } catch (error) {
    entryAmount.setAttribute('aria-invalid', 'true');
    paymentRemaining.textContent = error.message;
  }
}

let entryReturnToDetail=false;
function openEntry(clientId, type, { fromDemoGuide = false, returnToDetail = false } = {}) {
  if(writing||loadBlocked)return;
  if(!book.clients.some(c=>c.id===clientId))return toast('Клиент больше не найден.');
  demoEntry = fromDemoGuide;
  entryReturnToDetail=returnToDetail;
  entryClient = clientId;
  entryType = type;
  const client = book.clients.find(item => item.id === clientId);
  entryForm.reset();
  paymentRemaining.textContent = '';
  entryError.hidden = true;
  $('#entry-client').textContent = client.name;
  $('#entry-title').textContent = type === 'debt' ? 'Записать долг' : 'Принять оплату';
  $('#due-label').hidden = type === 'payment';
  paymentActions.hidden = type !== 'payment';
  entryAmount.removeAttribute('aria-invalid');
  entrySubmit.textContent = type === 'debt' ? 'Записать долг' : 'Сохранить оплату';
  updateEntryBalance();
  entryDialog.showModal();
  entryAmount.focus();
}

entryAmount.addEventListener('input', () => {
  entryError.hidden = true;
  updateEntryBalance();
});

fullPayment.onclick = () => {
  const current = balance(book, entryClient);
  if (current <= 0 || current > MAX_AMOUNT) return;
  entryAmount.value = Math.floor(current / 100) + ',' + String(current % 100).padStart(2, '0');
  entryError.hidden = true;
  updateEntryBalance();
};

entryForm.onsubmit = async event => {
  event.preventDefault();
  if (!entryDialog.open || entrySubmit.disabled || writing) return;
  entryError.hidden = true;

  const fields = new FormData(entryForm);
  let amount;
  try {
    amount = entryType === 'payment'
      ? paymentAmount(fields.get('amount'), balance(book, entryClient))
      : moneyToCents(fields.get('amount'));
  } catch (error) {
    entryAmount.setAttribute('aria-invalid', 'true');
    entryError.textContent = error.message;
    entryError.hidden = false;
    entryAmount.focus();
    return;
  }

  entrySubmit.disabled = true;
  try {
    const operation = {
      id: id(), clientId: entryClient, type: entryType, amount,
      date: new Date().toISOString(), due: entryType === 'debt' ? fields.get('due') : '',
      note: entryType === 'debt' ? 'Демо: покупка в долг' : 'Демо: оплата',
    };
    await save(addEntry(book, operation));
    entryDialog.close();
    if (demoEntry && mode === 'demo') {
      lastDemoPayment = { id: operation.id, remaining: balance(book, operation.clientId) };
      renderDemoOperation();
      demoOperation.focus();
    }
    if(entryReturnToDetail)openDetail(entryClient);
    toast(entryType === 'debt' ? 'Долг записан.' : 'Оплата сохранена. Остаток пересчитан.');
  } catch (error) {
    entryError.textContent = error.message;
    entryError.hidden = false;
  } finally {
    entrySubmit.disabled = false;
  }
};
function openDetail(clientId){
  detailId=clientId;const c=book.clients.find(c=>c.id===clientId),last=activeEntries(book).filter(e=>e.clientId===clientId).at(-1);
  if(!c)return toast('Клиент больше не найден.');
  $('#detail-name').textContent=c.name;
  $('#detail-balance').textContent='Остаток: '+rub(balance(book,clientId));$('#detail-payment').disabled=balance(book,clientId)<=0;
  $('#detail-content').innerHTML=`<h3>История клиента</h3><p>${esc(prefs.shop)} · ${esc(c.phone)} · Выписка на ${dateText(today())}${mode==='demo'?' · ДЕМО':''}</p><p class="muted">Долги и оплаты из книги магазина. Не является кассовым чеком.</p>${historyRows(book.entries.filter(e=>e.clientId===clientId))}`;
  $('#detail-reverse').disabled=!last;$('#detail-dialog').showModal();
}
$('#detail-debt').onclick=()=>{if(writing)return;$('#detail-dialog').close();openEntry(detailId,'debt',{returnToDetail:true})};
$('#detail-payment').onclick=()=>{if(writing)return;$('#detail-dialog').close();openEntry(detailId,'payment',{returnToDetail:true})};
$('#detail-history').onclick=()=>{if(writing)return;$('#detail-dialog').close();openHistoryScope(detailId)};
$('#detail-statistics').onclick=()=>{if(writing)return;statsReturn=location.hash.slice(1)||'book';$('#detail-dialog').close();$('#stats-client').value=detailId;statsSection='summary';switchView('statistics');renderStats();$('#stats-client').focus()};
$('#stats-csv').onclick=()=>{
  const scope=$('#stats-client').value,preset=$('#stats-period').value;
  const range=periodRange(preset,today(),book.entries,{from:$('#stats-from').value,to:$('#stats-to').value}),t=projectDemo(book,range,scope).totals;
  const rows=[['ДЕМО','Вымышленные данные'],['Клиент',scope?book.clients.find(c=>c.id===scope).name:'Весь магазин'],['Начало периода',range.from],['Конец периода',range.to],['Остаток на начало, ₽',t.start/100],['Остаток на конец, ₽',t.end/100],['Действительные долги, ₽',t.debt/100],['Записей долга',t.debtCount],['Действительные оплаты, ₽',t.payment/100],['Записей оплаты',t.paymentCount],['Отменено долгов, ₽',t.cancelDebt/100],['Отменено оплат, ₽',t.cancelPayment/100],['Записано долгов с отменёнными, ₽',t.movementDebt/100],['Получено оплат с отменёнными, ₽',t.movementPayment/100],['Клиентов с операциями',t.active],['Брали в долг',t.borrowers],['Впервые брали в долг',t.newBorrowers],['Погасили остаток',t.settled]];
  const csv='\ufeff'+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(';')).join('\r\n');
  download('raschet-demo-statistics-'+range.to+'.csv',csv,'text/csv;charset=utf-8');
};
$('#stats-print').onclick=()=>{document.body.classList.add('print-stats');try{window.print()}finally{document.body.classList.remove('print-stats')}};
$('#detail-reverse').onclick=()=>{
  const e=activeEntries(book).filter(e=>e.clientId===detailId).at(-1);if(!e)return;
  reverseEntryId=e.id;$('#detail-dialog').close();$('#reverse-form').reset();$('#reverse-dialog .dialog-error').hidden=true;
  const after=balance(book,detailId)+(e.type==='debt'?-e.amount:e.amount);
  $('#reverse-description').textContent=`${book.clients.find(c=>c.id===detailId).name}: ${e.type==='debt'?'долг':'оплата'} ${rub(e.amount)} от ${dateText(e.date)}. Остаток после отмены: ${rub(after)}.`;
  $('#reverse-dialog').showModal();
};
$('#reverse-form').onsubmit=async e=>{e.preventDefault();if(writing)return;try{
  const original=book.entries.find(e=>e.id===reverseEntryId),reason='Демо: ошибочная запись';if(!original||!reason)throw Error('Укажите причину отмены.');
  await save(addEntry(book,{id:id(),clientId:original.clientId,type:'reversal',amount:original.amount,date:new Date().toISOString(),due:'',note:reason,reverses:original.id}));
  $('#reverse-dialog').close();openDetail(original.clientId);
}catch(err){toast(err.message);}};
$('#print-statement').onclick=()=>window.print();$$('[data-close]').forEach(b=>b.onclick=()=>{if(!writing)b.closest('dialog').close();});
$$('dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(writing)event.preventDefault();}));
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportHistoryCsv(entries, filtered = false) {
  const cell = value => {
    const text = String(value);
    const escaped = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + escaped.replace(/"/g, '""') + '"';
  };
  const clients = new Map(book.clients.map(client => [client.id, client]));
  const cancelled = new Set(book.entries.filter(entry => entry.type === 'reversal').map(entry => entry.reverses));
  const columns = ['Клиент', 'Телефон', 'Дата', 'Тип', 'Сумма, ₽', 'Вернуть до', 'Комментарий', 'ID операции', 'Отменяет ID'];
  if (filtered) columns.push('Статус');
  const rows = entries.map(entry => {
    const client = clients.get(entry.clientId);
    const kind = { debt: 'Долг', payment: 'Оплата', reversal: 'Отмена' }[entry.type];
    const row = [client.name, client.phone, entry.date, kind, (entry.amount / 100).toFixed(2).replace('.', ','), entry.due, entry.note, entry.id, entry.reverses || ''];
    if (filtered) row.push(cancelled.has(entry.id) ? 'Отменено' : '');
    return row;
  });
  const csv = '\ufeff' + [columns, ...rows].map(row => row.map(cell).join(';')).join('\r\n');
  download(`dolgbook-${mode}${filtered ? '-history' : ''}-${today()}.csv`, csv, 'text/csv;charset=utf-8');
  toast('CSV передан браузеру для скачивания.');
}
// Legacy export is read-only and independent of the demo.
const legacyKey='dolgbook-v1-own';
let legacyRequest=0;
function refreshLegacyBackups() {
  const request=++legacyRequest;
  const status=$('#legacy-status'), list=$('#legacy-backups');
  list.replaceChildren();
  try {
    const raw=localStorage.getItem(legacyKey);
    $('#legacy-export').disabled=raw===null;
    status.textContent=raw===null?'Прежняя локальная книга на этом адресе не найдена.':'Найдена прежняя локальная книга. Можно скачать её, не открывая и не изменяя записи.';
  } catch {
    $('#legacy-export').disabled=true;
    status.textContent='Браузер не разрешил прочитать прежнее хранилище.';
  }
  listBackups(legacyKey).then(copies=>{
    if(request!==legacyRequest)return;
    for(const copy of copies){
      const li=document.createElement('li'),button=document.createElement('button');
      button.type='button';button.className='secondary';
      button.textContent='Скачать копию от '+dateText(copy.date);
      button.onclick=()=>download('dolgbook-legacy-'+copy.date.replaceAll(':','-')+'.json',copy.raw,'application/json');
      li.append(button);list.append(li);
    }
  }).catch(()=>{if(request===legacyRequest)$('#legacy-backup-status').textContent='Автоматические копии недоступны.';});
}
$('#legacy-export').onclick=()=>{
  try{
    const raw=localStorage.getItem(legacyKey);
    if(raw===null)return toast('Прежняя книга не найдена.');
    download('dolgbook-legacy-'+today()+'.json',raw,'application/json');
    toast('Файл передан браузеру для скачивания.');
  }catch{toast('Не удалось прочитать прежнюю книгу.');}
};
$('#confirm-cancel').onclick=()=>$('#confirm-dialog').close();
$('#confirm-import').onclick=()=>{$('#confirm-dialog').close();resetDemo();};
let prefs={shop:'Демо-магазин',tablet:false};
function applyPrefs(){document.body.classList.toggle('tablet-mode',prefs.tablet);$('#tablet-mode').setAttribute('aria-pressed',String(prefs.tablet));$('#tablet-mode').textContent=prefs.tablet?'Обычный режим':'Крупный режим';$('#shop-title').textContent=prefs.shop;}
$('#tablet-mode').onclick=()=>{prefs.tablet=!prefs.tablet;applyPrefs();};
// Entry URLs are an allowlisted navigation hint, never a financial instruction.
const scenarioDefinitions = new Map([
  ['debt', {view:'book',title:"Записать долг",description:"Выберите вымышленного клиента и внесите сумму покупки. Остаток изменится только после подтверждения.",action:"Записать долг"}],
  ['payment', {view:'book',title:"Отметить оплату",description:"Попробуйте частичный возврат долга с предложенной тестовой суммой.",action:"Попробовать оплату"}],
  ['deadlines', {view:'collections',title:"Проверить сроки",description:"Открыт рабочий список просроченных долгов. Можно переключиться на ближайшие семь дней.",action:"Ближайшие 7 дней"}],
  ['history', {view:'history',title:"Найти операцию",description:"Выберите клиента, период или тип операции в фильтрах истории.",action:"К фильтрам"}],
  ['calendar', {view:'book',title:"Книга по датам",description:"Выберите день календаря, затем переключитесь между долгами и оплатами.",action:"К календарю"}],
  ['statistics', {view:'statistics',title:"Открыть статистику",description:"Выберите период и клиента, изучите динамику и рейтинг должников.",action:"К показателям"}],
]);
let activeScenario = null;
function dismissScenario(){
  activeScenario = null;
  $('#scenario-panel').hidden = true;
  const url = new URL(location.href);
  if(url.searchParams.has('scenario')){
    url.searchParams.delete('scenario');
    history.replaceState(history.state,'',url);
  }
}
function scenarioFocus(selector){
  const element=$(selector);
  if(!element)return;
  element.scrollIntoView({block:'center'});
  element.focus({preventScroll:true});
}
function enterScenario(){
  const url=new URL(location.href);
  const values=url.searchParams.getAll('scenario');
  const key=values.length===1?values[0]:'';
  const config=scenarioDefinitions.get(key);
  const requestedView=url.hash.slice(1);
  if(!config || (requestedView && requestedView!==config.view)){
    if(values.length)dismissScenario();
    switchView(requestedView||'book');
    return;
  }
  activeScenario=key;
  if(key==='deadlines'){$('#collection-mode').value='overdue';$('#collection-search').value='';renderCollections();}
  if(key==='calendar'){dateMode='calendar';renderDates();}
  url.hash=config.view;
  history.replaceState(history.state,'',url);
  switchView(config.view);
  $('#scenario-title').textContent=config.title;
  $('#scenario-description').textContent=config.description;
  $('#scenario-action').textContent=config.action;
  $('#scenario-panel').hidden=false;
}
$('#scenario-dismiss').onclick=()=>{dismissScenario();scenarioFocus('#switch-mode');};
$('#scenario-action').onclick=()=>{
  const config=scenarioDefinitions.get(activeScenario);
  if(!config)return;
  switchView(config.view);
  switch(activeScenario){
    case 'debt': if(!$('#quick-dialog').open)openQuick('debt'); break;
    case 'payment': if(!$('#entry-dialog').open)demoPayment.click(); break;
    case 'deadlines': $('#collection-mode').value='soon';renderCollections();scenarioFocus('#collection-mode');break;
    case 'history': scenarioFocus('#history-filters');break;
    case 'calendar': dateMode='calendar';renderDates();scenarioFocus('#dates-calendar');if($('#dates-calendar').hidden)scenarioFocus('#calendar-today');break;
    case 'statistics': scenarioFocus('#stats-period');break;
  }
};
applyPrefs();load();enterScenario();
