import {MAX_AMOUNT,today,moneyToCents,balance,debtOverview,validateBook,addEntry,demoBook,activeEntries} from './ledger.js';
import { filterHistory } from './history.js';
import { MAX_BACKUP_BYTES, listBackups, storeBackup } from './backups.js';
import { decryptBackup, encryptBackup, isEncryptedBackup, MAX_ENCRYPTED_BYTES } from './backup-encryption.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const blank=()=>({version:2,clients:[],entries:[]});
let mode=new URLSearchParams(location.search).get('demo') === '1' ? 'demo' : 'own';
let book=blank(),filter='all',entryClient='',entryType='debt',detailId='',pending=null,loadBlocked=false,editClientId='',reverseEntryId='';
const key=()=>`dolgbook-v1-${mode}`;
const rub=n=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:n%100?2:0}).format(n/100);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText=s=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(s.length===10?s+'T12:00:00':s));
const id=()=>crypto.randomUUID();
function toast(message){const error=$('dialog[open] .dialog-error');if(error){error.textContent=message;error.hidden=false;}$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),5500);}
function load() {
  loadBlocked = false;
  let raw;
  try {
    raw = localStorage.getItem(key());
    book = raw ? validateBook(JSON.parse(raw)) : (mode === 'demo' ? demoBook() : blank());
  } catch {
    book = blank();
    loadBlocked = true;
    toast('Не удалось прочитать записи. Восстановите книгу в разделе «Данные и копии».');
  }
  render();
  if (raw && !loadBlocked) recordBackup(key(), raw, book);
  else refreshBackups();
}
function save(next) {
  if (loadBlocked) throw Error('Восстановите книгу в разделе «Данные и копии».');
  const clean = validateBook(next);
  const raw = JSON.stringify(clean);
  try {
    localStorage.setItem(key(), raw);
  } catch {
    throw Error('Браузер не сохранил запись. Проверьте свободное место и разрешение на хранение данных.');
  }
  book = clean;
  render();
  recordBackup(key(), raw, clean);
}
function switchView(view){if(!['book','history','settings'].includes(view))view='book';$$('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);$$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));location.hash=view;if(view==='settings')refreshBackups();}
$('#today').textContent=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date());
$$('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));
$('#switch-mode').onclick=()=>{mode=mode==='own'?'demo':'own';
  const url = new URL(location.href);
  if (mode === 'demo') url.searchParams.set('demo', '1');
  else url.searchParams.delete('demo');
  history.replaceState(null, '', url);
  demoOperationId = '';
  filter='all';$('#search').value='';historyForm.reset();load();toast(mode==='demo'?'Это вымышленные данные. Ваша книга хранится отдельно.':'Открыта ваша книга.');};
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
  $('#history').innerHTML = rangeError ? '' : entries.length || !book.entries.length
    ? historyRows(entries)
    : '<div class="empty"><p>По этим фильтрам ничего не найдено.</p></div>';
}

historyForm.addEventListener('submit', event => event.preventDefault());
historyForm.addEventListener('input', renderHistory);
$('#history-reset').addEventListener('click', () => {
  historyForm.reset();
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
let demoOperationId = '';

function renderDemoOperation() {
  demoOperation.hidden = loadBlocked || mode !== 'demo' || !demoOperationId ||
    !book.entries.some(entry => entry.id === demoOperationId);
}

demoOperation.onclick = () => {
  historyForm.reset();
  switchView('history');
  renderHistory();
  const row = $$('#history [data-operation-id]').find(item => item.dataset.operationId === demoOperationId);
  if (row) {
    row.tabIndex = -1;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'center' });
  }
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
  if (mode === 'demo') confirmReplacement(demoBook(), { restartDemo: true });
};

function render(){
  $('#mode-label').textContent=mode==='demo'?'ДЕМО · ВЫМЫШЛЕННЫЕ ДАННЫЕ':'МОЯ КНИГА';$('#mode-label').classList.toggle('demo',mode==='demo');$('#switch-mode').textContent=mode==='demo'?'Вернуться в мою книгу':'Посмотреть пример';
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
  $('#export-encrypted').disabled = loadBlocked;
  renderHistory();$('#book-note').textContent=loadBlocked?'Ошибка чтения: исходные записи сохранены в браузере, изменения заблокированы.':mode==='demo'?'Режим примера: все имена, суммы и операции вымышлены. Ваша книга хранится отдельно.':'Записи сохраняются только в этом браузере. Синхронизация между устройствами пока не подключена.';
  try{const last=localStorage.getItem(key()+'-backup');$('#backup-status').textContent=last?'Последняя выгрузка: '+dateText(last):'Резервная копия ещё не выгружалась.';}catch{}
}
function openClient(clientId=''){
  if(loadBlocked)return toast('Восстановите книгу в разделе «Данные и копии».');
  editClientId=typeof clientId==='string'?clientId:'';
  $('#client-form').reset();$('#client-dialog .dialog-error').hidden=true;
  const c=book.clients.find(c=>c.id===editClientId);
  if(c){$('#client-form [name=name]').value=c.name;$('#client-form [name=phone]').value=c.phone;}
  $('#client-submit-debt').hidden=!!c;$('#client-title').textContent=c?'Изменить клиента':'Новый клиент';$('#client-submit').textContent=c?'Сохранить изменения':'Создать карточку';$('#client-hint').textContent=c?'История и остаток клиента сохранятся.':'После создания карточки можно записать долг.';
  $('#client-dialog').showModal();
}
$('#add-client').onclick=()=>openClient();
$('#client-form').onsubmit=e=>{e.preventDefault();try{
  const f=new FormData(e.target),name=f.get('name').trim(),phone=f.get('phone').trim();if(!name)throw Error('Введите имя клиента.');
  const newClientId=editClientId||id();
  save({...book,clients:editClientId?book.clients.map(c=>c.id===editClientId?{...c,name,phone}:c):[...book.clients,{id:newClientId,name,phone}]});
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

entryForm.onsubmit = event => {
  event.preventDefault();
  if (!entryDialog.open || entrySubmit.disabled) return;
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
      note: fields.get('note').trim(),
    };
    save(addEntry(book, operation));
    entryDialog.close();
    if (demoEntry && mode === 'demo') {
      demoOperationId = operation.id;
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
  $('#detail-name').textContent=c.name;
  $('#detail-content').innerHTML=`<p>${esc(prefs.shop)} · ${esc(c.phone)} · Выписка на ${dateText(today())}${mode==='demo'?' · ДЕМО':''}</p><p class="muted">Долги и оплаты из книги магазина. Не является кассовым чеком.</p><div class="detail-balance">Остаток: ${rub(balance(book,clientId))}</div>${historyRows(book.entries.filter(e=>e.clientId===clientId))}`;
  $('#detail-reverse').disabled=!last;$('#detail-dialog').showModal();
}
$('#detail-edit').onclick=()=>{$('#detail-dialog').close();openClient(detailId);};
$('#detail-reverse').onclick=()=>{
  const e=activeEntries(book).filter(e=>e.clientId===detailId).at(-1);if(!e)return;
  reverseEntryId=e.id;$('#detail-dialog').close();$('#reverse-form').reset();$('#reverse-dialog .dialog-error').hidden=true;
  const after=balance(book,detailId)+(e.type==='debt'?-e.amount:e.amount);
  $('#reverse-description').textContent=`${book.clients.find(c=>c.id===detailId).name}: ${e.type==='debt'?'долг':'оплата'} ${rub(e.amount)} от ${dateText(e.date)}. Остаток после отмены: ${rub(after)}.`;
  $('#reverse-dialog').showModal();
};
$('#reverse-form').onsubmit=e=>{e.preventDefault();try{
  const original=book.entries.find(e=>e.id===reverseEntryId),reason=new FormData(e.target).get('reason').trim();if(!original||!reason)throw Error('Укажите причину отмены.');
  save(addEntry(book,{id:id(),clientId:original.clientId,type:'reversal',amount:original.amount,date:new Date().toISOString(),due:'',note:reason,reverses:original.id}));
  $('#reverse-dialog').close();openDetail(original.clientId);
}catch(err){toast(err.message);}};
$('#print-statement').onclick=()=>window.print();$$('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function downloadBackup(raw, encrypted = false) {
  const suffix = encrypted ? '-protected' : '';
  download(`dolgbook-${mode}-${today()}${suffix}.json`, raw, 'application/json');
  try {
    localStorage.setItem(key() + '-backup', new Date().toISOString());
    render();
  } catch {
    // The file was already offered for download.
  }
  toast('Файл передан браузеру для скачивания.');
}
$('#export-json').onclick = () => {
  try {
    const raw = loadBlocked ? localStorage.getItem(key()) : JSON.stringify(book);
    if (!raw) throw Error('Нет данных для выгрузки.');
    downloadBackup(raw);
  } catch (error) {
    toast(error.message);
  }
};
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
$('#export-csv').onclick = () => {
  if (loadBlocked) return toast('Сначала выгрузите исходную JSON-копию.');
  exportHistoryCsv(book.entries);
};
const backupList = $('#local-backups');
const backupStatus = $('#local-backup-status');
const confirmBackup = $('#confirm-dialog');
const applyBackup = $('#confirm-import');
const cancelBackup = $('#confirm-cancel');
let backupViewRequest = 0;
let importRequest = 0;

function refreshBackups() {
  const bookKey = key();
  const request = ++backupViewRequest;
  backupList.replaceChildren();
  backupStatus.textContent = 'Загрузка копий…';
  listBackups(bookKey).then(snapshots => {
    if (request !== backupViewRequest) return;
    backupStatus.textContent = snapshots.length ? '' : 'Автоматических копий пока нет.';
    for (const snapshot of snapshots) {
      const item = document.createElement('li');
      const title = document.createElement('span');
      const time = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });
      title.textContent = time.format(new Date(snapshot.date)) + (snapshot.summary
        ? ` · Клиенты: ${snapshot.summary.clients}, операции: ${snapshot.summary.entries}`
        : ' · Исходные данные до восстановления');
      const actions = document.createElement('div');
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'secondary';
      restore.textContent = 'Восстановить';
      restore.onclick = () => {
        try {
          confirmReplacement(validateBook(JSON.parse(snapshot.raw)));
        } catch {
          toast('Эта копия повреждена. Её можно скачать для проверки.');
        }
      };
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'secondary';
      exportButton.textContent = 'Скачать JSON';
      exportButton.onclick = () => download(
        `dolgbook-${mode}-${snapshot.date.replaceAll(':', '-')}.json`,
        snapshot.raw, 'application/json',
      );
      if (snapshot.summary) actions.append(restore);
      actions.append(exportButton);
      item.append(title, actions);
      backupList.append(item);
    }
  }).catch(() => {
    if (request === backupViewRequest) backupStatus.textContent = 'Локальные копии недоступны. Скачайте JSON вручную.';
  });
}

function recordBackup(bookKey, raw, currentBook) {
  const summary = currentBook
    ? { clients: currentBook.clients.length, entries: currentBook.entries.length }
    : null;
  storeBackup(bookKey, raw, summary).then(() => {
    if (bookKey === key()) refreshBackups();
  }).catch(() => {
    if (bookKey !== key()) return;
    ++backupViewRequest;
    backupStatus.textContent = 'Не удалось сохранить автоматическую копию. Скачайте JSON вручную.';
  });
}

function confirmReplacement(next, { restartDemo = false } = {}) {
  pending = { next, bookKey: key(), raw: localStorage.getItem(key()), restartDemo };
  $('#confirm-title').textContent = restartDemo ? 'Начать пример заново?' : 'Заменить текущую книгу?';
  applyBackup.textContent = restartDemo ? 'Начать заново' : 'Заменить книгу';
  const description = `Клиенты: ${book.clients.length} → ${next.clients.length}. Операции: ${book.entries.length} → ${next.entries.length}.`;
  const protection = pending.raw === null ? '' : ' Текущая версия сохранится в автоматических копиях.';
  $('#confirm-text').textContent = `${mode === 'demo' ? 'Будет заменена книга примера.' : 'Будет заменена ваша книга.'} ${description}${protection}`;
  confirmBackup.querySelector('.dialog-error').hidden = true;
  confirmBackup.showModal();
}

const passwordDialog = $('#backup-password-dialog');
const passwordForm = $('#backup-password-form');
const passwordInput = $('#backup-password');
const repeatInput = $('#backup-password-repeat');
const passwordSubmit = $('#backup-password-submit');
const passwordClose = $('#backup-password-close');
let passwordTask;

function openPasswordDialog(task) {
  passwordTask = task;
  const exporting = task.kind === 'export';
  passwordForm.reset();
  passwordInput.minLength = exporting ? 12 : 0;
  passwordInput.autocomplete = exporting ? 'new-password' : 'off';
  repeatInput.required = exporting;
  $('#backup-password-repeat-label').hidden = !exporting;
  $('#backup-password-title').textContent = exporting ? 'Копия с паролем' : 'Открыть защищённую копию';
  $('#backup-password-help').textContent = exporting
    ? 'Придумайте пароль из 12–128 символов и сохраните его отдельно. Без него книгу из этого файла восстановить нельзя.'
    : 'Введите пароль, с которым сохранили файл.';
  passwordSubmit.textContent = exporting ? 'Создать копию' : 'Проверить пароль';
  passwordDialog.querySelector('.dialog-error').hidden = true;
  passwordDialog.showModal();
  passwordInput.focus();
}

$('#export-encrypted').onclick = () => {
  if (!loadBlocked) openPasswordDialog({ kind: 'export', raw: JSON.stringify(book) });
};
passwordDialog.addEventListener('cancel', event => {
  if (passwordSubmit.disabled) event.preventDefault();
});
passwordDialog.addEventListener('close', () => {
  if (passwordDialog.open) return;
  passwordTask = undefined;
  passwordForm.reset();
});
passwordForm.onsubmit = async event => {
  event.preventDefault();
  if (!passwordTask || passwordSubmit.disabled) return;
  const task = passwordTask;
  const password = passwordInput.value;
  if (task.kind === 'export' && password !== repeatInput.value) {
    toast('Пароли не совпадают.');
    return;
  }
  passwordSubmit.disabled = passwordClose.disabled = true;
  passwordDialog.querySelector('.dialog-error').hidden = true;
  try {
    if (task.kind === 'export') {
      const payload = await encryptBackup(task.raw, password);
      passwordDialog.close();
      downloadBackup(payload, true);
    } else {
      const raw = await decryptBackup(task.envelope, password);
      const next = validateBook(JSON.parse(raw));
      passwordDialog.close();
      confirmReplacement(next);
    }
  } catch (error) {
    toast(error.message);
  } finally {
    passwordSubmit.disabled = passwordClose.disabled = false;
  }
};

const backupFileInput = $('#import-json');
$('#choose-backup-file').onclick = () => backupFileInput.click();
backupFileInput.onchange = async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const request = ++importRequest;
  const bookKey = key();
  try {
    if (file.size > MAX_ENCRYPTED_BYTES) throw Error('Файл слишком большой.');
    const envelope = JSON.parse(await file.text());
    if (request !== importRequest || bookKey !== key()) return;
    if (isEncryptedBackup(envelope)) {
      openPasswordDialog({ kind: 'import', envelope });
    } else {
      if (file.size > MAX_BACKUP_BYTES) throw Error('Обычная копия больше 16 МБ.');
      confirmReplacement(validateBook(envelope));
    }
  } catch (error) {
    if (request === importRequest && bookKey === key()) {
      toast(error instanceof SyntaxError ? 'Файл не является корректным JSON.' : error.message);
    }
  }
};

