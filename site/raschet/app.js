import {MAX_AMOUNT,today,moneyToCents,balance,debtOverview,validateBook,addEntry,demoBook,activeEntries} from './ledger.js';
import { filterHistory, historyPage, HISTORY_PAGE_SIZE } from './history.js';
import { listBackups } from './backups.js';

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
function switchView(view){if(!['book','history','settings'].includes(view))view='book';$$('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);$$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));location.hash=view;if(view==='settings')refreshLegacyBackups();}
$('#today').textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date());
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));
function resetDemo() {
  if (writing) return;
  lastDemoPayment = null;
  filter = 'all';
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
    }),
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
    .sort((a, b) => (filter === 'soon' ? a.soonDate.localeCompare(b.soonDate) : b.overdue - a.overdue)
      || b.balance - a.balance || a.name.localeCompare(b.name, 'ru'));
  $('#clients').innerHTML=shown.length?shown.map(c=>`<div class="client-row"><button class="client-person" data-detail="${esc(c.id)}"><span class="avatar">${esc(c.name.split(/\s+/).slice(0,2).map(n=>n[0]).join(''))}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.phone||'Открыть историю клиента')}</small></span></button><div class="balance">${rub(c.balance)}<small>${c.balance?'остаток долга':'всё оплачено'}</small>${deadlineNote(c)}</div><div class="status ${c.overdue?'late':''}">${c.overdue?'◷ Срок прошёл':c.balance?'Ведём учёт':'✓ Расчёт закрыт'}</div><div class="row-actions"><button class="debt" data-entry="debt" data-client="${esc(c.id)}">＋ В долг</button><button class="pay" data-entry="payment" data-client="${esc(c.id)}" ${c.balance?'':'disabled'}>Принять оплату</button></div></div>`).join(''):`<div class="empty"><div class="empty-symbol">д.</div><h3>${book.clients.length?'Ничего не найдено':'Начните с первого клиента'}</h3><p>${book.clients.length?'Попробуйте другое имя или измените фильтр.':'Добавьте имя, запишите сумму — остаток посчитается автоматически.'}</p>${book.clients.length?'':'<button class="secondary" id="empty-add">＋ Добавить клиента</button>'}</div>`;
  $('#empty-add')?.addEventListener('click',openClient);$$('[data-entry]').forEach(b=>b.onclick=()=>openEntry(b.dataset.client,b.dataset.entry));$$('[data-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
  renderHistory();
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
function openDetail(clientId){
  detailId=clientId;const c=book.clients.find(c=>c.id===clientId),last=activeEntries(book).filter(e=>e.clientId===clientId).at(-1);
  if(!c)return toast('Клиент больше не найден.');
  $('#detail-name').textContent=c.name;
  $('#detail-content').innerHTML=`<p>${esc(prefs.shop)} · ${esc(c.phone)} · Выписка на ${dateText(today())}${mode==='demo'?' · ДЕМО':''}</p><p class="muted">Долги и оплаты из книги магазина. Не является кассовым чеком.</p><div class="detail-balance">Остаток: ${rub(balance(book,clientId))}</div>${historyRows(book.entries.filter(e=>e.clientId===clientId))}`;
  $('#detail-reverse').disabled=!last;$('#detail-dialog').showModal();
}
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
applyPrefs();load();switchView(location.hash.slice(1)||'book');
