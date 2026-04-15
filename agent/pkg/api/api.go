package api

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strconv"
	"sync"
	"time"

	"sentinel-agent/pkg/incidents"

	"golang.org/x/time/rate"
)

type API struct {
	AgentVersion            string
	CollectorStaleThreshold time.Duration
	USDPerVcpuHour          float64
	Thresholds              incidents.Thresholds
	AuthEnabled             bool
	AuthToken               string

	GetLatestStats     func() ([]PodStats, ClusterSummary)
	GetLastCollectTime func() time.Time

	IconPNG       []byte
	DashboardHTML []byte
	DashboardCSS  []byte
	DashboardJS   []byte
	StatusHTML    []byte
	IconETag      string
}

func WithMiddleware(handler http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	wrapped := handler
	for i := len(middlewares) - 1; i >= 0; i-- {
		wrapped = middlewares[i](wrapped)
	}
	return wrapped
}

func RecoverMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered",
					"component", "http",
					"request_id", r.Header.Get("X-Request-ID"),
					"method", r.Method,
					"path", r.URL.Path,
					"panic", rec,
					"stack", string(debug.Stack()))
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.Header().Set("X-Frame-Options", "DENY")
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func RequestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := strconv.FormatInt(time.Now().UnixNano(), 36)
		w.Header().Set("X-Request-ID", requestID)
		r.Header.Set("X-Request-ID", requestID)
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(rec, r)
		slog.Info("http request", "component", "http", "request_id", requestID, "method", r.Method, "path", r.URL.Path, "status", rec.status, "duration", time.Since(start))
	})
}

func RateLimitMiddleware(rps int) func(http.Handler) http.Handler {
	type clientLimiter struct {
		limiter  *rate.Limiter
		lastSeen time.Time
	}
	var mu sync.Mutex
	clients := make(map[string]*clientLimiter)

	go func() {
		for {
			time.Sleep(5 * time.Minute)
			mu.Lock()
			for ip, cl := range clients {
				if time.Since(cl.lastSeen) > 5*time.Minute {
					delete(clients, ip)
				}
			}
			mu.Unlock()
		}
	}()

	getClientIP := func(r *http.Request) string {
		if ip := r.Header.Get("X-Real-IP"); ip != "" {
			return ip
		}
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			return r.RemoteAddr
		}
		return host
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := getClientIP(r)
			mu.Lock()
			cl, ok := clients[ip]
			if !ok {
				cl = &clientLimiter{limiter: rate.NewLimiter(rate.Limit(rps), rps*2)}
				clients[ip] = cl
			}
			cl.lastSeen = time.Now()
			allow := cl.limiter.Allow()
			mu.Unlock()

			if !allow {
				w.Header().Set("X-Content-Type-Options", "nosniff")
				w.Header().Set("Retry-After", "1")
				http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func setSecureHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	setSecureHeaders(w)
	if status >= 500 {
		slog.Error("http error response", "component", "http", "status", status, "message", msg)
	} else {
		slog.Warn("http client error", "component", "http", "status", status, "message", msg)
	}
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": msg}); err != nil {
		slog.Error("failed to encode error response", "component", "http", "status", status, "err", err)
	}
}

func (a *API) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.AuthEnabled {
			next.ServeHTTP(w, r)
			return
		}
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			w.Header().Set("WWW-Authenticate", `Bearer realm="sentinel"`)
			writeJSONError(w, http.StatusUnauthorized, "missing authorization header")
			return
		}
		if authHeader != "Bearer "+a.AuthToken {
			writeJSONError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func linearForecast(vals []float64, n int) (projected []float64, rmse float64) {
	m := len(vals)
	if m < 2 {
		for i := 0; i < n; i++ {
			if m == 1 {
				projected = append(projected, vals[0])
			} else {
				projected = append(projected, 0)
			}
		}
		return projected, 0
	}
	var sumX, sumY, sumXY, sumX2 float64
	fM := float64(m)
	for i, v := range vals {
		x := float64(i)
		sumX += x
		sumY += v
		sumXY += x * v
		sumX2 += x * x
	}
	denom := fM*sumX2 - sumX*sumX
	var a, b float64
	if denom != 0 {
		b = (fM*sumXY - sumX*sumY) / denom
		a = (sumY - b*sumX) / fM
	} else {
		a = sumY / fM
	}
	var sumSq float64
	for i, v := range vals {
		diff := v - (a + b*float64(i))
		sumSq += diff * diff
	}
	rmse = 0
	if m > 1 {
		rmse = sumSq / float64(m)
		if rmse < 0 {
			rmse = 0
		}
		x := rmse
		for k := 0; k < 20; k++ {
			if x == 0 {
				break
			}
			x = (x + rmse/x) / 2
		}
		rmse = x
	}
	for i := 0; i < n; i++ {
		xFut := float64(m + i)
		projected = append(projected, a+b*xFut)
	}
	return projected, rmse
}
