#!/usr/bin/env python3
"""Isolated test DB and synthetic opaque envelopes, no live books."""
import concurrent.futures
import hashlib,json,os,secrets,subprocess
from pathlib import Path
from urllib import request,error
from uuid import uuid4
ADMIN="http://127.0.0.1:18081/api/v1"
PUBLIC="http://127.0.0.1:18082/api/v1"
operator=Path(os.environ["DELIVERY_ADMIN_TOKEN_FILE"]).read_text().strip()
uid=lambda:str(uuid4())
secret=lambda:secrets.token_hex(32)
def req(base,path,token,body=b"",headers=None,status=200):
    h={"Authorization":"Bearer "+token,**(headers or {})}
    q=request.Request(base+path,data=body,headers=h,method="POST")
    try:
        with request.urlopen(q,timeout=20) as r: code=r.status; data=r.read(); response=r.headers
    except error.HTTPError as e: code=e.code; data=e.read(); response=e.headers
    assert code==status,(path,code,status)
    return data,response
def j(base,path,token,body,status=200):
    return json.loads(req(base,path,token,json.dumps(body).encode(),{"Content-Type":"application/json"},status)[0])
def activate(sub=None):
    if sub is None:
        sub=uid()
        j(ADMIN,"/subscriptions",operator,{"id":sub,"customer_id":uid(),"product":"raschet"})
        j(ADMIN,f"/subscriptions/{sub}/grant",operator,{"event_id":uid(),"plan":"month","confirmed_kopecks":29900,"confirmed":True})
    code=j(ADMIN,f"/subscriptions/{sub}/activations",operator,{"event_id":uid(),"trial":False})["code"]
    device,token=uid(),secret()
    j(PUBLIC,"/activate",code,{"installation_id":device,"product":"raschet","refresh_secret":token})
    return sub,device,token
def backup(path,device,token,body=b"",headers=None,status=200):
    return req(PUBLIC,"/backups/"+path,token,body,{"X-Ventry-Installation":device,**(headers or {})},status)
def put(device,token,slot,version,expected,data,status=200):
    return backup(f"{slot}/put",device,token,data,{"Content-Type":"application/octet-stream","X-Ventry-Backup-Version":version,"X-Ventry-Backup-Expected":expected},status)
def read(device,token,slot,version,status=200):
    return backup(f"{slot}/read",device,token,headers={"X-Ventry-Backup-Version":version},status=status)
def list_(device,token,status=200):
    return json.loads(backup("list",device,token,status=status)[0])
def owner_sql(sql):
    subprocess.run(["docker","exec","-i","ventry-delivery-service-ci","psql","-X","-U","postgres","-d","delivery","-v","ON_ERROR_STOP=1"],input=sql.encode(),check=True,stdout=subprocess.DEVNULL)
owner_sql("""DO $$ BEGIN
ASSERT NOT has_table_privilege('delivery_api','delivery.cloud_backup','SELECT');
ASSERT NOT has_table_privilege('delivery_api','delivery.cloud_backup','INSERT');
ASSERT NOT has_table_privilege('delivery_api','delivery.cloud_backup','UPDATE');
ASSERT NOT has_table_privilege('delivery_api','delivery.cloud_backup','DELETE');
ASSERT NOT has_function_privilege('delivery_api','delivery.backup_subject(bytea,uuid,boolean)','EXECUTE');
END $$;""")
sub,d,t=activate();other,od,ot=activate()
assert list_(d,t)==[]
assert list_(od,ot)==[]
list_(d,ot,404);list_(od,t,404)
v=uid();payload=b"VRB1"+secrets.token_bytes(80)
first=json.loads(put(d,t,1,v,"empty",payload)[0])
assert first["version"]==v and first["size"]==len(payload) and first["sha256"]==hashlib.sha256(payload).hexdigest()
assert json.loads(put(d,t,1,v,"empty",payload)[0])==first
put(d,t,1,v,"empty",payload+b"x",409)
put(d,t,1,uid(),"empty",payload,409)
put(d,t,4,uid(),"empty",payload,400)
put(d,t,2,uid(),"empty",b"plaintext",400)
put(d,t,2,uid(),"empty",b"VRB1"+bytes(16777213),413)
data,headers=read(d,t,1,v);assert data==payload and headers["X-Ventry-Backup-SHA256"]==first["sha256"] and headers["Cache-Control"]=="no-store"
read(od,ot,1,v,404)
assert list_(od,ot)==[]
# Same slot in separate subscription does not overwrite the first.
put(od,ot,1,uid(),"empty",payload+b"other")
assert list_(d,t)==[first]
# Exactly one concurrent replacement succeeds. The other sees conflict.
vs=[uid(),uid()]
def replace(candidate):
    try:
        result=put(d,t,1,candidate,v,payload+b"replacement")
        return json.loads(result[0])["version"]
    except AssertionError as e:
        assert e.args[0][1]==409
        return None
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(replace,vs))
winner=next(x for x in results if x is not None)
assert results.count(None)==1
read(d,t,1,v,404)
put(d,t,2,uid(),"empty",payload)
assert len(list_(d,t))==2
# Transfer invalidates old binding but retains subscription-scoped encrypted backups.
_,d2,t2=activate(sub)
list_(d,t,404);read(d,t,1,winner,404)
assert len(list_(d2,t2))==2
assert read(d2,t2,1,winner)[0]==payload+b"replacement"
owner_sql(f"UPDATE delivery.subscription SET valid_until=clock_timestamp()-interval '1 second' WHERE id='{sub}'")
assert len(list_(d2,t2))==2
assert read(d2,t2,1,winner)[0]==payload+b"replacement"
put(d2,t2,3,uid(),"empty",payload,403)
req(ADMIN,"/backups/list",operator,headers={"X-Ventry-Installation":d2},status=404)
print("DELIVERY_CLOUD_BACKUP_ISOLATION_CAS_TRANSFER_EXPIRY_PASS")
