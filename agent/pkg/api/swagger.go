package api

import (
	_ "embed"
	"net/http"
)

//go:embed swagger-ui.html
var SwaggerUIHTML []byte

func (a *API) handleSwaggerUI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com; font-src https://unpkg.com; img-src 'self' data:;")
	w.Write(SwaggerUIHTML)
}

func (a *API) handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// The openapi.yaml will be read from the binary if embedded, or from disk.
	// For simplicity in Sentinel (standalone), we will embed it as well.
	w.Write(OpenAPIYAML)
}
