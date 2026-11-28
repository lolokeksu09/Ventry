package main
import("bytes";"io";"net/http";"net/http/httptest";"net/url";"strings";"sync/atomic";"testing")
func TestCloudBoundary(t *testing.T){
 var calls atomic.Int32
 upstream:=httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  calls.Add(1)
  if r.Header.Get(sourceHeader)!="" {t.Error("source leaked")}
  data,err:=io.ReadAll(r.Body);if err!=nil{t.Error(err)}
  if strings.HasSuffix(r.URL.Path,"/put") && len(data)!=cloudMax {t.Error("truncated upload")}
  w.WriteHeader(200)
 }))
 defer upstream.Close();u,_:=url.Parse(upstream.URL)
 enabled:=newGatewayWithCloud(u,upstream.Client().Transport,true)
 disabled:=newGateway(u,upstream.Client().Transport)
 test:=func(handler http.Handler,method,path,auth string,b []byte,chunked bool,expected int){
  r:=httptest.NewRequest(method,path,bytes.NewReader(b))
  r.Header.Set(sourceHeader,"192.0.2.1");r.Header.Set("Authorization",auth);r.Header.Set("Content-Type","application/octet-stream")
  if chunked{r.ContentLength=-1;r.TransferEncoding=[]string{"chunked"}}
  w:=httptest.NewRecorder();handler.ServeHTTP(w,r)
  if w.Code!=expected{t.Fatalf("%s got %d expected %d",path,w.Code,expected)}
 }
 token:="Bearer "+strings.Repeat("a",64)
 test(disabled,"POST","/api/v1/backups/list",token,nil,false,404)
 test(enabled,"POST","/api/v1/backups/list","",nil,false,404)
 test(enabled,"GET","/api/v1/backups/list",token,nil,false,404)
 for _,p:=range []string{"/api/v1/backups/0/put","/api/v1/backups/4/read","/api/v1/backups/1/put?x=1","/api/v1/backups/%31/read","/api/v1/backups/1/read/"}{test(enabled,"POST",p,token,nil,false,404)}
 test(enabled,"POST","/api/v1/backups/list",token,[]byte("x"),false,400)
 test(enabled,"POST","/api/v1/backups/1/put",token,make([]byte,cloudMax+1),false,413)
 test(enabled,"POST","/api/v1/backups/1/put",token,make([]byte,49),true,400)
 if calls.Load()!=0{t.Fatal("rejected request reached upstream")}
 test(enabled,"POST","/api/v1/backups/list",token,nil,false,200)
 test(enabled,"POST","/api/v1/backups/1/read",token,nil,false,200)
 test(enabled,"POST","/api/v1/backups/3/put",token,make([]byte,cloudMax),false,200)
 if calls.Load()!=3{t.Fatal(calls.Load())}
}
