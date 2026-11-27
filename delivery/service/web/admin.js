'use strict';
const $ = id => document.getElementById(id);
let credential = '', plans = [], projects = [], currentProject = null, selected = null, next = null, busy = false, epoch = 0;
const statusNames = {not_started:'Не начата', awaiting_activation:'Ожидает активации', active:'Активна', expired:'Истекла'};
const planNames = {trial:'7 дней · пробный', month:'1 месяц', quarter:'3 месяца', year:'1 год'};
const money = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(n/100);
const date = value => value ? new Date(value).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'}) : '—';
const uuid = () => crypto.randomUUID();
function message(text,error=false) { $('message').textContent=text; $('message').classList.toggle('error',error); }
function text(id,value) { $(id).textContent=value ?? '—'; }
function resetLink() { $('link-box').hidden=true; $('download-link').value=''; text('link-expiry',''); }
function resetSession() {
  epoch++; credential=''; plans=[]; projects=[]; currentProject=null; selected=null; next=null;
  $('project-select').replaceChildren(); $('project-plans').replaceChildren(); $('new-plan-code').replaceChildren();
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
  $('amount').value=p?(p.amount_kopecks/100).toFixed(2):'';
  $('grant-form').querySelector('button[type=submit]').disabled=!p;
  $('confirmed').checked=false;
}
function fillPlans() {
  $('plan').replaceChildren(...plans.filter(p=>p.enabled).map(p=>{
    const o=document.createElement('option'); o.value=p.code;
    o.textContent=(planNames[p.code] || p.code)+' — '+money(p.amount_kopecks); return o;
  }));
  updatePlan();
}
function cell(row,value) { const td=row.insertCell(); td.textContent=value; return td; }
function parseKopecks(value) {
  const raw=value.trim().replace(',','.');
  if(!/^[0-9]{1,7}(?:\.[0-9]{1,2})?$/.test(raw)) throw new Error('Введите сумму в рублях, не более двух знаков после запятой.');
  const [whole,fraction='']=raw.split('.');
  return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
function clearSelected() {
  selected=null; next=null; resetLink();
  $('selected').hidden=true; $('select-hint').hidden=false; $('history').replaceChildren();
  $('payment-id').value=''; $('bind-id').value=''; $('device-id').value=''; $('open-id').value='';
  $('customer-id').value=''; $('subscription-id').value=''; $('confirmed').checked=false;
}
function renderProject() {
  if(!currentProject) return;
  const p=currentProject;
  text('project-package',p.package_name || 'Package ID не задан');
  text('metric-active',p.active_subscriptions); text('metric-expiring',p.expiring_soon);
  text('metric-expired',p.expired_subscriptions); text('metric-pending',p.pending_subscriptions);
  text('metric-confirmed',money(p.confirmed_kopecks));
  $('issue').disabled=!p.release_available;
  text('issue-note',p.release_available?'Одна загрузка, 30 минут. При прерывании скачивания потребуется новый код. Если ссылка ещё действует, сначала отзовите её.':'Для проекта ещё нет одобренной APK-сборки. Выдача недоступна.');
}
async function loadProjects(preferred) {
  const data=await request('/projects');
  if(!data.length) throw new Error('Каталог проектов пуст.');
  projects=data;
  const choice=projects.find(p=>p.code===preferred) || projects.find(p=>p.code==='raschet') || projects[0];
  $('project-select').replaceChildren(...projects.map(p=>{
    const option=document.createElement('option'); option.value=p.code; option.textContent=p.display_name; return option;
  }));
  $('project-select').value=choice.code;
  return choice;
}
async function loadProjectPlans() {
  plans=await request('/projects/'+encodeURIComponent(currentProject.code)+'/plans');
  fillPlans();
  const list=$('project-plans');
  list.replaceChildren(...plans.map(p=>{
    const item=document.createElement('li');
    item.textContent=(planNames[p.code] || p.code)+' — '+money(p.amount_kopecks)+(p.enabled?'':' (отключён)'); return item;
  }));
  if(!plans.length) { const item=document.createElement('li'); item.textContent='Тарифов пока нет.'; list.append(item); }
  const available=Object.keys(planNames).filter(code=>!plans.some(p=>p.code===code));
  $('new-plan-code').replaceChildren(...available.map(code=>{
    const option=document.createElement('option'); option.value=code; option.textContent=planNames[code]; return option;
  }));
  $('add-plan').disabled=!available.length; $('new-plan-amount').disabled=!available.length;
  $('new-plan-amount').value=available[0]==='trial'?'0.00':'';
  text('plan-hint',available.length?'Цена задаётся отдельно; уже созданный тариф пока нельзя изменить.':'Все поддерживаемые периоды настроены.');
}
async function loadProject(code) {
  // Clear the previous project before requesting new scoped data. On error no stale row can be mutated.
  clearSelected(); $('customers').replaceChildren(); $('empty').hidden=true; $('next-page').hidden=true;
  plans=[]; fillPlans(); $('project-plans').replaceChildren(); $('new-plan-code').replaceChildren(); $('add-plan').disabled=true;
  text('release-info',''); text('release-sha','');
  currentProject=null;
  const p=await loadProjects(code);
  currentProject=p; renderProject();
  await loadProjectPlans();
  if(p.release_available) {
    const release=await request('/release');
    if(release.product!==p.code) throw new Error('Сборка не соответствует текущему проекту.');
    text('release-info',release.version_name+' · '+release.tag+' · '+(release.size/1024/1024).toFixed(1)+' МиБ · предварительная сборка');
    text('release-sha',release.sha256);
  } else {
    text('release-info','Одобренной сборки нет.');
  }
  await loadCustomers();
}
async function refreshProjectMetrics() {
  if(!currentProject) return;
  currentProject=await loadProjects(currentProject.code);
  renderProject();
}
async function loadCustomers(after=null) {
  if(!currentProject) return;
  const rows=await request('/subscriptions?product='+encodeURIComponent(currentProject.code)+(after?'&after='+encodeURIComponent(after):''));
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
  if(!currentProject) throw new Error('Выберите проект.');
  const s=await request('/subscriptions/'+encodeURIComponent(id));
  if(s.product_code!==currentProject.code) throw new Error('Подписка относится к другому проекту. Переключите проект.');
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
  try { await loadSelected(id,preserveLink); await loadCustomers(); await refreshProjectMetrics(); }
  catch(e) { message('Операция подтверждена сервером, но обновить экран не удалось. Не повторяйте её с новым ID. '+e.message,true); }
}
function on(id,fn) {
  $(id).addEventListener('submit',e=>{ e.preventDefault(); act(fn); });
}
on('login-form',async()=>{
  credential=$('token').value.trim(); $('token').value='';
  const session=await request('/session',{},'POST');
  if(!/^[0-9a-f]{64}$/.test(session.session_token) || session.expires_in_seconds!==900) throw new Error('Некорректный сеанс.');
  credential=session.session_token;
  await loadProject('raschet');
  $('login').hidden=true; $('workspace').hidden=false; $('logout').hidden=false;
  message('Доступ подтверждён.');
});
$('logout').addEventListener('click',()=>act(async()=>{
  try { await request('/session/logout',{},'POST'); message('Сеанс завершён.'); }
  catch { message('Локальный сеанс закрыт. Серверный ключ истечёт автоматически.',true); }
  finally { resetSession(); }
}));
$('refresh').addEventListener('click',()=>act(async()=>{ await loadCustomers(); if(selected) await loadSelected(selected.id,true); await refreshProjectMetrics(); message('Данные обновлены.'); }));
$('project-select').addEventListener('change',()=>act(()=>loadProject($('project-select').value)));
on('project-form',async()=>{
  const data={code:$('project-code').value.trim(),display_name:$('project-name').value.trim(),package_name:$('project-package-input').value.trim()};
  await request('/projects',data);
  $('project-form').reset();
  await loadProject(data.code); message('Проект создан.');
});
$('new-plan-code').addEventListener('change',()=>{
  $('new-plan-amount').value=$('new-plan-code').value==='trial'?'0.00':'';
});
on('project-plan-form',async()=>{
  if(!currentProject) return;
  const code=$('new-plan-code').value;
  const amount_kopecks=parseKopecks($('new-plan-amount').value);
  if(!confirm('Создать тариф '+(planNames[code] || code)+' за '+money(amount_kopecks)+'? Цена пока не редактируется.')) return;
  await request('/projects/'+encodeURIComponent(currentProject.code)+'/plans',{code,amount_kopecks});
  await loadProjectPlans(); await refreshProjectMetrics(); message('Тариф создан.');
});
$('next-page').addEventListener('click',()=>act(()=>loadCustomers(next)));
$('new-ids').addEventListener('click',()=>{ $('customer-id').value=uuid(); $('subscription-id').value=uuid(); });
$('new-payment').addEventListener('click',()=>{ $('payment-id').value=uuid(); });
$('new-bind').addEventListener('click',()=>{ $('bind-id').value=uuid(); });
$('plan').addEventListener('change',updatePlan);
on('create-form',async()=>{
  const id=$('subscription-id').value.trim();
  if(!currentProject) throw new Error('Выберите проект.');
  await request('/subscriptions',{id,customer_id:$('customer-id').value.trim(),product:currentProject.code});
  message('Подписка создана.'); await refreshAfterMutation(id);
});
on('open-form',()=>loadSelected($('open-id').value.trim()));
on('grant-form',async()=>{
  if(!selected) return;
  const confirmed_kopecks=parseKopecks($('amount').value);
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
  if(!selected || !currentProject?.release_available) return;
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
