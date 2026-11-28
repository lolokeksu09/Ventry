#!/usr/bin/env python3
"""Real HTTP/DB/API integration on CI loopback listeners. No real customers."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from uuid import uuid4

ADMIN = "http://127.0.0.1:18081"
PUBLIC = "http://127.0.0.1:18082"
SECRET = Path(os.environ["DELIVERY_ADMIN_TOKEN_FILE"]).read_text().strip()
RELEASE = json.loads((Path(__file__).parents[1] / "service/release.json").read_text())

def uid():
    return str(uuid4())

def call(base, path, *, token=None, data=None, method=None, raw=None, retry=None):
    headers = {} if retry is None else {"X-Ventry-Download-Retry": retry}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    if data is not None:
        raw = json.dumps(data).encode()
    if raw is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(base + path, data=raw, headers=headers,
                                 method=method or ("POST" if raw is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers

def expect(base, path, code, **kwargs):
    result = call(base, path, **kwargs)
    assert result[0] == code, f"Unexpected HTTP status {result[0]} for {path.split('?')[0]} (wanted {code})"
    assert result[2].get("Cache-Control") == "no-store"
    assert result[2].get("Referrer-Policy") == "no-referrer"
    assert "frame-ancestors 'none'" in result[2].get("Content-Security-Policy", "")
    if code >= 400:
        assert result[2].get("Content-Type","").startswith("application/json")
        assert isinstance(json.loads(result[1])["error"],str)
    return result

def admin(path, code=200, **kwargs):
    return json.loads(expect(ADMIN, "/api/v1" + path, code, token=SECRET, **kwargs)[1])

def redeem(token, code=200, **kwargs):
    return expect(PUBLIC, "/api/v1/download", code, token=token, method="POST", **kwargs)

def issue(sid):
    receipt = admin(f"/subscriptions/{sid}/download", data={"event_id":uid()})
    link = urlsplit(receipt["url"])
    assert link.netloc == "127.0.0.1:18082" and link.path == "/download"
    assert len(link.fragment) == 64 and not link.query
    assert "token_hash" not in receipt["grant"] and "retry_hash" not in receipt["grant"]
    return receipt["grant"]["id"], link.fragment

# Authentication must precede malformed/oversized request parsing.
expect(ADMIN,"/api/v1/plans",401)
expect(ADMIN,"/api/v1/plans",401,token="ab"*32)
expect(ADMIN,"/api/v1/subscriptions",401,raw=b"x"*5000)
expect(ADMIN,"/api/v1/subscriptions",413,token=SECRET,raw=b"x"*5000)
expect(PUBLIC,"/api/v1/subscriptions",404,token=SECRET)
expect(PUBLIC,"/api/v1/projects",404,token=SECRET)
expect(PUBLIC,"/admin.js",404)
expect(ADMIN,"/api/v1/download",404,method="POST")
expect(ADMIN,"/",200)
expect(PUBLIC,"/download",200)
assert [p["amount_kopecks"] for p in admin("/plans")] == [0,29900,79900,249000]
assert admin("/release") == RELEASE
sid, customer, second = uid(), uid(), uid()
payload = {"id":sid,"customer_id":customer,"product":"raschet"}
admin("/subscriptions",data=payload)
admin("/subscriptions",data=payload)
admin("/subscriptions",409,data={**payload,"customer_id":uid()})
admin("/subscriptions",409,data={**payload,"id":uid()})
assert admin("/subscriptions",422,data={**payload,"extra":"unexpected"})["error"]=="invalid_fields"
expect(ADMIN,"/api/v1/subscriptions",400,token=SECRET,raw=b"{")
expect(ADMIN,"/api/v1/subscriptions",415,token=SECRET,method="POST")
assert admin("/subscriptions",422,data={**payload,"customer_id":"not-a-uuid"})["error"]=="invalid_fields"
admin("/subscriptions",data={"id":second,"customer_id":uid(),"product":"raschet"})
assert admin(f"/subscriptions/{sid}")["status"]=="not_started"
admin(f"/subscriptions/{uid()}/history",404)
# Stale selection must not allocate a grant or block a valid subsequent issue.
before=admin(f"/subscriptions/{sid}/history")["downloads"]
wrong="0"*64 if RELEASE["sha256"]!="0"*64 else "1"*64
assert admin(f"/subscriptions/{sid}/download",409,data={"event_id":uid(),"expected_release_sha256":wrong})["error"]=="release_changed"
assert admin(f"/subscriptions/{sid}/download",400,data={"event_id":uid(),"expected_release_sha256":"invalid"})["error"]=="invalid_release"
assert admin(f"/subscriptions/{sid}/history")["downloads"]==before
# Bootstrap download works before installation, but never activates subscription.
receipt=admin(f"/subscriptions/{sid}/download",data={"event_id":uid(),"expected_release_sha256":RELEASE["sha256"]})
assert receipt["grant"]["release_sha256"]==RELEASE["sha256"]
event,token=receipt["grant"]["id"],urlsplit(receipt["url"]).fragment
assert admin(f"/subscriptions/{sid}")["status"]=="not_started"
admin(f"/subscriptions/{sid}/download",409,data={"event_id":uid()})
admin(f"/subscriptions/{second}/downloads/{event}/revoke",409,data={})
expect(PUBLIC,"/api/v1/download",404,token=SECRET,method="POST")
redeem(token,400,raw=b"unexpected")
expect(PUBLIC,"/download",200)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    jobs=[pool.submit(call,PUBLIC,"/api/v1/download",token=token,method="POST") for _ in range(2)]
    results=[x.result() for x in jobs]
assert sorted(x[0] for x in results)==[200,404]
apk=next(x for x in results if x[0]==200)
assert apk[2]["Content-Type"]=="application/vnd.android.package-archive"
assert len(apk[1])==RELEASE["size"]
assert hashlib.sha256(apk[1]).hexdigest()==RELEASE["sha256"]
redeem(token,404)
event2, token2=issue(sid)
admin(f"/subscriptions/{sid}/downloads/{event2}/revoke",data={})
redeem(token2,404)
# Lost response recovery: the link is claimed by one independently generated
# browser credential; a second browser cannot obtain the APK from that link.
event3, token3=issue(sid)
retry="42"*32
other_retry="43"*32
redeem(token3,404,retry=token3)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results=list(pool.map(lambda proof:call(PUBLIC,"/api/v1/download",token=token3,method="POST",retry=proof),[retry,other_retry]))
assert sorted(x[0] for x in results)==[200,404]
winner=retry if results[0][0]==200 else other_retry
loser=other_retry if winner==retry else retry
redeem(token3,404)
redeem(token3,404,retry=loser)
again=redeem(token3,200,retry=winner)
assert hashlib.sha256(again[1]).hexdigest()==RELEASE["sha256"]
assert again[2]["X-Ventry-APK-SHA256"]==RELEASE["sha256"]
assert again[2]["X-Ventry-APK-Size"]==str(RELEASE["size"])
redeem(token3,200,retry=winner)
redeem(token3,404,retry=winner)
event4, token4=issue(sid)
redeem(token4,200,retry=winner)
admin(f"/subscriptions/{sid}/downloads/{event4}/revoke",data={})
redeem(token4,404,retry=winner)
history=json.dumps(admin(f"/subscriptions/{sid}/history"))
assert winner not in history and loser not in history and "retry_hash" not in history
assert admin(f"/subscriptions/{sid}")["status"]=="not_started"
print("DELIVERY_DOWNLOAD_BOUNDED_SAME_RECIPIENT_RETRY_PASS")
assert token not in json.dumps(admin(f"/subscriptions/{sid}/history"))
assert "token_hash" not in json.dumps(admin(f"/subscriptions/{sid}/history"))
device,new_device=uid(),uid()
bind={"event_id":uid(),"old_installation":None,"new_installation":device}
assert admin(f"/subscriptions/{sid}/installation",data=bind)==admin(f"/subscriptions/{sid}/installation",data=bind)
trial={"event_id":uid(),"plan":"trial","confirmed_kopecks":0,"confirmed":True}
admin(f"/subscriptions/{sid}/grant",400,data={**trial,"confirmed":False})
admin(f"/subscriptions/{sid}/grant",data=trial)
assert admin(f"/subscriptions/{sid}")["status"]=="active"
grant={"event_id":uid(),"plan":"quarter","confirmed_kopecks":79900,"confirmed":True}
admin(f"/subscriptions/{sid}/grant",409,data={**grant,"confirmed_kopecks":1})
paid=admin(f"/subscriptions/{sid}/grant",data=grant)
assert paid==admin(f"/subscriptions/{sid}/grant",data=grant)
admin(f"/subscriptions/{sid}/grant",409,data={**grant,"plan":"month","confirmed_kopecks":29900})
admin(f"/subscriptions/{sid}/installation",data={"event_id":uid(),"old_installation":device,"new_installation":new_device})
admin(f"/subscriptions/{sid}/installation",409,data={"event_id":uid(),"old_installation":device,"new_installation":uid()})
s=admin(f"/subscriptions/{sid}")
assert s["installation_id"]==new_device and s["valid_until"]==paid["ends_at"]
assert len(admin(f"/subscriptions/{sid}/history")["grants"])==2
# New desk endpoints use the existing private admin authorization boundary.
expect(ADMIN,f"/api/v1/customers/{customer}",401)
expect(PUBLIC,f"/api/v1/customers/{customer}",404,token=SECRET)
assert admin(f"/customers/{customer}")["display_name"] is None
assert admin(f"/customers/{customer}",data={"display_name":"Test shop","revision":0})["revision"]==1
admin(f"/customers/{customer}",422,data={"revision":1})
admin(f"/customers/{customer}",409,data={"display_name":"Stale edit","revision":0})
assert admin(f"/customers/{customer}")["display_name"]=="Test shop"
assert admin("/projects/raschet/desk?q=Test%20shop")[0]["id"]==sid
assert admin("/projects/raschet/revenue?days=7")["confirmed_kopecks"]>=79900
assert [p["id"] for p in admin(f"/subscriptions/{sid}/payments")]==[paid["id"]]
admin("/projects/raschet/revenue?days=8",400)
assert any(s["id"]==sid for s in admin("/subscriptions"))
# Projects are created at runtime, with independent subscriptions and explicit prices.
projects=admin("/projects")
raschet=next(p for p in projects if p["code"]=="raschet")
assert raschet["display_name"]=="Расчёт" and raschet["release_available"]
assert raschet["active_subscriptions"]>=1 and raschet["confirmed_kopecks"]>=79900
code="test_"+uuid4().hex[:12]
project={"code":code,"display_name":"Тестовый проект","package_name":"dev.ventry."+code}
expect(ADMIN,"/api/v1/projects",401,data=project)
assert admin("/projects",data=project)==admin("/projects",data=project)
admin("/projects",409,data={**project,"display_name":"Другое имя"})
admin("/projects",409,data={**project,"code":code+"x"})
admin("/projects",400,data={**project,"code":"../../escape"})
admin("/projects",400,data={**project,"code":code+"z","package_name":"wrong"})
assert admin(f"/projects/{code}/plans")==[]
admin(f"/projects/{uid()}/plans",400)
admin("/projects/unknown_project/plans",404)
plan={"code":"month","amount_kopecks":12300}
assert admin(f"/projects/{code}/plans",data=plan)==admin(f"/projects/{code}/plans",data=plan)
admin(f"/projects/{code}/plans",409,data={**plan,"amount_kopecks":29900})
admin(f"/projects/{code}/plans",400,data={"code":"trial","amount_kopecks":1})
admin("/projects/raschet/plans",409,data={"code":"month","amount_kopecks":12300})
other=uid()
admin("/subscriptions",data={"id":other,"customer_id":customer,"product":code})
assert [row["id"] for row in admin("/subscriptions?product="+code)]==[other]
assert all(row["product_code"]=="raschet" for row in admin("/subscriptions?product=raschet"))
admin(f"/subscriptions/{other}/grant",409,data={"event_id":uid(),"plan":"month","confirmed_kopecks":29900,"confirmed":True})
admin(f"/subscriptions/{other}/grant",data={"event_id":uid(),"plan":"month","confirmed_kopecks":12300,"confirmed":True})
admin(f"/subscriptions/{other}/installation",data={"event_id":uid(),"old_installation":None,"new_installation":new_device})
admin(f"/subscriptions/{other}/download",409,data={"event_id":uid()})
project_row=next(p for p in admin("/projects") if p["code"]==code)
assert not project_row["release_available"] and project_row["active_subscriptions"]==1
assert project_row["confirmed_kopecks"]==12300 and project_row["enabled_plans"]==1
assert next(p for p in admin("/projects/raschet/plans") if p["code"]=="month")["amount_kopecks"]==29900
print("DELIVERY_PROJECT_ISOLATION_AND_RUNTIME_CATALOG_PASS")
print("DELIVERY_HTTP_REAL_APK_AND_CONCURRENT_REDEEM_PASS")
