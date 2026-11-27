'use strict';
const $ = id => document.getElementById(id);
let credential = '', plans = [], selected = null, next = null, busy = false, epoch = 0;
const statusNames = {not_started:'Не начата', awaiting_activation:'Ожидает активации', active:'Активна', expired:'Истекла'};
const planNames = {trial:'7 дней · пробный', month:'1 месяц', quarter:'3 месяца', year:'1 год'};
const money = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100);
const date = value => value ? new Date(value).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'}) : '—';
const uuid = () => crypto.randomUUID();
function message(text,error=false) { $('message').textContent=text; $('message').classList.toggle('error',error); }
function text(id,value) { $(id).textContent=value ?? '—'; }
function resetLink() { $('link-box').hidden=true; $('download-link').value=''; text('link-expiry',''); }
function resetSession() {
  epoch++; credential=''; plans=[]; selected=null; next=null;
  $('token').value=''; $('workspace').hidden=true; $('login').hidden=false; $('logout').hidden=true;
  $('selected').hidden=true; $('select-hint').hidden=false; $('customers').replaceChildren(); $('history').replaceChildren();
  $('plan').replaceChildren(); $('confirmed').checked=false; $('payment-id').value=''; $('bind-id').value='';
  $('customer-id').value=''; $('subscription-id').value=''; $('device-id').value=''; $('open-id').value='';
  resetLink();
}
async function request(path,data,method) {
  const activeEpoch=epoch;
  const response=await fetch('/api/v1'+path,{
    method:method || (data===undefined?'GET':'POST'),
    headers:{Authorization:'Bearer '+credential,...(data===undefined?{}:{'Content-Type':'application/json'})},
    ...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',credentials:'omit'
  });
  if(activeEpoch!==epoch) throw new Error('Сеанс завершён.');
  if(response.status===401) { resetSession(); throw new Error('Ключ доступа не принят. Войдите снова.'); }
  if(!response.ok) {
    const errors={400:'Проверьте поля и подтверждение.',404:'Запись не найдена.',409:'Операция конфликтует с текущим состоянием. Обновите запись, проверьте сумму или ID.',413:'Слишком большой запрос.',422:'Проверьте формат UUID и данных.',429:'Лимит запросов. Повторите позже.',503:'База недоступна.'};
    throw new Error(errors[response.status] || ('Ошибка сервиса: '+response.status));
  }
  return response.json();
}
async function act(fn) {
  if(busy) return;
  busy=true;
  const currentEpoch=epoch;
  // Prevent competing mutations and selection changes while an operation is pending.
  $('workspace').setAttribute('aria-busy','true');
  $('workspace').inert=true; $('login').inert=true; $('logout').disabled=true;
  try { await fn(); } catch(e) { if(epoch===currentEpoch || !credential) message(e.message || 'Ошибка операции',true); }
  finally { busy=false; $('workspace').inert=false; $('login').inert=false; $('workspace').removeAttribute('aria-busy'); $('logout').disabled=false; }
}
function updatePlan() {
  const p=plans.find(x=>x.code===$('plan').value);
  if(p) $('amount').value=(p.amount_kopecks/100).toFixed(2);
  $('confirmed').checked=false;
}
function fillPlans() {
  $('plan').replaceChildren(...plans.filter(p=>p.product_code==='raschet').map(p=>{
    const o=document.createElement('option'); o.value=p.code;
    o.textContent=(planNames[p.code] || p.code)+' — '+money(p.amount_kopecks); return o;
  }));
  updatePlan();
}
function cell(row,value) { const td=row.insertCell(); td.textContent=value; return td; }
async function loadCustomers(after=null) {
  const rows=await request('/subscriptions'+(after?'?after='+encodeURIComponent(after):''));
  const body=$('customers');
  if(!after) body.replaceChildren();
  for(const s of rows) {
    const tr=body.insertRow(), first=tr.insertCell(), button=document.createElement('button');
    button.type='button'; button.className='text-button'; button.textContent=s.customer_id;
    button.addEventListener('click',()=>act(()=>loadSelected(s.id)));
    first.append(button);
    const small=document.createElement('small'); small.textContent=s.id; first.append(small);
    cell(tr,statusNames[s.status] || s.status); cell(tr,date(s.valid_until));
  }
  $('empty').hidden=body.rows.length!==0;
  next=rows.length===100?rows[rows.length-1].id:null;
  $('next-page').hidden=!next;
}
function line(parent,title,body) {
  const item=document.createElement('div'); item.className='history-item';
  const strong=document.createElement('strong'); strong.textContent=title;
  const p=document.createElement('p'); p.textContent=body;
  item.append(strong,p); parent.append(item); return item;
}
function renderHistory(history) {
  const target=$('history'); target.replaceChildren();
  for(const g of history.grants) line(target,(planNames[g.plan_code] || g.plan_code)+' · '+money(g.amount_kopecks),
    date(g.starts_at)+' → '+date(g.ends_at)+' · '+g.id);
  for(const i of history.installations) line(target,i.old_installation?'Перенос устройства':'Привязка устройства',date(i.recorded_at)+' · '+i.new_installation);
  for(const d of history.downloads) {
    const live=!d.consumed_at && !d.revoked_at && Date.parse(d.expires_at)>Date.now();
    const item=line(target,'APK · '+(d.consumed_at?'Использована':d.revoked_at?'Отозвана':live?'Доступна':'Истекла'),date(d.created_at)+' · '+d.id);
    if(!d.consumed_at && !d.revoked_at) {
      const button=document.createElement('button'); button.type='button'; button.className='secondary'; button.textContent='Отозвать';
      const sid=selected.id;
      button.addEventListener('click',()=>act(async()=>{
        if(!confirm('Отозвать эту ссылку?')) return;
        await request('/subscriptions/'+sid+'/downloads/'+d.id+'/revoke',{},'POST');
        resetLink(); message('Ссылка отозвана.'); await refreshAfterMutation(sid);
      }));
      item.append(button);
    }
  }
  if(!target.children.length) target.textContent='Нет операций.';
}
async function loadSelected(id,preserveLink=false) {
  const s=await request('/subscriptions/'+encodeURIComponent(id));
  const history=await request('/subscriptions/'+encodeURIComponent(id)+'/history');
  if(!preserveLink || selected?.id!==s.id) resetLink();
  if(selected?.id!==s.id) {
    $('payment-id').value=''; $('bind-id').value=''; $('device-id').value=''; $('confirmed').checked=false;
  }
  selected=s; $('open-id').value=s.id; $('selected').hidden=false; $('select-hint').hidden=true;
  text('selected-id',s.id); text('selected-status',statusNames[s.status] || s.status);
  text('selected-until',date(s.valid_until)); text('selected-device',s.installation_id);
  text('selected-plan',planNames[s.effective_plan] || s.effective_plan);
  renderHistory(history);
}
async function refreshAfterMutation(id,preserveLink=false) {
  try { await loadSelected(id,preserveLink); await loadCustomers(); }
  catch(e) { message('Операция подтверждена сервером, но обновить экран не удалось. Не повторяйте её с новым ID. '+e.message,true); }
}
function on(id,fn) {
  $(id).addEventListener('submit',e=>{ e.preventDefault(); act(fn); });
}
on('login-form',async()=>{
  credential=$('token').value.trim(); $('token').value='';
  plans=await request('/plans'); const release=await request('/release');
  fillPlans(); text('release-info',release.version_name+' · '+release.tag+' · '+(release.size/1024/1024).toFixed(1)+' МиБ · предварительная сборка');
  text('release-sha',release.sha256); await loadCustomers();
  $('login').hidden=true; $('workspace').hidden=false; $('logout').hidden=false;
  message('Доступ подтверждён.');
});
$('logout').addEventListener('click',()=>{resetSession(); message('Сеанс завершён.');});
$('refresh').addEventListener('click',()=>act(async()=>{ await loadCustomers(); if(selected) await loadSelected(selected.id,true); message('Данные обновлены.'); }));
$('next-page').addEventListener('click',()=>act(()=>loadCustomers(next)));
$('new-ids').addEventListener('click',()=>{ $('customer-id').value=uuid(); $('subscription-id').value=uuid(); });
$('new-payment').addEventListener('click',()=>{ $('payment-id').value=uuid(); });
$('new-bind').addEventListener('click',()=>{ $('bind-id').value=uuid(); });
$('plan').addEventListener('change',updatePlan);
on('create-form',async()=>{
  const id=$('subscription-id').value.trim();
  await request('/subscriptions',{id,customer_id:$('customer-id').value.trim(),product:'raschet'});
  message('Подписка создана.'); await refreshAfterMutation(id);
});
on('open-form',()=>loadSelected($('open-id').value.trim()));
on('grant-form',async()=>{
  if(!selected) return;
  const raw=$('amount').value.trim().replace(',','.');
  if(!/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(raw)) throw new Error('Введите сумму в рублях, не более двух знаков после запятой.');
  const [whole,fraction='']=raw.split('.');
  const confirmed_kopecks=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  const id=selected.id;
  const result=await request('/subscriptions/'+id+'/grant',{event_id:$('payment-id').value.trim(),plan:$('plan').value,confirmed_kopecks,confirmed:$('confirmed').checked});
  $('confirmed').checked=false;
  message('Начисление подтверждено. Новый срок: '+date(result.ends_at)); await refreshAfterMutation(id,true);
});
on('bind-form',async()=>{
  if(!selected) return;
  const id=selected.id;
  if(selected.installation_id && !confirm('Перенести подписку на новое устройство?')) return;
  await request('/subscriptions/'+id+'/installation',{event_id:$('bind-id').value.trim(),old_installation:selected.installation_id,new_installation:$('device-id').value.trim()});
  message('Привязка сохранена.'); await refreshAfterMutation(id,true);
});
$('issue').addEventListener('click',()=>act(async()=>{
  if(!selected) return;
  resetLink();
  const id=selected.id;
  const result=await request('/subscriptions/'+id+'/download',{event_id:uuid()});
  $('download-link').value=result.url; text('link-expiry','Истекает '+date(result.grant.expires_at));
  $('link-box').hidden=false; message('Ссылка создана. Передайте её клиенту.');
  await refreshAfterMutation(id,true);
}));
$('copy').addEventListener('click',()=>act(async()=>{
  if(!$('download-link').value) return;
  await navigator.clipboard.writeText($('download-link').value); message('Ссылка скопирована.');
}));
