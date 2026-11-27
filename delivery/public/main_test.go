package main

import (
 "bytes"
 "io"
 "net/http"
 "net/http/httptest"
 "net/netip"
 "net/url"
 "strings"
 "sync/atomic"
 "testing"
 "time"
)
func TestBoundary(t *testing.T){
 var calls atomic.Int32
 upstream:=httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  calls.Add(1)
  if r.Header.Get(sourceHeader)!="" || r.Header.Get("X-Forwarded-For")!="" || r.Header.Get("Cookie")!="" {t.Error("untrusted header forwarded")}
  if r.URL.Path=="/api/v1/activate" && r.Header.Get("Authorization")!="Bearer synthetic" {t.Error("credential lost")}
  w.WriteHeader(200); _,_=io.WriteString(w,"ok")
 }))
 defer upstream.Close()
 u,_:=url.Parse(upstream.URL)
 g:=newGateway(u,upstream.Client().Transport)
 check:=func(method,path,source string,body io.Reader,status int){
  r:=httptest.NewRequest(method,path,body)
  if source!=""{r.Header.Set(sourceHeader,source)}
  r.Header.Set("X-Forwarded-For","spoof");r.Header.Set("Cookie","secret");r.Header.Set("Authorization","Bearer synthetic")
  w:=httptest.NewRecorder();g.ServeHTTP(w,r)
  if w.Code!=status{t.Fatalf("%s %s: got %d expected %d",method,path,w.Code,status)}
 }
 for _,p:=range []string{"/","/admin.js","/api/v1/session","/api/v1/projects","/api/v1/customers/x","/api/v1/subscriptions/x/grant","/api/v1/%61ctivate","/api/v1/activate?token=x","/api/v1/activate/"}{check("POST",p,"192.0.2.1",nil,404)}
 check("GET","/api/v1/activate","192.0.2.1",nil,404)
 check("POST","/api/v1/activate","",nil,400)
 check("POST","/api/v1/activate","192.0.2.1, 192.0.2.2",nil,400)
 check("POST","/api/v1/activate","192.0.2.1",strings.NewReader(strings.Repeat("x",2049)),413)
 r:=httptest.NewRequest("POST","/api/v1/activate",io.NopCloser(bytes.NewReader(make([]byte,2049))))
 r.ContentLength=-1;r.Header.Set(sourceHeader,"192.0.2.1")
 w:=httptest.NewRecorder();g.ServeHTTP(w,r);if w.Code!=413{t.Fatal(w.Code)}
 check("POST","/api/v1/download","192.0.2.1",strings.NewReader("x"),400)
 if calls.Load()!=0{t.Fatal("rejected request reached upstream")}
 check("POST","/api/v1/activate","192.0.2.1",strings.NewReader("{}"),200)
 check("GET","/download","192.0.2.1",nil,200)
 check("POST","/api/v1/download","192.0.2.1",nil,200)
 check("POST","/api/v1/entitlement","192.0.2.1",strings.NewReader("{}"),200)
 if calls.Load()!=4{t.Fatal(calls.Load())}
}
func TestQuota(t *testing.T){
 now:=time.Now();l:=&limiter{entries:make(map[netip.Addr]quota),now:func()time.Time{return now}}
 a:=netip.MustParseAddr("2001:db8::1");b:=netip.MustParseAddr("2001:db8::2")
 if !l.allow(a,1)||l.allow(b,1){t.Fatal("IPv6 prefix quota bypass")}
 if !l.allow(netip.MustParseAddr("192.0.2.1"),1){t.Fatal("independent source blocked")}
 now=now.Add(time.Minute)
 if !l.allow(b,1){t.Fatal("quota failed to recover")}
 for i:=0;i<maxSources;i++{l.entries[netip.AddrFrom4([4]byte{10,byte(i>>16),byte(i>>8),byte(i)})]=quota{start:now}}
 if l.allow(netip.MustParseAddr("192.0.2.3"),1){t.Fatal("capacity not bounded")}
}
