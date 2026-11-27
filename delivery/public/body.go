package main

import ("bytes";"io";"net/http")
func readBody(r *http.Request)([]byte,error){defer r.Body.Close();return io.ReadAll(r.Body)}
func makeBody(data []byte)io.ReadCloser{return io.NopCloser(bytes.NewReader(data))}
