#!/usr/bin/env python3
"""Fresh service process: master is login-only, session authentication is revocable."""
import json,os,urllib.request,urllib.error
from pathlib import Path
KEY=Path(os.environ["DELIVERY_ADMIN_TOKEN_FILE"]).read_text().strip()
def call(port,path,token,body=None,expected=200):
    req=urllib.request.Request(f"http://127.0.0.1:{port}/api/v1"+path,
      data=None if body is None else body,
      headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=10) as r: status=r.status;value=json.load(r)
    except urllib.error.HTTPError as e: status=e.code;value=json.load(e)
    assert status==expected,(path,status,expected)
    return value
call(18081,"/projects",KEY,expected=401)
call(18082,"/session",KEY,b"{}",404)
call(18081,"/session","00"*32,b"x"*5000,401)
call(18081,"/session",KEY,b"x"*5000,400)
s=call(18081,"/session",KEY,b"{}")
token=s["session_token"]
assert len(token)==64 and token!=KEY and s["expires_in_seconds"]==900
assert call(18081,"/projects",token)
call(18081,"/session",token,b"{}",401)
call(18082,"/projects",token,expected=404)
assert call(18081,"/session/logout",token,b"{}")["revoked"]
call(18081,"/projects",token,expected=401)
print("DELIVERY_ADMIN_SESSION_ONLY_LOGIN_AND_REVOKE_PASS")
