"""End-to-end on isolated CI: actual public route -> Go gateway -> verified private TLS -> Rust -> PG."""
import hashlib,json,secrets,ssl,sys,subprocess
from pathlib import Path
from urllib import request,error
from uuid import uuid4
state=Path(sys.argv[1])
ctx=ssl.create_default_context(cafile=str(state/"tls/ca.pem"))
uid=lambda:str(uuid4())
secret=lambda:secrets.token_hex(32)
def call(base,path,token,body=b"",headers=None,status=200):
    h={"Authorization":"Bearer "+token,**(headers or {})}
    if base.startswith("http:"):h["Host"]="license.ventrylab.top:18089"
    q=request.Request(base+"/api/v1"+path,data=body,headers=h,method="POST")
    try:
        with request.urlopen(q,context=ctx,timeout=110) as r: code=r.status; data=r.read(); headers=r.headers
    except error.HTTPError as e:code=e.code;data=e.read();headers=e.headers
    assert code==status,(path,code,status)
    return data,headers
admin="https://127.0.0.1:18443"
public="http://127.0.0.1:18089"
def j(base,path,token,payload,status=200):
    return json.loads(call(base,path,token,json.dumps(payload).encode(),{"Content-Type":"application/json"},status)[0])
session=j(admin,"/session",(state/"secrets/admin-token").read_text().strip(),{})["session_token"]
sub,device,token=uid(),uid(),secret()
j(admin,"/subscriptions",session,{"id":sub,"customer_id":uid(),"product":"raschet"})
j(admin,f"/subscriptions/{sub}/grant",session,{"event_id":uid(),"plan":"month","confirmed_kopecks":29900,"confirmed":True})
code=j(admin,f"/subscriptions/{sub}/activations",session,{"event_id":uid(),"trial":False})["code"]
j(public,"/activate",code,{"installation_id":device,"product":"raschet","refresh_secret":token})
headers={"X-Ventry-Installation":device}
assert json.loads(call(public,"/backups/list",token,headers=headers)[0])==[]
v=uid();payload=b"VRB1"+secrets.token_bytes(16*1024*1024-4)
upload={**headers,"X-Ventry-Backup-Version":v,"X-Ventry-Backup-Expected":"empty","Content-Type":"application/octet-stream"}
saved=json.loads(call(public,"/backups/1/put",token,payload,upload)[0])
assert saved["sha256"]==hashlib.sha256(payload).hexdigest()
data,h=call(public,"/backups/1/read",token,headers={**headers,"X-Ventry-Backup-Version":v})
assert data==payload and h["X-Ventry-Backup-SHA256"]==saved["sha256"] and h["Cache-Control"]=="no-store"
call(public,"/backups/1/read",secret(),headers={**headers,"X-Ventry-Backup-Version":v},status=404)
# urllib writes the entire body before reading the HTTP response. A peer that
# correctly rejects Content-Length early can close that write with EPIPE instead
# of exposing 413 to urllib. Curl supports concurrent response handling and
# Expect: 100-continue; still require the exact rejection status, not EPIPE.
oversize_headers={**upload,"X-Ventry-Backup-Version":uid(),"X-Ventry-Backup-Expected":v}
args=["curl","--silent","--show-error","--http1.1","--max-time","110",
      "--expect100-timeout","3","--output","/dev/null","--write-out","%{http_code}",
      "--header","Host: license.ventrylab.top:18089",
      "--header","Authorization: Bearer "+token,"--header","Expect: 100-continue"]
for k,value in oversize_headers.items():args.extend(["--header",k+": "+value])
args.extend(["--data-binary","@-",public+"/api/v1/backups/1/put"])
rejected=subprocess.run(args,input=payload+b"x",capture_output=True,check=True)
assert rejected.stdout==b"413",("oversize HTTP status",rejected.stdout)
# The rejected request must not replace the previously valid 16 MiB slot.
assert json.loads(call(public,"/backups/list",token,headers=headers)[0])==[saved]
assert call(public,"/backups/1/read",token,headers={**headers,"X-Ventry-Backup-Version":v})[0]==payload
call(public,"/projects",session,status=404)
assert j(admin,"/session/logout",session,{})["revoked"]
