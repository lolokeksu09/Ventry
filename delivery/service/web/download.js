'use strict';
const start=document.getElementById('start'), status=document.getElementById('status'), save=document.getElementById('save');
let token=location.hash.slice(1), objectUrl=null;
history.replaceState(null,'',location.pathname);
if(/^[0-9a-f]{64}$/.test(token)) {
  start.disabled=false; status.textContent='Ссылка готова к использованию.';
} else { token=''; status.textContent='Нет действительной ссылки. Запросите новую у администратора.'; }
start.addEventListener('click',async()=>{
  if(!token || start.disabled) return;
  start.disabled=true; status.textContent='Получаем APK…';
  try {
    const r=await fetch('/api/v1/download',{method:'POST',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit'});
    if(!r.ok) {
      if(r.status===429 || r.status===503) {
        start.disabled=false; status.textContent='Сервис временно недоступен. Повторите запрос позже.'; return;
      }
      token=''; status.textContent='Ссылка недоступна, использована или истекла. Запросите новую.'; return;
    }
    token='';
    if(r.headers.get('Content-Type')!=='application/vnd.android.package-archive') throw new Error('invalid content');
    const blob=await r.blob();
    objectUrl=URL.createObjectURL(blob); save.href=objectUrl; save.hidden=false;
    start.hidden=true; status.textContent='Файл получен. Нажмите «Сохранить APK».';
  } catch {
    // A server-side consumption may have succeeded before a network interruption.
    token=''; status.textContent='Не удалось получить файл. Запросите новую ссылку.';
  }
});
addEventListener('pagehide',()=>{if(objectUrl) URL.revokeObjectURL(objectUrl);});

// Opening another personal link in the same tab may be fragment-only navigation.
addEventListener('hashchange',()=>{if(location.hash) location.reload();});
