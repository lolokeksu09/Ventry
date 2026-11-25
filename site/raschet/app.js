import {MAX_AMOUNT,today,moneyToCents,balance,debtOverview,validateBook,addEntry,demoBook,activeEntries} from './ledger.js';
import { filterHistory, historyPage, HISTORY_PAGE_SIZE } from './history.js';
import { listBackups } from './backups.js';
import {projectAnalytics, calendarDays, localDay, periodRange, previousRange, shiftDay} from './demo-projection.js';

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
let currentView='book',detailReturn='clients',analyticsClient=null,analyticsReturn='book',historyClient=null;
function switchView(view){
  if(!['book','clients','history','settings','collections','analytics','report','detail'].includes(view)||(view==='detail'&&!detailId))view='book';
  const changed=currentView!==view;currentView=view;
  $$('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);
  const selected=['collections','report'].includes(view)||(view==='analytics'&&!analyticsClient)?'book':view==='detail'||view==='analytics'?'clients':view;
  $$('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===selected);if(el.dataset.view===selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  if(location.hash!=='#'+view)location.hash=view;
  if(view==='settings')refreshLegacyBackups();
  if(view==='analytics')renderAnalytics();
  if(view==='report')renderReport();
  if(view==='detail')renderDetail();
  if(changed)window.scrollTo(0,0);
}
$('#today').textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date());
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.view==='history'){historyClient=null;renderHistory();}switchView(b.dataset.view);}));
$$('[data-route]').forEach(b=>b.onclick=()=>{if(b.dataset.route==='analytics')openAnalytics();else switchView(b.dataset.route);});
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));
function resetDemo() {
  if (writing) return;
  lastDemoPayment = null;
  detailId='';analyticsClient=null;historyClient=null;calendarDate=today();calendarMonth=calendarDate.slice(0,7);calendarMode=false;filter = 'all';
  $('#client-sort').value='balance';setPeriod('month');setReportPeriod();
  $('#search').value = '';
  historyForm.reset();
  currentHistoryPage = 0;
  load();
  switchView('book');
  toast('Демонстрация начата заново.');
}
$('#switch-mode').onclick = () => { $('#confirm-dialog').showModal(); };
$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();});
$('#search').oninput=render;
$('#client-sort').onchange=render;
$$('[data-open-filter]').forEach(button => button.onclick = () => {
  filter = button.dataset.openFilter;
  $('#search').value = '';
  render();
  $('#client-panel').focus();
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
  const { query, kind, from, to } = historyControls;
  const rangeError = Boolean(from.value && to.value && from.value > to.value);
  return {
    rangeError,
    entries: rangeError ? [] : filterHistory(book, {
      query: query.value, kind: kind.value, from: from.value, to: to.value,
    }).filter(e=>!historyClient||e.clientId===historyClient),
  };
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
  historyForm.reset();historyClient=null;
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
  historyClient=null;historyForm.reset();
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
  $('#active-count').textContent = `Клиентов с долгом: ${items.filter(client => client.balance > 0).length}`;
  $('#paid-month').textContent=rub(activeEntries(book).filter(e=>{const d=new Date(e.date),n=new Date();return e.type==='payment'&&d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();}).reduce((n,e)=>n+e.amount,0));
  $('#client-count').textContent = book.clients.length;
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
    .sort((a,b)=>$('#client-sort').value==='name'?a.name.localeCompare(b.name,'ru'):b.balance-a.balance||a.name.localeCompare(b.name,'ru'));
  $('#clients').innerHTML=shown.length?shown.map(c=>`<div class="client-row"><button class="client-person" data-detail="${esc(c.id)}"><span class="avatar">${esc(c.name.split(/\s+/).slice(0,2).map(n=>n[0]).join(''))}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.phone||'Открыть историю клиента')}</small></span></button><div class="balance">${rub(c.balance)}<small>${c.balance?'остаток долга':'всё оплачено'}</small>${deadlineNote(c)}</div><div class="status ${c.overdue?'late':''}">${c.overdue?'◷ Срок прошёл':c.balance?'Ведём учёт':'✓ Расчёт закрыт'}</div><div class="row-actions"><button class="debt" data-entry="debt" data-client="${esc(c.id)}">＋ В долг</button><button class="pay" data-entry="payment" data-client="${esc(c.id)}" ${c.balance?'':'disabled'}>Принять оплату</button></div></div>`).join(''):`<div class="empty"><div class="empty-symbol">д.</div><h3>${book.clients.length?'Ничего не найдено':'Начните с первого клиента'}</h3><p>${book.clients.length?'Попробуйте другое имя или измените фильтр.':'Добавьте имя, запишите сумму — остаток посчитается автоматически.'}</p>${book.clients.length?'':'<button class="secondary" id="empty-add">＋ Добавить клиента</button>'}</div>`;
  $('#empty-add')?.addEventListener('click',openClient);$$('[data-entry]').forEach(b=>b.onclick=()=>openEntry(b.dataset.client,b.dataset.entry));$$('[data-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
  renderHistory();renderCalendar();renderCollections();renderDetail();if(currentView==='analytics')renderAnalytics();if(currentView==='report')renderReport();
  $('#book-note').textContent='Это интерактивный пример Android-приложения. Изменения живут только до перезагрузки страницы; реальные данные не вводятся.';
}
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
  $('#client-dialog').close();if(editClientId)openDetail(editClientId);else if(addDebt)openEntry(newClientId,'debt');else {switchView('clients');toast('Карточка клиента создана.');}
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

function openEntry(clientId, type, { fromDemoGuide = false } = {}) {
  if(writing||loadBlocked)return;
  if(!book.clients.some(c=>c.id===clientId))return toast('Клиент больше не найден.');
  demoEntry = fromDemoGuide;
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
    toast(entryType === 'debt' ? 'Долг записан.' : 'Оплата сохранена. Остаток пересчитан.');
  } catch (error) {
    entryError.textContent = error.message;
    entryError.hidden = false;
  } finally {
    entrySubmit.disabled = false;
  }
};
function renderDetail(){
  const c=book.clients.find(c=>c.id===detailId);if(!c)return;
  const last=activeEntries(book).filter(e=>e.clientId===detailId).at(-1),summary=debtOverview(book).get(detailId);
  $('#detail-name').textContent=c.name;
  $('#detail-content').innerHTML=`<div class="card native-balance"><small>Остаток долга</small><strong>${rub(summary.balance)}</strong><p>Просрочено: ${rub(summary.overdue)} · В ближайшие 7 дней: ${rub(summary.soon)}</p></div>`;
  $('#detail-history').innerHTML=historyRows(book.entries.filter(e=>e.clientId===detailId));
  $('#detail-payment').disabled=!summary.balance;
  $('#detail-reverse').disabled=!last;
  $('#detail-correct').disabled=!last;
}
function openDetail(clientId){
  if(!book.clients.some(c=>c.id===clientId))return toast('Клиент больше не найден.');
  if(currentView!=='detail')detailReturn=currentView==='collections'?'collections':currentView==='book'?'book':'clients';
  detailId=clientId;switchView('detail');
}
$('#detail-back').onclick=()=>switchView(detailReturn);
$('#detail-debt').onclick=()=>openEntry(detailId,'debt');
$('#detail-payment').onclick=()=>openEntry(detailId,'payment');
$('#detail-analytics').onclick=()=>openAnalytics(detailId);
$('#detail-reverse').onclick=()=>{
  const e=activeEntries(book).filter(e=>e.clientId===detailId).at(-1);if(!e)return;
  reverseEntryId=e.id;$('#reverse-form').reset();$('#reverse-dialog .dialog-error').hidden=true;
  const after=balance(book,detailId)+(e.type==='debt'?-e.amount:e.amount);
  $('#reverse-description').textContent=`${book.clients.find(c=>c.id===detailId).name}: ${e.type==='debt'?'долг':'оплата'} ${rub(e.amount)} от ${dateText(e.date)}. Остаток после отмены: ${rub(after)}.`;
  $('#reverse-dialog').showModal();
};
$('#detail-correct').onclick=()=>{
  const e=activeEntries(book).filter(e=>e.clientId===detailId).at(-1);if(!e)return;
  reverseEntryId=e.id;$('#correct-form').reset();$('#correct-form .dialog-error').hidden=true;
  $('#correct-description').textContent=(e.type==='debt'?'Долг: ':'Оплата: ')+rub(e.amount);
  $('#correct-form [name=amount]').value=(e.amount/100).toFixed(2);
  $('#correct-dialog').showModal();
};
$('#correct-form').onsubmit=async event=>{
  event.preventDefault();if(writing)return;
  try{
    const original=activeEntries(book).filter(e=>e.clientId===detailId).at(-1);
    if(!original||original.id!==reverseEntryId)throw Error('Запись изменилась.');
    const amount=moneyToCents(new FormData(event.target).get('amount')),date=new Date().toISOString();
    const reversed=addEntry(book,{id:id(),clientId:detailId,type:'reversal',amount:original.amount,date,due:'',note:'Демо: исправление суммы',reverses:original.id});
    const next=addEntry(reversed,{...original,id:id(),amount,date,note:'Демо: исправленная запись'});
    await save(next);$('#correct-dialog').close();toast('Запись исправлена. История сохранена.');
  }catch(err){toast(err.message);}
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
// Native-style demo navigation, local calendar and computed analytics.
let calendarMode=false,calendarDate=today(),calendarMonth=calendarDate.slice(0,7);
const monthLabel=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'});
function renderCalendar(){
  $('#calendar-controls').hidden=!calendarMode;
  $('#calendar-mode').setAttribute('aria-pressed',String(calendarMode));
  $('#date-list-mode').setAttribute('aria-pressed',String(!calendarMode));
  const groups=calendarDays(book),dates=new Map(groups.map(d=>[d.date,d.entries]));
  if(calendarMode){
    const first=calendarMonth+'-01',d=new Date(first+'T12:00:00'),offset=(d.getDay()+6)%7;
    const length=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
    $('#calendar-month').textContent=monthLabel.format(d);
    $('#calendar-grid').innerHTML=Array.from({length:offset},()=>'<span></span>').join('')+Array.from({length},(_,i)=>{
      const day=calendarMonth+'-'+String(i+1).padStart(2,'0'),count=dates.get(day)?.length||0;
      return `<button type="button" class="calendar-day${count?' has-records':''}" data-calendar-day="${day}" aria-label="${day}, записей: ${count}" aria-pressed="${day===calendarDate}">${i+1}${count?'<small>'+count+'</small>':''}</button>`;
    }).join('');
    $$('[data-calendar-day]').forEach(b=>b.onclick=()=>{calendarDate=b.dataset.calendarDay;renderCalendar();});
  }
  const selected=calendarMode?[{date:calendarDate,entries:dates.get(calendarDate)||[]}]:groups;
  $('#calendar-records').innerHTML=selected.length?selected.map(g=>`<section class="date-group"><h3>${dateText(g.date)} <small>Записей: ${g.entries.length}</small></h3>${historyRows(g.entries)}</section>`).join(''):'<p class="muted">Нет записей.</p>';
}
$('#calendar-mode').onclick=()=>{calendarMode=true;renderCalendar();};
$('#date-list-mode').onclick=()=>{calendarMode=false;renderCalendar();};
function shiftMonth(delta){const d=new Date(calendarMonth+'-01T12:00:00');d.setMonth(d.getMonth()+delta);calendarMonth=localDay(d).slice(0,7);calendarDate=calendarMonth+'-01';renderCalendar();}
$('#calendar-prev').onclick=()=>shiftMonth(-1);
$('#calendar-next').onclick=()=>shiftMonth(1);
$('#calendar-today').onclick=()=>{calendarDate=today();calendarMonth=calendarDate.slice(0,7);renderCalendar();};
function pickClient(kind){
  const list=book.clients.filter(c=>kind==='debt'||balance(book,c.id)>0);
  $('#picker-title').textContent=kind==='debt'?'Кому записать долг?':'От кого принять оплату?';
  $('#picker-list').innerHTML=list.length?list.map(c=>`<button type="button" class="secondary picker-row" data-pick="${esc(c.id)}"><span>${esc(c.name)}</span><strong>${rub(balance(book,c.id))}</strong></button>`).join(''):'<p>Нет клиентов с долгом.</p>';
  $$('[data-pick]').forEach(b=>b.onclick=()=>{$('#picker-dialog').close();openEntry(b.dataset.pick,kind);});
  $('#picker-dialog').showModal();
}
$('#book-debt').onclick=()=>pickClient('debt');
$('#book-payment').onclick=()=>pickClient('payment');
function renderCollections(){
  const summary=debtOverview(book),list=book.clients.map(c=>({...c,...summary.get(c.id)})).filter(c=>c.balance>0).sort((a,b)=>b.overdue-a.overdue||b.balance-a.balance);
  const total=k=>rub(list.reduce((n,c)=>n+c[k],0));
  $('#collections-list').innerHTML=`<div class="card native-balance"><small>Просрочено</small><strong>${total('overdue')}</strong><p>В ближайшие 7 дней: ${total('soon')}</p></div>`+(list.length?list.map(c=>`<article class="card collection-row"><div><h3>${esc(c.name)}</h3><strong>${rub(c.balance)}</strong><p>Просрочено: ${rub(c.overdue)} · За 7 дней: ${rub(c.soon)}</p></div><div class="button-row"><button class="secondary" data-collection-detail="${esc(c.id)}">Карточка</button><button class="primary" data-collection-pay="${esc(c.id)}">Принять оплату</button></div></article>`).join(''):'<p class="muted">Все долги погашены.</p>');
  $$('[data-collection-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.collectionDetail));
  $$('[data-collection-pay]').forEach(b=>b.onclick=()=>openEntry(b.dataset.collectionPay,'payment'));
}
function setPeriod(preset){
  $('#analytics-period').value=preset;
  if(preset==='custom')return;
  const p=periodRange(preset,today(),book);
  $('#analytics-from').value=p.from;$('#analytics-to').value=p.to;
}
function setReportPeriod(){const p=periodRange('month');$('#report-from').value=p.from;$('#report-to').value=p.to;}
function openAnalytics(client=null){analyticsClient=client;analyticsReturn=currentView==='analytics'?'analytics':client?'detail':'book';switchView('analytics');}
$('#analytics-back').onclick=()=>{if(analyticsReturn==='analytics'){analyticsClient=null;analyticsReturn='book';renderAnalytics();}else switchView(analyticsReturn);};
$('#analytics-period').onchange=()=>{setPeriod($('#analytics-period').value);renderAnalytics();};
for(const field of ['analytics-from','analytics-to'])$('#'+field).onchange=()=>{$('#analytics-period').value='custom';renderAnalytics();};
for(const field of ['report-from','report-to'])$('#'+field).onchange=renderReport;
const metricRows=rows=>'<dl class="analytics-rows">'+rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')+'</dl>';
const movementRows=r=>[['Остаток на начало',rub(r.opening)],['Записано долгов',rub(r.debts)],['Получено оплат',rub(r.payments)],['Отменено долгов',rub(r.debtReversals)],['Отменено оплат',rub(r.paymentReversals)],['Изменение остатка',rub(r.net)],['Остаток на конец',rub(r.closing)]];
function currentAnalytics(){
  return projectAnalytics(book,$('#analytics-from').value,$('#analytics-to').value,analyticsClient);
}
function graph(r){
  const values=r.series,hi=Math.max(1,...values.map(p=>p.closing)),lo=Math.min(0,...values.map(p=>p.closing)),den=hi-lo||1;
  const coords=values.map((p,i)=>[16+288*i/Math.max(1,values.length-1),112-96*(p.closing-lo)/den]);
  return `<svg class="analytics-graph" viewBox="0 0 320 130" role="img" aria-label="Динамика остатка от ${esc(rub(r.opening))} до ${esc(rub(r.closing))}"><path d="M16 112H304 M16 64H304 M16 16H304" stroke="currentColor" opacity=".25" fill="none"/><polyline points="${coords.map(p=>p.join(',')).join(' ')}" stroke="#e3d5bd" stroke-width="3" fill="none"/>${coords.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="3" fill="#e3d5bd"/>`).join('')}</svg><p class="muted">Шкала: ${rub(lo)} — ${rub(hi)}. Точки — даты изменений.</p><details><summary>Значения по датам</summary>${metricRows(values.map(p=>[dateText(p.date)+(p.opening?' · начало':''),rub(p.closing)]))}</details>`;
}
function renderAnalytics(){
  const error=$('#analytics-error'),out=$('#analytics-output');
  $('#analytics-title').textContent=analyticsClient?'Статистика клиента':'Статистика';
  $('#analytics-customer').textContent=analyticsClient?book.clients.find(c=>c.id===analyticsClient)?.name||'':'Магазин · вымышленные данные';
  $('#analytics-back').textContent=analyticsClient?'‹ Назад':'‹ Книга';
  try{
    const r=currentAnalytics(),summary=[...debtOverview(book)].filter(([id])=>!analyticsClient||id===analyticsClient).map(([,c])=>c);
    const now=k=>summary.reduce((n,c)=>n+c[k],0),debtorCount=summary.filter(c=>c.balance>0).length;
    const period=$('#analytics-period').value,previous=period==='all'?null:previousRange($('#analytics-from').value,$('#analytics-to').value);
    const before=previous?projectAnalytics(book,previous.from,previous.to,analyticsClient):null;
    error.hidden=true;$$('.analytics-actions button').forEach(b=>b.disabled=false);
    out.innerHTML=`<div class="card native-balance"><small>${analyticsClient?'Остаток долга':'Общая задолженность'} на сегодня</small><strong>${rub(now('balance'))}</strong>${metricRows([['Должников',debtorCount],['Просрочено',rub(now('overdue'))],['За 7 дней',rub(now('soon'))]])}</div><section class="card"><h3>Действительные операции за период</h3>${metricRows([['Выдано в долг',rub(r.effectiveDebts)],['Записей долга',r.effectiveDebtCount],['Получено оплат',rub(r.effectivePayments)],['Записей оплаты',r.effectivePaymentCount],['Средняя запись долга',r.effectiveDebtCount?rub(Math.round(r.effectiveDebts/r.effectiveDebtCount)):'Нет данных'],['Максимальная запись',r.maximumDebt?rub(r.maximumDebt):'Нет данных']])}<p class="muted">Без записей, отменённых к концу периода.</p></section><section class="card"><h3>Динамика задолженности</h3>${graph(r)}</section><section class="card"><h3>За выбранный период</h3>${metricRows(movementRows(r))}</section>${before?`<section class="card"><h3>Сравнение периодов</h3><p>${previous.from} — ${previous.to}</p>${metricRows([['Изменение выданных долгов',rub(r.effectiveDebts-before.effectiveDebts)],['Изменение полученных оплат',rub(r.effectivePayments-before.effectivePayments)],['Изменение числа долгов',r.effectiveDebtCount-before.effectiveDebtCount]])}</section>`:''}${!analyticsClient?`<section class="card"><h3>Активность клиентов</h3>${metricRows([['Должников на конец',r.closingDebtors],['Клиентов с операциями',r.activeCustomers],['Брали в долг',r.borrowingCustomers]])}</section><section class="card"><h3>Рейтинг клиентов по остатку на конец периода</h3>${[...r.clients].filter(c=>c.closing>0).sort((a,b)=>b.closing-a.closing).map(c=>`<button class="secondary picker-row" data-rank="${esc(c.id)}"><span>${esc(c.name)}</span><strong>${rub(c.closing)}</strong></button>`).join('')||'<p>Нет должников.</p>'}</section>`:''}`;
    $$('[data-rank]').forEach(b=>b.onclick=()=>openAnalytics(b.dataset.rank));
  }catch(e){error.textContent=e.message;error.hidden=false;out.replaceChildren();$$('.analytics-actions button').forEach(b=>b.disabled=true);}
}
function renderReport(){try{const r=projectAnalytics(book,$('#report-from').value,$('#report-to').value);$('#report-error').hidden=true;$('#report-output').innerHTML='<section class="card"><h3>Движение задолженности</h3>'+metricRows(movementRows(r))+'</section>';$('#report-csv').disabled=false;$('#report-print').disabled=false;}catch(e){$('#report-error').textContent=e.message;$('#report-error').hidden=false;$('#report-output').replaceChildren();$('#report-csv').disabled=true;$('#report-print').disabled=true;}}
function exportSummary(name,rows){const cell=v=>'"'+String(v).replace(/"/g,'""')+'"';download(name,'\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8');}
$('#analytics-csv').onclick=()=>{const r=currentAnalytics();exportSummary('raschet-demo-statistics.csv',[['Период', $('#analytics-from').value+' — '+$('#analytics-to').value],['Клиент',analyticsClient?book.clients.find(c=>c.id===analyticsClient).name:'Магазин'],...movementRows(r),['Действительные долги',rub(r.effectiveDebts)],['Количество долгов',r.effectiveDebtCount],['Действительные оплаты',rub(r.effectivePayments)],['Количество оплат',r.effectivePaymentCount]]);};
$('#analytics-print').onclick=()=>window.print();
$('#report-csv').onclick=()=>exportSummary('raschet-demo-report.csv', [['Период',$('#report-from').value+' — '+$('#report-to').value],...movementRows(projectAnalytics(book,$('#report-from').value,$('#report-to').value))]);
$('#report-print').onclick=()=>window.print();
$('#analytics-history').onclick=()=>{historyForm.reset();historyControls.from.value=$('#analytics-from').value;historyControls.to.value=$('#analytics-to').value;historyClient=analyticsClient;currentHistoryPage=0;renderHistory();switchView('history');};
applyPrefs();setPeriod('month');setReportPeriod();load();switchView(location.hash.slice(1)||'book');
