#!/usr/bin/env python3
"""Real API/DB tests; independent OpenSSL verification of exact signed bytes."""
import concurrent.futures
import hashlib
import json
import os
import secrets
import subprocess
import tempfile
import time
from pathlib import Path
from urllib import request,error
from uuid import uuid4

ADMIN="http://127.0.0.1:18081"
PUBLIC="http://127.0.0.1:18082"
OPERATOR=Path(os.environ["DELIVERY_ADMIN_TOKEN_FILE"]).read_text().strip()
SEED=bytes.fromhex(Path(os.environ["DELIVERY_SIGNING_KEY_FILE"]).read_text().strip())
def uid(): return str(uuid4())
def secret(): return secrets.token_hex(32)
def call(base,path,token,body=None,expected=200):
    data=None if body is None else json.dumps(body).encode()
    q=request.Request(base+"/api/v1"+path,data=data,headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with request.urlopen(q,timeout=15) as r:
            status=r.status; value=json.load(r)
    except error.HTTPError as e:
        status=e.code; value=json.load(e)
    assert status==expected,(path,status,expected)
    return value
def admin(path,body=None,expected=200):return call(ADMIN,path,OPERATOR,body,expected)
def activate(code,device,refresh,product="raschet",expected=200):
    return call(PUBLIC,"/activate",code,{"installation_id":device,"product":product,"refresh_secret":refresh},expected)
def refresh(token,device,product="raschet",expected=200):
    return call(PUBLIC,"/entitlement",token,{"installation_id":device,"product":product},expected)
def new_sub():
    s=uid();admin("/subscriptions",{"id":s,"customer_id":uid(),"product":"raschet"});return s
def issue(s,trial,expected=200):
    return admin(f"/subscriptions/{s}/activations",{"event_id":uid(),"trial":trial},expected)
def grant(s,plan="month",amount=29900):
    return admin(f"/subscriptions/{s}/grant",{"event_id":uid(),"plan":plan,"confirmed_kopecks":amount,"confirmed":True})
with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)
    # RFC 8410 PKCS#8 private key containing the generated CI seed. No production key.
    private=path/"private.der"; private.write_bytes(bytes.fromhex("302e020100300506032b657004220420")+SEED)
    public=path/"public.der"
    subprocess.run(["openssl","pkey","-inform","DER","-in",str(private),"-pubout","-outform","DER","-out",str(public)],check=True,stdout=subprocess.DEVNULL)
    pub=public.read_bytes()
    assert pub.startswith(bytes.fromhex("302a300506032b6570032100")) and len(pub)==44
    key_id=hashlib.sha256(pub[-32:]).hexdigest()
    def verify(env):
        assert set(env)=={"key_id","payload_hex","signature_hex"} and env["key_id"]==key_id
        msg=bytes.fromhex(env["payload_hex"]);sig=bytes.fromhex(env["signature_hex"])
        assert len(sig)==64
        p=path/"message";s=path/"signature";p.write_bytes(msg);s.write_bytes(sig)
        args=["openssl","pkeyutl","-verify","-pubin","-keyform","DER","-inkey",str(public),"-rawin","-in",str(p),"-sigfile",str(s)]
        subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        p.write_bytes(msg+b" ")
        assert subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
        claims=json.loads(msg)
        assert claims["v"]==1 and claims["issuer"]=="ventry-delivery" and claims["product"]=="raschet"
        assert claims["package_name"]=="dev.ventry.raschet"
        assert abs(claims["issued_at"]-int(time.time()))<30
        assert claims["lease_until"]<=claims["issued_at"]+72*3600
        if claims["may_create_debt"]:assert claims["lease_until"]<=claims["valid_until"]
        return claims

    s=new_sub();d=uid();r=secret()
    issue(s,False,409)
    denied=call(PUBLIC,f"/subscriptions/{s}/activations",OPERATOR,{"event_id":uid(),"trial":True},404)
    call(ADMIN,f"/subscriptions/{s}/activations",secret(),{"event_id":uid(),"trial":True},401)
    trial=issue(s,True);code=trial["code"];event=trial["activation"]["id"]
    assert len(code)==64 and "token_hash" not in trial["activation"] and "refresh_hash" not in trial["activation"]
    assert admin(f"/subscriptions/{s}")["status"]=="not_started"
    issue(s,True,409)
    activate(code,d,r,"other",404)
    activate(code,d,code,expected=404)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:activate(code,d,r),range(2)))
    first,second=[verify(x) for x in results]
    assert first["subscription_id"]==s and first["installation_id"]==d
    assert first["revision"]==second["revision"] and first["valid_until"]==second["valid_until"]
    assert first["may_create_debt"] and 604790<=first["valid_until"]-first["issued_at"]<=604800
    assert len(admin(f"/subscriptions/{s}/history")["grants"])==1
    activate(code,uid(),secret(),expected=404)
    activate(code,d,secret(),expected=404)
    refresh(code,d,expected=404);refresh(r,uid(),expected=404)
    refresh(r,d,"other",404)
    assert verify(refresh(r,d))["valid_until"]==first["valid_until"]
    issue(s,True,409)
    paid=grant(s)
    renewed=verify(refresh(r,d))
    assert renewed["valid_until"]>first["valid_until"] and renewed["revision"]>first["revision"]
    assert renewed["valid_until"]-renewed["issued_at"]>72*3600
    transfer=issue(s,False);d2=uid();r2=secret()
    changed=verify(activate(transfer["code"],d2,r2))
    assert changed["installation_id"]==d2 and changed["valid_until"]==renewed["valid_until"]
    refresh(r,d,expected=404)
    activate(code,d,r,expected=404)
    assert verify(refresh(r2,d2))["revision"]==changed["revision"]
    # Manual transfer away and back invalidates the old session by binding revision.
    admin(f"/subscriptions/{s}/installation",{"event_id":uid(),"old_installation":d2,"new_installation":d})
    admin(f"/subscriptions/{s}/installation",{"event_id":uid(),"old_installation":d,"new_installation":d2})
    refresh(r2,d2,expected=404)
    stale=issue(s,False);grant(s)
    activate(stale["code"],d2,secret(),expected=404)
    admin(f"/subscriptions/{s}/activations/{stale['activation']['id']}/revoke",{})
    activate(stale["code"],d2,secret(),expected=404)
    new=issue(s,False);r3=secret();verify(activate(new["code"],d2,r3))
    # A separate subscription cannot reuse an installation for the same product.
    other=new_sub();grant(other);wrong=issue(other,False)
    activate(wrong["code"],d2,secret(),expected=404)
    assert admin(f"/subscriptions/{other}")["installation_id"] is None
    h=json.dumps(admin(f"/subscriptions/{s}/activations"))
    assert not any(x in h for x in [code,r,r2,r3,"token_hash","refresh_hash"])
    # Shift synthetic expiry using the trusted CI database operator only.
    sql=f"UPDATE delivery.subscription SET valid_until=clock_timestamp()-interval '1 second' WHERE id='{s}';"
    subprocess.run(["docker","exec","-i","ventry-delivery-service-ci","psql","-X","-U","postgres","-d","delivery","-v","ON_ERROR_STOP=1"],input=sql.encode(),check=True,stdout=subprocess.DEVNULL)
    expired=verify(refresh(r3,d2))
    assert not expired["may_create_debt"] and expired["lease_until"]==expired["issued_at"]
    issue(s,False,409)
    # Revoke a code before first use, then force expiry on a second code.
    sub=new_sub();t=issue(sub,True)
    admin(f"/subscriptions/{sub}/activations/{t['activation']['id']}/revoke",{})
    activate(t["code"],uid(),secret(),expected=404)
    t=issue(sub,True)
    sql=f"UPDATE delivery.activation_code SET created_at=transaction_timestamp()-interval '25 hours',expires_at=transaction_timestamp()-interval '1 hour' WHERE id='{t['activation']['id']}';"
    subprocess.run(["docker","exec","-i","ventry-delivery-service-ci","psql","-X","-U","postgres","-d","delivery","-v","ON_ERROR_STOP=1"],input=sql.encode(),check=True,stdout=subprocess.DEVNULL)
    activate(t["code"],uid(),secret(),expected=404)
    assert admin(f"/subscriptions/{sub}")["status"]=="not_started"
print("DELIVERY_ACTIVATION_ED25519_TRIAL_RENEWAL_TRANSFER_EXPIRY_PASS")
