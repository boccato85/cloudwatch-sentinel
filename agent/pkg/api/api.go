package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strconv"
	"sync"
	"time"

	"sentinel-agent/pkg/incidents"

	"golang.org/x/time/rate"
)

type NodeInfo struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type PodAlert struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type ClusterSummary struct {
	Nodes          []NodeInfo     `json:"nodes"`
	PodsByPhase    map[string]int `json:"podsByPhase"`
	FailedPods     []PodAlert     `json:"failedPods"`
	PendingPods    []PodAlert     `json:"pendingPods"`
	CpuAllocatable int64          `json:"cpuAllocatable"`
	CpuRequested   int64          `json:"cpuRequested"`
	MemAllocatable int64          `json:"memAllocatable"`
	MemRequested   int64          `json:"memRequested"`
	Efficiency     float64        `json:"efficiency"`
}

type HistoryPoint struct {
	Time    string  `json:"time"`
	ReqCost float64 `json:"reqCost"`
	UseCost float64 `json:"useCost"`
}

type PodStats struct {
	Name                string  `json:"name"`
	Namespace           string  `json:"namespace"`
	AppLabel            string  `json:"appLabel"`
	CPUUsage            int64   `json:"cpuUsage"`
	CPURequest          int64   `json:"cpuRequest"`
	CPULimit            int64   `json:"cpuLimit"`
	CPURequestPresent   bool    `json:"cpuRequestPresent"`
	MemUsage            int64   `json:"memUsage"`
	MemRequest          int64   `json:"memRequest"`
	MemLimit            int64   `json:"memLimit"`
	PotentialSavingMCpu *int64  `json:"potentialSavingMCpu,omitempty"`
	Opportunity         string  `json:"opportunity,omitempty"`
	Severity            string  `json:"severity,omitempty"`
	WastePct            float64 `json:"wastePct,omitempty"`
}

type WasteEntry struct {
	Name                string  `json:"name"`
	Namespace           string  `json:"namespace"`
	AppLabel            string  `json:"appLabel"`
	CPUUsage            int64   `json:"cpuUsage"`
	CPURequest          int64   `json:"cpuRequest"`
	MemUsage            int64   `json:"memUsage"`
	MemRequest          int64   `json:"memRequest"`
	PotentialSavingMCpu int64   `json:"potentialSavingMCpu"`
	WastePct            float64 `json:"wastePct"`
	Severity            string  `json:"severity"`
	Opportunity         string  `json:"opportunity"`
	IsSystem            bool    `json:"isSystem"`
}

type WasteResponse struct {
	TotalSavingMCpu int64                     `json:"totalSavingMCpu"`
	TotalSavingUSD  float64                   `json:"totalSavingUSD"`
	WastedPods      int                       `json:"wastedPods"`
	Entries         []WasteEntry              `json:"entries"`
	ByNamespace     map[string]NamespaceWaste `json:"byNamespace"`
}

type NamespaceWaste struct {
	SavingMCpu int64 `json:"savingMCpu"`
	WastedPods int   `json:"wastedPods"`
}

var SystemNamespaces = map[string]bool{
	"kube-system":          true,
	"kube-public":          true,
	"kube-node-lease":      true,
	"kubernetes-dashboard": true,
	"cert-manager":         true,
	"monitoring":           true,
	"logging":              true,
	"ingress-nginx":        true,
	"istio-system":         true,
}

type NamespaceEfficiency struct {
	Namespace  string  `json:"namespace"`
	PodCount   int     `json:"podCount"`
	CPUUsage   int64   `json:"cpuUsage"`
	CPURequest int64   `json:"cpuRequest"`
	CPUScore   float64 `json:"cpuScore"`
	MemUsage   int64   `json:"memUsage"`
	MemRequest int64   `json:"memRequest"`
	MemScore   float64 `json:"memScore"`
	Score      float64 `json:"score"`
	Grade      string  `json:"grade"`
	Unmanaged  bool    `json:"unmanaged"`
	IsSystem   bool    `json:"isSystem"`
}

type WorkloadInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Kind      string `json:"kind"`
	Desired   int32  `json:"desired"`
	Ready     int32  `json:"ready"`
	Available int32  `json:"available"`
	Image     string `json:"image"`
	Age       string `json:"age"`
}

type PodInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Phase     string `json:"phase"`
	Ready     string `json:"ready"`
	Restarts  int32  `json:"restarts"`
	Node      string `json:"node"`
	Age       string `json:"age"`
}

type HealthStatus struct {
	Status    string `json:"status"`
	LatencyMs *int64 `json:"latency_ms,omitempty"`
	Message   string `json:"message,omitempty"`
}

type HealthResponse struct {
	Status  string                  `json:"status"`
	Version string                  `json:"version"`
	Checks  map[string]HealthStatus `json:"checks"`
}

type ForecastPoint struct {
	Time    string  `json:"time"`
	ReqCost float64 `json:"reqCost"`
	UseCost float64 `json:"useCost"`
	ReqLow  float64 `json:"reqLow"`
	ReqHigh float64 `json:"reqHigh"`
	UseHow  float64 `json:"useLow"`
	UseHigh float64 `json:"useHigh"`
}

type Incident struct {
	PodName   string `json:"podName"`
	Namespace string `json:"namespace"`
	Type      string `json:"type"`
	Severity  string `json:"severity"`
	Message   string `json:"message"`
	Age       string `json:"age"`
	IsWaste   bool   `json:"isWaste"`
}

type API struct {
	AgentVersion            string
	CollectorStaleThreshold time.Duration
	USDPerVcpuHour          float64
	Thresholds              incidents.Thresholds

	GetLatestStats     func() ([]PodStats, ClusterSummary)
	GetLastCollectTime func() time.Time

	IconPNG       []byte
	DashboardHTML []byte
	DashboardCSS  []byte
	DashboardJS   []byte
	StatusHTML    []byte
	IconETag      string
}

func min100(v float64) float64 {
	if v > 100 {
		return 100
	}
	if v < 0 {
		return 0
	}
	return v
}

func humanAge(t time.Time) string {
	d := time.Since(t)
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}

func splitPath(path, prefix string) []string {
	remainder := path[len(prefix):]
	var parts []string
	cur := ""
	for _, ch := range remainder {
		if ch == '/' {
			if cur != "" {
				parts = append(parts, cur)
				cur = ""
			}
		} else {
			cur += string(ch)
		}
	}
	if cur != "" {
		parts = append(parts, cur)
	}
	return parts
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
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
		host := r.RemoteAddr
		if idx := len(host) - 1; idx >= 0 {
			for i := idx; i >= 0; i-- {
				if host[i] == ':' {
					return host[:i]
				}
			}
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