cancelBackup.onclick = () => confirmBackup.close();
confirmBackup.addEventListener('close', () => { pending = null; });
confirmBackup.addEventListener('cancel', event => {
  if (applyBackup.disabled) event.preventDefault();
});
applyBackup.onclick = async () => {
  if (!pending || applyBackup.disabled) return;
  const { next, bookKey, raw, restartDemo } = pending;
  applyBackup.disabled = cancelBackup.disabled = true;
  confirmBackup.querySelector('.dialog-error').hidden = true;
  try {
    if (raw !== null) {
      const summary = loadBlocked ? null : { clients: book.clients.length, entries: book.entries.length };
      try {
        await storeBackup(bookKey, raw, summary);
      } catch {
        throw Error('Не удалось сохранить текущую книгу в автоматических копиях. Восстановление остановлено.');
      }
    }
    if (bookKey !== key() || localStorage.getItem(bookKey) !== raw) {
      throw Error('Книга изменилась в другой вкладке. Закройте окно и выберите копию заново.');
    }
    const wasBlocked = loadBlocked;
    loadBlocked = false;
    try {
      save(next);
      if (mode === 'demo') {
        demoOperationId = '';
        renderDemoOperation();
      }
    } catch (error) {
      loadBlocked = wasBlocked;
      throw error;
    }
    confirmBackup.close();
    toast(restartDemo ? 'Пример начат заново.' : 'Книга восстановлена.');
  } catch (error) {
    toast(error.message);
  } finally {
    applyBackup.disabled = cancelBackup.disabled = false;
  }
};
window.addEventListener('storage', e => {
  if (e.key !== key()) return;
  load();
  if (entryDialog.open) updateEntryBalance();
});
let prefs={shop:'Мой магазин',tablet:false};
try{const p=JSON.parse(localStorage.getItem('dolgbook-preferences')||'null');if(p){if(typeof p.shop==='string'&&p.shop.trim()&&p.shop.length<=80)prefs.shop=p.shop.trim();prefs.tablet=p.tablet===true;}}catch{}
function applyPrefs(){document.body.classList.toggle('tablet-mode',prefs.tablet);$('#tablet-mode').setAttribute('aria-pressed',String(prefs.tablet));$('#tablet-mode').textContent=prefs.tablet?'Обычный режим':'Крупный режим';$('#shop-title').textContent=prefs.shop;$('#shop-name').value=prefs.shop;}
function savePrefs(next){try{localStorage.setItem('dolgbook-preferences',JSON.stringify(next));prefs=next;applyPrefs();}catch{toast('Не удалось сохранить настройки браузера.');}}
$('#tablet-mode').onclick=()=>savePrefs({...prefs,tablet:!prefs.tablet});
$('#shop-form').onsubmit=e=>{e.preventDefault();const name=$('#shop-name').value.trim();if(!name)return toast('Введите название магазина.');savePrefs({...prefs,shop:name});};
applyPrefs();switchView(location.hash.slice(1)||'book');load();
