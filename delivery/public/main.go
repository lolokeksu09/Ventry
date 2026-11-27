package main

import (
 "context"
 "crypto/tls"
 "crypto/x509"
 "encoding/json"
 "errors"
 "fmt"
 "log"
 "net"
 "net/http"
 "net/http/httputil"
 "net/netip"
 "net/url"
 "os"
 "strings"
 "sync"
 "time"
)

const sourceHeader = "X-Ventry-Client-IP"
const maxSources = 4096
type quota struct { start time.Time; used int }
type limiter struct {
 mu sync.Mutex
 entries map[netip.Addr]quota
 now func() time.Time
}
func (l *limiter) allow(ip netip.Addr, limit int) bool {
 l.mu.Lock(); defer l.mu.Unlock()
 now := l.now()
 // Bound memory even under rotating client addresses. Normalize IPv6 to /64.
 if ip.Is4In6() { ip=ip.Unmap() }
 if ip.Is6() { ip=netip.PrefixFrom(ip,64).Masked().Addr() }
 q,exists:=l.entries[ip]
 if !exists && len(l.entries)>=maxSources {
  for k,v:=range l.entries { if now.Sub(v.start)>=time.Minute { delete(l.entries,k) } }
  if len(l.entries)>=maxSources { return false }
 }
 if !exists || now.Sub(q.start)>=time.Minute { q=quota{start:now} }
 if q.used>=limit { return false }
 q.used++; l.entries[ip]=q
 return true
}
func reject(w http.ResponseWriter, status int, code string) {
 w.Header().Set("Content-Type","application/json")
 w.Header().Set("Cache-Control","no-store")
 w.Header().Set("Referrer-Policy","no-referrer")
 w.Header().Set("X-Content-Type-Options","nosniff")
 if status==429 { w.Header().Set("Retry-After","60") }
 w.WriteHeader(status)
 _=json.NewEncoder(w).Encode(map[string]string{"error":code})
}
func permitted(r *http.Request) bool {
 // Reject alternative encodings, paths, query strings and absolute request targets.
 if r.URL.RawPath!="" || r.URL.RawQuery!="" || r.URL.ForceQuery || r.URL.IsAbs() { return false }
 switch r.URL.Path {
 case "/download","/download.js","/style.css":
  return r.Method=="GET" || r.Method=="HEAD"
 case "/api/v1/download","/api/v1/activate","/api/v1/entitlement":
  return r.Method=="POST"
 }
 return false
}
func newGateway(upstream *url.URL, transport http.RoundTripper) http.Handler {
 limits:=&limiter{entries:make(map[netip.Addr]quota),now:time.Now}
 slots:=make(chan struct{},16)
 proxy:=&httputil.ReverseProxy{
  Transport:transport,
  Rewrite:func(p *httputil.ProxyRequest){
   p.SetURL(upstream)
   // No caller-supplied forwarding or cookies reach the private upstream.
   for _,k:=range []string{sourceHeader,"Forwarded","X-Forwarded-For","X-Forwarded-Host","X-Forwarded-Proto","Cookie","Origin","Referer","Upgrade"} { p.Out.Header.Del(k) }
  },
  ErrorHandler:func(w http.ResponseWriter,r *http.Request,e error){ reject(w,502,"delivery_unavailable") },
  // Do not log request targets, authorization, refresh secrets or upstream error details.
  ErrorLog:log.New(discardWriter{},"",0),
 }
 return http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  if !permitted(r) { reject(w,404,"not_found"); return }
  if r.Header.Get("Upgrade")!="" || r.Header.Get("Connection")!="" && strings.Contains(strings.ToLower(r.Header.Get("Connection")),"upgrade") {
   reject(w,400,"invalid_request");return
  }
  values:=r.Header.Values(sourceHeader)
  if len(values)!=1 { reject(w,400,"invalid_source");return }
  ip,err:=netip.ParseAddr(values[0])
  if err!=nil || ip.Zone()!="" || ip.IsUnspecified() || ip.IsMulticast() { reject(w,400,"invalid_source");return }
  if !limits.allow(ip,30) { reject(w,429,"try_later");return }
  if r.ContentLength>2048 { reject(w,413,"body_too_large");return }
  // Buffer only the bounded request before forwarding: oversized chunked bodies never
  // reach activation/consumption handlers. No GET/HEAD body or download POST body.
  if r.Method!="POST" || r.URL.Path=="/api/v1/download" {
   if r.ContentLength!=0 || len(r.TransferEncoding)>0 { reject(w,400,"unexpected_body");return }
  } else {
   r.Body=http.MaxBytesReader(w,r.Body,2048)
   data,err:=readBody(r)
   if err!=nil { var tooLarge *http.MaxBytesError; if errors.As(err,&tooLarge){reject(w,413,"body_too_large")}else{reject(w,400,"invalid_request")};return }
   r.Body=makeBody(data); r.ContentLength=int64(len(data)); r.TransferEncoding=nil
  }
  select { case slots<-struct{}{}: defer func(){<-slots}(); default:reject(w,503,"busy");return }
  ctx,cancel:=context.WithTimeout(r.Context(),30*time.Second);defer cancel()
  proxy.ServeHTTP(w,r.WithContext(ctx))
 })
}
type discardWriter struct{}
func(discardWriter)Write(p []byte)(int,error){return len(p),nil}
func main(){
 u,err:=url.Parse(os.Getenv("VENTRY_UPSTREAM"))
 if err!=nil || u.Scheme!="https" || u.Hostname()!="db" || u.Port()!="18444" || u.Path!="" || u.RawQuery!="" || u.Fragment!="" || u.User!=nil {log.Fatal("invalid upstream")}
 name:=os.Getenv("VENTRY_UPSTREAM_TLS_NAME")
 if ip,err:=netip.ParseAddr(name);err!=nil || !(ip.IsPrivate() || ip.IsLoopback()) {log.Fatal("invalid private TLS identity")}
 ca,err:=os.ReadFile("/run/delivery/ca.pem"); if err!=nil {log.Fatal("CA unavailable")}
 roots:=x509.NewCertPool();if !roots.AppendCertsFromPEM(ca){log.Fatal("invalid CA")}
 transport:=&http.Transport{
  Proxy:nil,TLSClientConfig:&tls.Config{RootCAs:roots,ServerName:name,MinVersion:tls.VersionTLS12},
  DialContext:(&net.Dialer{Timeout:3*time.Second}).DialContext,
  TLSHandshakeTimeout:5*time.Second,ResponseHeaderTimeout:12*time.Second,
  MaxConnsPerHost:16,MaxIdleConnsPerHost:8,IdleConnTimeout:30*time.Second,
  DisableCompression:true,
 }
 srv:=&http.Server{Addr:":18090",Handler:newGateway(u,transport),ReadHeaderTimeout:5*time.Second,
  ReadTimeout:10*time.Second,WriteTimeout:35*time.Second,IdleTimeout:20*time.Second,MaxHeaderBytes:8192,
  ErrorLog:log.New(discardWriter{},"",0)}
 fmt.Println("Ventry public gateway ready")
 if err:=srv.ListenAndServe();err!=nil && !errors.Is(err,http.ErrServerClosed){log.Fatal("gateway stopped")}
}
