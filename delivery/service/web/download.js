'use strict';
const start=document.getElementById('start'), status=document.getElementById('status'), save=document.getElementById('save');
let token=location.hash.slice(1), proof='', objectUrl=null;
history.replaceState(null,'',location.pathname);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
if(/^[0-9a-f]{64}$/.test(token) && globalThis.crypto?.subtle) {
  proof=hex(crypto.getRandomValues(new Uint8Array(32)));
  start.disabled=false; status.textContent='Ссылка готова к использованию.';
} else { token=''; status.textContent='Нет действительной ссылки или защищённого соединения. Запросите новую у администратора.'; }
function clear(){token=''; proof='';}
function retry(){start.disabled=false; status.textContent='Загрузка не завершена. Повторите в этой вкладке в течение 5 минут; не закрывайте её.';}
start.addEventListener('click',async()=>{
  if(!token || !proof || start.disabled) return;
  start.disabled=true; status.textContent='Получаем и проверяем APK…';
  try {
    const r=await fetch('/api/v1/download',{method:'POST',
      headers:{Authorization:'Bearer '+token,'X-Ventry-Download-Retry':proof},
      cache:'no-store',credentials:'omit',redirect:'error'});
    if(!r.ok) {
      if(r.status===408 || r.status===429 || r.status>=500) { retry(); return; }
      clear(); status.textContent='Ссылка недоступна, использована или истекла. Запросите новую.'; return;
    }
    const size=Number(r.headers.get('X-Ventry-APK-Size')), digest=r.headers.get('X-Ventry-APK-SHA256');
    if(r.headers.get('Content-Type')!=='application/vnd.android.package-archive'
       || !Number.isSafeInteger(size) || size<=0 || size>64*1024*1024 || !/^[0-9a-f]{64}$/.test(digest||'')) throw new Error('invalid metadata');
    const blob=await r.blob();
    if(blob.size!==size || hex(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))!==digest) throw new Error('invalid bytes');
    clear();
    objectUrl=URL.createObjectURL(blob); save.href=objectUrl; save.hidden=false;
    start.hidden=true; status.textContent='Файл получен и проверен. Нажмите «Сохранить APK».';
  } catch { retry(); }
});
addEventListener('pagehide',()=>{clear(); if(objectUrl) URL.revokeObjectURL(objectUrl);});
// Opening another personal link in the same tab may be fragment-only navigation.
addEventListener('hashchange',()=>{if(location.hash) location.reload();});
