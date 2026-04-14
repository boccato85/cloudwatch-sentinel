package main

import (
	"context"
	"crypto/md5"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
	"golang.org/x/time/rate"
	"gopkg.in/yaml.v2"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
	metricsv "k8s.io/metrics/pkg/client/clientset/versioned"
)

//go:embed static/icon.png
var iconPNG []byte

//go:embed static/dashboard.html
var dashboardHTML []byte

//go:embed static/dashboard.css
var dashboardCSS []byte

//go:embed static/dashboard.js
var dashboardJS []byte

//go:embed static/status.html
var statusHTML []byte

// Pricing defaults — override via env vars for different cloud regions/providers.
var (
	usdPerVcpuHour float64
	usdPerGbHour   float64
)

// Thresholds holds operational thresholds loaded from config/thresholds.yaml.
// All fields have safe defaults so the agent runs even without the config file.
type Thresholds struct {
	CPU struct {
		Warning  float64 `yaml:"warning"`
		Critical float64 `yaml:"critical"`
	} `yaml:"cpu"`
	Memory struct {
		Warning  float64 `yaml:"warning"`
		Critical float64 `yaml:"critical"`
	} `yaml:"memory"`
	Disk struct {
		Warning  float64 `yaml:"warning"`
		Critical float64 `yaml:"critical"`
	} `yaml:"disk"`
	Pods struct {
		PendingWarningMinutes int  `yaml:"pending_warning_minutes"`
		CrashLoopCritical     bool `yaml:"crash_loop_critical"`
	} `yaml:"pods"`
	Waste struct {
		OverprovisionedWarning float64 `yaml:"overprovisioned_warning"`
		MinRequestMCpu         int64   `yaml:"min_request_mcpu"`
	} `yaml:"waste"`
}

// defaultThresholds returns safe operational defaults matching config/thresholds.yaml.
func defaultThresholds() Thresholds {
	var t Thresholds
	t.CPU.Warning = 70
	t.CPU.Critical = 85
	t.Memory.Warning = 75
	t.Memory.Critical = 90
	t.Disk.Warning = 70
	t.Disk.Critical = 85
	t.Pods.PendingWarningMinutes = 5
	t.Pods.CrashLoopCritical = true
	t.Waste.OverprovisionedWarning = 60
	t.Waste.MinRequestMCpu = 5
	return t
}

// loadThresholds reads thresholds from a YAML file.
// If the file does not exist or cannot be parsed, returns safe defaults and logs a warning.
func loadThresholds(path string) Thresholds {
	defaults := defaultThresholds()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			slog.Warn("thresholds file not found, using defaults", "component", "app", "path", path)
		} else {
			slog.Warn("failed to read thresholds file, using defaults", "component", "app", "path", path, "err", err)
		}
		return defaults
	}
	var t Thresholds
	// Seed with defaults so missing fields keep safe values
	t = defaults
	if err := yaml.Unmarshal(data, &t); err != nil {
		slog.Warn("failed to parse thresholds file, using defaults", "component", "app", "path", path, "err", err)
		return defaults
	}
	slog.Info("thresholds loaded", "component", "app", "path", path,
		"cpu_warn", t.CPU.Warning, "cpu_crit", t.CPU.Critical,
		"mem_warn", t.Memory.Warning, "mem_crit", t.Memory.Critical,
		"waste_warn", t.Waste.OverprovisionedWarning, "waste_min_mcpu", t.Waste.MinRequestMCpu,
	)
	return t
}

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
	CPURequestPresent   bool    `json:"cpuRequestPresent"`
	MemUsage            int64   `json:"memUsage"`
	MemRequest          int64   `json:"memRequest"`
	PotentialSavingMCpu *int64  `json:"potentialSavingMCpu,omitempty"`
	Opportunity         string  `json:"opportunity,omitempty"`
	Severity            string  `json:"severity,omitempty"`
	WastePct            float64 `json:"wastePct,omitempty"`
}

// WasteEntry is a ranked waste record for the /api/waste endpoint.
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

// WasteResponse is the response body for GET /api/waste.
type WasteResponse struct {
	TotalSavingMCpu int64                     `json:"totalSavingMCpu"`
	TotalSavingUSD  float64                   `json:"totalSavingUSD"`
	WastedPods      int                       `json:"wastedPods"`
	Entries         []WasteEntry              `json:"entries"`
	ByNamespace     map[string]NamespaceWaste `json:"byNamespace"`
}

// NamespaceWaste aggregates waste for a single namespace.
type NamespaceWaste struct {
	SavingMCpu int64 `json:"savingMCpu"`
	WastedPods int   `json:"wastedPods"`
}

// systemNamespaces are Kubernetes/Minikube internals excluded from efficiency
// scoring by default. They have no resource requests by design and are not
// managed by application teams.
var systemNamespaces = map[string]bool{
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

// NamespaceEfficiency holds the efficiency score for a single namespace.
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
	// Unmanaged is true when no pods in the namespace have resource requests
	// defined. This is a FinOps/SRE policy violation distinct from low efficiency.
	Unmanaged bool `json:"unmanaged"`
	// IsSystem indicates a Kubernetes infrastructure namespace.
	IsSystem bool `json:"isSystem"`
}

// WorkloadInfo represents a Deployment or StatefulSet for the /api/workloads endpoint.
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

// PodInfo represents a pod for the /api/pods endpoint.
type PodInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Phase     string `json:"phase"`
	Ready     string `json:"ready"`
	Restarts  int32  `json:"restarts"`
	Node      string `json:"node"`
	Age       string `json:"age"`
}

// agentVersion is the current version of the Sentinel agent.
const agentVersion = "0.10.15"

// collectorStaleThreshold is how long without a successful collect before
// the health check reports the collector as degraded.
const collectorStaleThreshold = 30 * time.Second

// HealthStatus represents a single health check result.
type HealthStatus struct {
	Status    string `json:"status"`
	LatencyMs *int64 `json:"latency_ms,omitempty"`
	Message   string `json:"message,omitempty"`
}

// HealthResponse is the response body for GET /health.
type HealthResponse struct {
	Status  string                  `json:"status"`
	Version string                  `json:"version"`
	Checks  map[string]HealthStatus `json:"checks"`
}

var (
	latestStats     []PodStats
	latestSummary   ClusterSummary
	statsMutex      sync.Mutex
	db              *sql.DB
	dbTimeout       = 5 * time.Second
	lastCollectTime time.Time
	collectMutex    sync.Mutex
)

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func requireEnv(key string) string {
	value, ok := os.LookupEnv(key)
	if !ok || value == "" {
		slog.Error("required environment variable not set", "component", "app", "var", key)
		os.Exit(1)
	}
	return value
}

func getEnvInt(key string, fallback int) int {
	value, ok := os.LookupEnv(key)
	if !ok || value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		slog.Warn("invalid integer environment variable, using fallback", "component", "app", "var", key, "value", value, "fallback", fallback)
		return fallback
	}
	return parsed
}

func getEnvFloat(key string, fallback float64) float64 {
	value, ok := os.LookupEnv(key)
	if !ok || value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		slog.Warn("invalid float environment variable, using fallback", "component", "app", "var", key, "value", value, "fallback", fallback)
		return fallback
	}
	return parsed
}

// logCollectorError logs a collector-component error consistently.
func logCollectorError(op string, err error) {
	slog.Error("collector error", "component", "collector", "op", op, "err", err)
}

func withDBTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	return context.WithTimeout(parent, dbTimeout)
}

func logSQLError(operation string, err error) {
	if err == nil {
		return
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		slog.Warn("sql context error", "component", "db", "operation", operation, "timeout", dbTimeout.String(), "err", err)
		return
	}
	slog.Warn("sql operation failed", "component", "db", "operation", operation, "err", err)
}

func ensureSchema(ctx context.Context) error {
	// Migration: rename legacy 'timestamp' column to 'recorded_at' if needed
	_, _ = db.ExecContext(ctx, `
		DO $$ BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_name='metrics' AND column_name='timestamp'
			) THEN
				ALTER TABLE metrics RENAME COLUMN timestamp TO recorded_at;
			END IF;
		END $$;
	`)

	schema := `
	-- Raw metrics (retained for RETENTION_RAW_HOURS, default 24h)
	CREATE TABLE IF NOT EXISTS metrics (
		id SERIAL PRIMARY KEY,
		pod_name VARCHAR(255) NOT NULL,
		namespace VARCHAR(255) NOT NULL,
		container_name VARCHAR(255) NOT NULL,
		cpu_usage BIGINT NOT NULL,
		cpu_request BIGINT NOT NULL,
		mem_usage BIGINT NOT NULL,
		mem_request BIGINT NOT NULL,
		opportunity VARCHAR(50),
		recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);
	CREATE INDEX IF NOT EXISTS idx_metrics_recorded_at ON metrics(recorded_at);
	CREATE INDEX IF NOT EXISTS idx_metrics_pod ON metrics(namespace, pod_name);

	-- Hourly aggregates (retained for RETENTION_HOURLY_DAYS, default 30 days)
	CREATE TABLE IF NOT EXISTS metrics_hourly (
		id SERIAL PRIMARY KEY,
		pod_name VARCHAR(255) NOT NULL,
		namespace VARCHAR(255) NOT NULL,
		hour_bucket TIMESTAMP NOT NULL,
		avg_cpu_usage BIGINT NOT NULL,
		max_cpu_usage BIGINT NOT NULL,
		avg_cpu_request BIGINT NOT NULL,
		avg_mem_usage BIGINT NOT NULL,
		max_mem_usage BIGINT NOT NULL,
		avg_mem_request BIGINT NOT NULL,
		sample_count INT NOT NULL,
		UNIQUE(namespace, pod_name, hour_bucket)
	);
	CREATE INDEX IF NOT EXISTS idx_metrics_hourly_bucket ON metrics_hourly(hour_bucket);
	CREATE INDEX IF NOT EXISTS idx_metrics_hourly_pod ON metrics_hourly(namespace, pod_name);

	-- Daily aggregates (retained for RETENTION_DAILY_DAYS, default 365 days)
	CREATE TABLE IF NOT EXISTS metrics_daily (
		id SERIAL PRIMARY KEY,
		pod_name VARCHAR(255) NOT NULL,
		namespace VARCHAR(255) NOT NULL,
		day_bucket DATE NOT NULL,
		avg_cpu_usage BIGINT NOT NULL,
		max_cpu_usage BIGINT NOT NULL,
		avg_cpu_request BIGINT NOT NULL,
		avg_mem_usage BIGINT NOT NULL,
		max_mem_usage BIGINT NOT NULL,
		avg_mem_request BIGINT NOT NULL,
		sample_count INT NOT NULL,
		UNIQUE(namespace, pod_name, day_bucket)
	);
	CREATE INDEX IF NOT EXISTS idx_metrics_daily_bucket ON metrics_daily(day_bucket);
	CREATE INDEX IF NOT EXISTS idx_metrics_daily_pod ON metrics_daily(namespace, pod_name);

	-- Cost history (retained same as daily)
	CREATE TABLE IF NOT EXISTS cost_history (
		id SERIAL PRIMARY KEY,
		recorded_at TIMESTAMP NOT NULL,
		total_cpu_cost DECIMAL(10,4) NOT NULL,
		total_mem_cost DECIMAL(10,4) NOT NULL,
		total_waste_cost DECIMAL(10,4) NOT NULL,
		pod_count INT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_cost_history_recorded_at ON cost_history(recorded_at);
	`
	_, err := db.ExecContext(ctx, schema)
	return err
}

// aggregateHourlyMetrics aggregates raw metrics older than 1 hour into hourly buckets
func aggregateHourlyMetrics(ctx context.Context) error {
	query := `
	INSERT INTO metrics_hourly (pod_name, namespace, hour_bucket, avg_cpu_usage, max_cpu_usage, avg_cpu_request, avg_mem_usage, max_mem_usage, avg_mem_request, sample_count)
	SELECT 
		pod_name,
		namespace,
		date_trunc('hour', recorded_at) as hour_bucket,
		AVG(cpu_usage)::BIGINT as avg_cpu_usage,
		MAX(cpu_usage) as max_cpu_usage,
		AVG(cpu_request)::BIGINT as avg_cpu_request,
		AVG(mem_usage)::BIGINT as avg_mem_usage,
		MAX(mem_usage) as max_mem_usage,
		AVG(mem_request)::BIGINT as avg_mem_request,
		COUNT(*) as sample_count
	FROM metrics
	WHERE recorded_at < date_trunc('hour', NOW())
	GROUP BY pod_name, namespace, date_trunc('hour', recorded_at)
	ON CONFLICT (namespace, pod_name, hour_bucket) DO UPDATE SET
		avg_cpu_usage = EXCLUDED.avg_cpu_usage,
		max_cpu_usage = EXCLUDED.max_cpu_usage,
		avg_cpu_request = EXCLUDED.avg_cpu_request,
		avg_mem_usage = EXCLUDED.avg_mem_usage,
		max_mem_usage = EXCLUDED.max_mem_usage,
		avg_mem_request = EXCLUDED.avg_mem_request,
		sample_count = EXCLUDED.sample_count
	`
	_, err := db.ExecContext(ctx, query)
	return err
}

// aggregateDailyMetrics aggregates hourly metrics older than 1 day into daily buckets
func aggregateDailyMetrics(ctx context.Context) error {
	query := `
	INSERT INTO metrics_daily (pod_name, namespace, day_bucket, avg_cpu_usage, max_cpu_usage, avg_cpu_request, avg_mem_usage, max_mem_usage, avg_mem_request, sample_count)
	SELECT 
		pod_name,
		namespace,
		date_trunc('day', hour_bucket)::DATE as day_bucket,
		AVG(avg_cpu_usage)::BIGINT as avg_cpu_usage,
		MAX(max_cpu_usage) as max_cpu_usage,
		AVG(avg_cpu_request)::BIGINT as avg_cpu_request,
		AVG(avg_mem_usage)::BIGINT as avg_mem_usage,
		MAX(max_mem_usage) as max_mem_usage,
		AVG(avg_mem_request)::BIGINT as avg_mem_request,
		SUM(sample_count) as sample_count
	FROM metrics_hourly
	WHERE hour_bucket < date_trunc('day', NOW())
	GROUP BY pod_name, namespace, date_trunc('day', hour_bucket)
	ON CONFLICT (namespace, pod_name, day_bucket) DO UPDATE SET
		avg_cpu_usage = EXCLUDED.avg_cpu_usage,
		max_cpu_usage = EXCLUDED.max_cpu_usage,
		avg_cpu_request = EXCLUDED.avg_cpu_request,
		avg_mem_usage = EXCLUDED.avg_mem_usage,
		max_mem_usage = EXCLUDED.max_mem_usage,
		avg_mem_request = EXCLUDED.avg_mem_request,
		sample_count = EXCLUDED.sample_count
	`
	_, err := db.ExecContext(ctx, query)
	return err
}

// cleanupOldMetrics removes metrics older than the configured retention periods
func cleanupOldMetrics(ctx context.Context, rawHours, hourlyDays, dailyDays int) (int64, int64, int64, error) {
	var rawDeleted, hourlyDeleted, dailyDeleted int64

	// Delete raw metrics older than retention period (keep only last hour for aggregation)
	res, err := db.ExecContext(ctx, `DELETE FROM metrics WHERE recorded_at < NOW() - INTERVAL '1 hour' * $1`, rawHours)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("cleanup raw metrics: %w", err)
	}
	rawDeleted, _ = res.RowsAffected()

	// Delete hourly aggregates older than retention period
	res, err = db.ExecContext(ctx, `DELETE FROM metrics_hourly WHERE hour_bucket < NOW() - INTERVAL '1 day' * $1`, hourlyDays)
	if err != nil {
		return rawDeleted, 0, 0, fmt.Errorf("cleanup hourly metrics: %w", err)
	}
	hourlyDeleted, _ = res.RowsAffected()

	// Delete daily aggregates older than retention period
	res, err = db.ExecContext(ctx, `DELETE FROM metrics_daily WHERE day_bucket < NOW() - INTERVAL '1 day' * $1`, dailyDays)
	if err != nil {
		return rawDeleted, hourlyDeleted, 0, fmt.Errorf("cleanup daily metrics: %w", err)
	}
	dailyDeleted, _ = res.RowsAffected()

	// Also cleanup old cost history
	_, err = db.ExecContext(ctx, `DELETE FROM cost_history WHERE recorded_at < NOW() - INTERVAL '1 day' * $1`, dailyDays)
	if err != nil {
		return rawDeleted, hourlyDeleted, dailyDeleted, fmt.Errorf("cleanup cost history: %w", err)
	}

	return rawDeleted, hourlyDeleted, dailyDeleted, nil
}

// startRetentionWorker runs aggregation and cleanup jobs periodically
func startRetentionWorker(ctx context.Context, rawHours, hourlyDays, dailyDays int) {
	// Run immediately on startup
	runRetentionJobs(rawHours, hourlyDays, dailyDays)

	// Then run every hour
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("retention worker stopped", "component", "retention")
			return
		case <-ticker.C:
			runRetentionJobs(rawHours, hourlyDays, dailyDays)
		}
	}
}

func runRetentionJobs(rawHours, hourlyDays, dailyDays int) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Aggregate hourly
	if err := aggregateHourlyMetrics(ctx); err != nil {
		slog.Warn("hourly aggregation failed", "component", "retention", "err", err)
	} else {
		slog.Debug("hourly aggregation completed", "component", "retention")
	}

	// Aggregate daily
	if err := aggregateDailyMetrics(ctx); err != nil {
		slog.Warn("daily aggregation failed", "component", "retention", "err", err)
	} else {
		slog.Debug("daily aggregation completed", "component", "retention")
	}

	// Cleanup old data
	rawDel, hourlyDel, dailyDel, err := cleanupOldMetrics(ctx, rawHours, hourlyDays, dailyDays)
	if err != nil {
		slog.Warn("cleanup failed", "component", "retention", "err", err)
	} else if rawDel > 0 || hourlyDel > 0 || dailyDel > 0 {
		slog.Info("retention cleanup completed", "component", "retention", "raw_deleted", rawDel, "hourly_deleted", hourlyDel, "daily_deleted", dailyDel)
	}
}

// humanAge returns a short human-readable duration since t (e.g. "2d", "3h", "5m").
// min100 clamps a float64 to the range [0, 100].
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

// splitPath splits the remainder of path after stripping prefix into parts.
// e.g. splitPath("/api/pods/sentinel/mypod/logs", "/api/pods/") → ["sentinel","mypod","logs"]
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

func getPodRequest(podRequestMap map[string]map[string]int64, namespace, name string) (int64, bool) {
	nsReqs, nsFound := podRequestMap[namespace]
	if !nsFound {
		return 0, false
	}
	req, reqFound := nsReqs[name]
	return req, reqFound
}

// applyWasteAnalysis evaluates whether a pod is overprovisioned based on the
// configured thresholds and populates PotentialSavingMCpu, Opportunity, Severity and WastePct.
// A pod is considered overprovisioned when:
//   - it has a CPU request set
//   - the request is above the minimum meaningful threshold (min_request_mcpu)
//   - actual usage is below (100 - overprovisioned_warning)% of the request
//
// Example with overprovisioned_warning=60: a pod using less than 40% of its
// request is flagged, and the saving is (request - usage).
//
// Severity levels:
//   - "warning"  : waste >= OverprovisionedWarning%
//   - "critical" : waste >= (OverprovisionedWarning + 20)%  [hardcoded escalation band]
func applyWasteAnalysis(stat PodStats, t Thresholds) PodStats {
	if !stat.CPURequestPresent {
		return stat
	}
	if stat.CPURequest <= t.Waste.MinRequestMCpu {
		return stat
	}
	usageThreshold := int64(float64(stat.CPURequest) * (1.0 - t.Waste.OverprovisionedWarning/100.0))
	if stat.CPUUsage < usageThreshold {
		saving := stat.CPURequest - stat.CPUUsage
		stat.PotentialSavingMCpu = &saving
		stat.Opportunity = fmt.Sprintf("-%dm", saving)
		stat.WastePct = (float64(saving) / float64(stat.CPURequest)) * 100.0

		criticalThreshold := t.Waste.OverprovisionedWarning + 20.0
		if stat.WastePct >= criticalThreshold {
			stat.Severity = "critical"
		} else {
			stat.Severity = "warning"
		}
	}
	return stat
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

func withMiddleware(handler http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	wrapped := handler
	for i := len(middlewares) - 1; i >= 0; i-- {
		wrapped = middlewares[i](wrapped)
	}
	return wrapped
}

func recoverMiddleware(next http.Handler) http.Handler {
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

func requestLoggerMiddleware(next http.Handler) http.Handler {
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

// rateLimitMiddleware creates a per-IP rate limiter that allows `rps` requests per second
// with a burst capacity of rps*2. Returns 429 Too Many Requests when exceeded.
// Each client IP gets its own limiter to prevent one client from starving others.
func rateLimitMiddleware(rps int) func(http.Handler) http.Handler {
	type clientLimiter struct {
		limiter  *rate.Limiter
		lastSeen time.Time
	}
	var mu sync.Mutex
	clients := make(map[string]*clientLimiter)

	// Background cleanup: remove limiters not seen in the last 5 minutes.
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
		// Prefer X-Real-IP when behind a trusted proxy; fall back to RemoteAddr.
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

var iconETag string

func init() {
	h := md5.Sum(iconPNG)
	iconETag = `"` + hex.EncodeToString(h[:]) + `"`
}

func main() {
	// Configure structured JSON logging as early as possible.
	// LOG_LEVEL controls verbosity: debug, info (default), warn, error.
	logLevel := slog.LevelInfo
	switch getEnv("LOG_LEVEL", "info") {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
	})))

	// Pricing — configurable via env for different cloud regions/providers.
	usdPerVcpuHour = getEnvFloat("usdPerVcpuHour", 0.04)
	usdPerGbHour = getEnvFloat("USD_PER_GB_HOUR", 0.005)

	dbUser := requireEnv("DB_USER")
	dbPass := requireEnv("DB_PASSWORD")
	dbName := getEnv("DB_NAME", "sentinel_db")
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	// NOTE: Default "disable" is intentional for local dev (Minikube).
	// For production, set DB_SSLMODE=require or verify-full.
	sslMode := getEnv("DB_SSLMODE", "disable")
	dbTimeout = time.Duration(getEnvInt("DB_TIMEOUT_SEC", 5)) * time.Second

	// Load operational thresholds from YAML file.
	// THRESHOLDS_PATH defaults to ../config/thresholds.yaml relative to the binary,
	// but can be overridden via environment variable for Kubernetes deployments.
	thresholdsPath := getEnv("THRESHOLDS_PATH", "../config/thresholds.yaml")
	thresholds := loadThresholds(thresholdsPath)

	// Retention settings
	retentionRawHours := getEnvInt("RETENTION_RAW_HOURS", 24)     // Raw metrics: 24h default
	retentionHourlyDays := getEnvInt("RETENTION_HOURLY_DAYS", 30) // Hourly aggregates: 30 days default
	retentionDailyDays := getEnvInt("RETENTION_DAILY_DAYS", 365)  // Daily aggregates: 1 year default

	if sslMode == "disable" {
		slog.Warn("PostgreSQL SSL is disabled — set DB_SSLMODE=require for production", "component", "db")
	}

	// WARNING: connStr contains plaintext credentials — never pass this variable to slog or any logger.
	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s connect_timeout=10",
		dbHost, dbPort, dbUser, dbPass, dbName, sslMode)

	// Log only non-sensitive connection info.
	slog.Info("connecting to PostgreSQL", "component", "db", "host", dbHost, "port", dbPort, "database", dbName)
	var err error
	db, err = sql.Open("postgres", connStr)
	if err != nil {
		slog.Error("database connection failed", "component", "db", "err", err)
		os.Exit(1)
	}

	// Connection pool hardening
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(1 * time.Minute)

	// Retry connection with exponential backoff
	// This handles cases where PostgreSQL is still starting up
	maxRetries := getEnvInt("DB_CONNECT_RETRIES", 10)
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		pingCtx, pingCancel := withDBTimeout(context.Background())
		lastErr = db.PingContext(pingCtx)
		pingCancel()

		if lastErr == nil {
			slog.Info("database connection established", "component", "db", "attempt", attempt)
			break
		}

		if attempt == maxRetries {
			slog.Error("database ping failed after all retries", "component", "db", "attempts", maxRetries, "err", lastErr)
			os.Exit(1)
		}

		// Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
		backoff := time.Duration(1<<(attempt-1)) * time.Second
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
		slog.Warn("database not ready, retrying...", "component", "db", "attempt", attempt, "maxRetries", maxRetries, "backoff", backoff, "err", lastErr)
		time.Sleep(backoff)
	}

	// Ensure database schema exists
	schemaCtx, schemaCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err = ensureSchema(schemaCtx); err != nil {
		schemaCancel()
		slog.Error("failed to create database schema", "component", "db", "err", err)
		os.Exit(1)
	}
	schemaCancel()
	slog.Info("database schema verified", "component", "db")

	slog.Info("Sentinel Intelligence Engine: Active", "component", "app", "version", agentVersion)
	slog.Info("retention policy", "component", "app", "raw_hours", retentionRawHours, "hourly_days", retentionHourlyDays, "daily_days", retentionDailyDays)

	// Try in-cluster config first (for running in Kubernetes)
	// Fall back to local kubeconfig for development
	var k8sCfg *rest.Config
	k8sCfg, err = rest.InClusterConfig()
	if err != nil {
		slog.Info("not running in cluster, trying local kubeconfig", "component", "k8s")
		home := homedir.HomeDir()
		k8sCfg, err = clientcmd.BuildConfigFromFlags("", filepath.Join(home, ".kube", "config"))
		if err != nil {
			slog.Error("failed to load kubeconfig", "component", "k8s", "err", err)
			os.Exit(1)
		}
	} else {
		slog.Info("using in-cluster Kubernetes config", "component", "k8s")
	}

	var clientset *kubernetes.Clientset
	clientset, err = kubernetes.NewForConfig(k8sCfg)
	if err != nil {
		slog.Error("failed to create k8s client", "component", "k8s", "err", err)
		os.Exit(1)
	}
	metricsClient, err := metricsv.NewForConfig(k8sCfg)
	if err != nil {
		slog.Error("failed to create metrics client", "component", "k8s", "err", err)
		os.Exit(1)
	}

	appCtx, appCancel := context.WithCancel(context.Background())
	defer appCancel()

	// Start retention worker (aggregation + cleanup)
	go startRetentionWorker(appCtx, retentionRawHours, retentionHourlyDays, retentionDailyDays)

	go func() {
		for {
			summary := ClusterSummary{PodsByPhase: make(map[string]int)}
			ctx, cancel := context.WithTimeout(appCtx, 15*time.Second)

			nodes, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
			if err != nil {
				slog.Error("failed to list nodes", "component", "collector", "err", err)
			} else {
				for _, n := range nodes.Items {
					summary.Nodes = append(summary.Nodes, NodeInfo{Name: n.Name, Status: "Running"})
					summary.CpuAllocatable += n.Status.Allocatable.Cpu().MilliValue()
					summary.MemAllocatable += n.Status.Allocatable.Memory().Value() / 1024 / 1024
				}
			}

			pods, err := clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
			podRequestMap    := make(map[string]map[string]int64)
			podMemRequestMap := make(map[string]map[string]int64)
			podAppLabelMap   := make(map[string]map[string]string)
			if err != nil {
				slog.Error("failed to list pods", "component", "collector", "err", err)
			} else {
				for _, p := range pods.Items {
					summary.PodsByPhase[string(p.Status.Phase)]++
					if p.Status.Phase == "Failed" {
						summary.FailedPods = append(summary.FailedPods, PodAlert{p.Name, p.Namespace})
					}
					var totalCPUReq, totalMemReq int64
					for _, c := range p.Spec.Containers {
						cpuR := c.Resources.Requests.Cpu().MilliValue()
						memR := c.Resources.Requests.Memory().Value() / 1024 / 1024
						summary.CpuRequested += cpuR
						summary.MemRequested += memR
						totalCPUReq += cpuR
						totalMemReq += memR
					}
					if podRequestMap[p.Namespace] == nil {
						podRequestMap[p.Namespace] = make(map[string]int64)
					}
					podRequestMap[p.Namespace][p.Name] = totalCPUReq
					if podMemRequestMap[p.Namespace] == nil {
						podMemRequestMap[p.Namespace] = make(map[string]int64)
					}
					podMemRequestMap[p.Namespace][p.Name] = totalMemReq
					if podAppLabelMap[p.Namespace] == nil {
						podAppLabelMap[p.Namespace] = make(map[string]string)
					}
					podAppLabelMap[p.Namespace][p.Name] = p.Labels["app"]
				}
			}

			var newStats []PodStats
			// M5: Retry pod metrics listing up to 3 times with exponential backoff.
			var mListErr error
			mList, mListErr := metricsClient.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
			if mListErr != nil {
				for attempt := 2; attempt <= 3; attempt++ {
					time.Sleep(time.Duration(attempt-1) * time.Second)
					mList, mListErr = metricsClient.MetricsV1beta1().PodMetricses("").List(ctx, metav1.ListOptions{})
					if mListErr == nil {
						break
					}
				}
			}
			if mListErr != nil {
				logCollectorError("list_pod_metrics", mListErr)
			} else {
				func() {
					dbCtx, dbCancel := withDBTimeout(appCtx)
					defer dbCancel()
					tx, err := db.BeginTx(dbCtx, nil)
					if err != nil {
						logSQLError("begin_tx_metrics_insert", err)
						return
					}
					defer func() {
						if rbErr := tx.Rollback(); rbErr != nil && !errors.Is(rbErr, sql.ErrTxDone) {
							slog.Warn("tx rollback failed", "component", "collector", "err", rbErr)
						}
					}()

					for _, m := range mList.Items {
						var podCPU, podMem int64
						for _, c := range m.Containers {
							podCPU += c.Usage.Cpu().MilliValue()
							podMem += c.Usage.Memory().Value() / 1024 / 1024
						}
						req, reqFound := getPodRequest(podRequestMap, m.Namespace, m.Name)
						memReq := int64(0)
						if nsMap, ok := podMemRequestMap[m.Namespace]; ok {
							memReq = nsMap[m.Name]
						}
						appLabel := ""
						if nsMap, ok := podAppLabelMap[m.Namespace]; ok {
							appLabel = nsMap[m.Name]
						}
						pStat := PodStats{
							Name:              m.Name,
							Namespace:         m.Namespace,
							AppLabel:          appLabel,
							CPUUsage:          podCPU,
							CPURequest:        req,
							CPURequestPresent: reqFound,
							MemUsage:          podMem,
							MemRequest:        memReq,
						}
						pStat = applyWasteAnalysis(pStat, thresholds)

						if _, err := tx.ExecContext(dbCtx, `INSERT INTO metrics (pod_name, namespace, container_name, cpu_usage, cpu_request, mem_usage, mem_request, opportunity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
							m.Name, m.Namespace, "all", podCPU, req, podMem, memReq, pStat.Opportunity); err != nil {
							logSQLError("insert_metric", err)
							slog.Warn("insert metric failed", "component", "collector", "pod", m.Name, "namespace", m.Namespace, "err", err)
							continue
						}
						newStats = append(newStats, pStat)
					}

					if err := tx.Commit(); err != nil {
						logSQLError("commit_metrics_insert", err)
						return
					}
				}()
			}
			sort.Slice(newStats, func(i, j int) bool { return newStats[i].CPUUsage > newStats[j].CPUUsage })

			if summary.CpuAllocatable > 0 {
				summary.Efficiency = (float64(summary.CpuRequested) / float64(summary.CpuAllocatable)) * 100
			}

			statsMutex.Lock()
			latestStats = newStats
			latestSummary = summary
			statsMutex.Unlock()

			// Mark successful collect for health check
			collectMutex.Lock()
			lastCollectTime = time.Now()
			collectMutex.Unlock()

			cancel()
			select {
			case <-appCtx.Done():
				return
			case <-time.After(10 * time.Second):
			}
		}
	}()

	setSecureHeaders := func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	}
	writeJSONError := func(w http.ResponseWriter, status int, msg string) {
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

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}

		resp := HealthResponse{
			Status:  "ok",
			Version: agentVersion,
			Checks:  make(map[string]HealthStatus),
		}
		httpStatus := http.StatusOK

		// Check 1: database ping
		dbStart := time.Now()
		pingCtx, pingCancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer pingCancel()
		dbErr := db.PingContext(pingCtx)
		dbLatency := time.Since(dbStart).Milliseconds()
		if dbErr != nil {
			resp.Checks["database"] = HealthStatus{Status: "unhealthy", Message: dbErr.Error()}
			resp.Status = "unhealthy"
			httpStatus = http.StatusServiceUnavailable
		} else {
			resp.Checks["database"] = HealthStatus{Status: "ok", LatencyMs: &dbLatency}
		}

		// Check 2: collector freshness
		collectMutex.Lock()
		last := lastCollectTime
		collectMutex.Unlock()
		if last.IsZero() {
			resp.Checks["collector"] = HealthStatus{Status: "starting", Message: "no collect completed yet"}
			if resp.Status == "ok" {
				resp.Status = "degraded"
				httpStatus = http.StatusServiceUnavailable
			}
		} else {
			ago := time.Since(last)
			agoSec := int64(ago.Seconds())
			if ago > collectorStaleThreshold {
				resp.Checks["collector"] = HealthStatus{
					Status:  "degraded",
					Message: fmt.Sprintf("last collect %ds ago (threshold: %ds)", agoSec, int64(collectorStaleThreshold.Seconds())),
				}
				if resp.Status == "ok" {
					resp.Status = "degraded"
					httpStatus = http.StatusServiceUnavailable
				}
			} else {
				resp.Checks["collector"] = HealthStatus{Status: "ok", LatencyMs: &agoSec}
			}
		}

		setSecureHeaders(w)
		w.WriteHeader(httpStatus)
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("failed to encode health response", "component", "http", "err", err)
		}
	})

	mux.HandleFunc("/static/icon.png", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("If-None-Match") == iconETag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "public, max-age=3600, must-revalidate")
		w.Header().Set("ETag", iconETag)
		w.Write(iconPNG)
	})

	mux.HandleFunc("/api/summary", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)
		statsMutex.Lock()
		defer statsMutex.Unlock()
		if err := json.NewEncoder(w).Encode(latestSummary); err != nil {
			slog.Error("failed to encode summary response", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	})

	mux.HandleFunc("/api/metrics", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)
		statsMutex.Lock()
		defer statsMutex.Unlock()
		if err := json.NewEncoder(w).Encode(latestStats); err != nil {
			slog.Error("failed to encode metrics response", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	})

	mux.HandleFunc("/api/history", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)

		// Parse range parameter — only accepted values below; switch default rejects others.
		// C2: nsClause in fmt.Sprintf only contains fixed SQL fragments ("" or " AND namespace = $N"),
		// never raw user input. Positional args ($N) are computed integers. This is safe, but
		// validated here for defence-in-depth.
		rangeParam := r.URL.Query().Get("range")
		if rangeParam == "" {
			rangeParam = "30m"
		}
		validRanges := map[string]bool{"30m": true, "1h": true, "6h": true, "24h": true, "7d": true, "30d": true, "90d": true, "365d": true, "custom": true}
		if !validRanges[rangeParam] {
			writeJSONError(w, http.StatusBadRequest, "invalid range; valid values: 30m, 1h, 6h, 24h, 7d, 30d, 90d, 365d, custom")
			return
		}

		// Optional namespace filter: adds AND namespace = $2 when provided.
		nsFilter := r.URL.Query().Get("namespace")
		nsClause := ""    // extra WHERE clause fragment
		nsClauseAgg := "" // same but for aggregate tables (column name differs)
		queryArgs := []interface{}{usdPerVcpuHour / 1000.0}
		if nsFilter != "" {
			queryArgs = append(queryArgs, nsFilter)
			nsClause = " AND namespace = $2"
			nsClauseAgg = " AND namespace = $2"
		}

		// Custom range: ?range=custom&from=2006-01-02T15:04&to=2006-01-02T15:04
		if rangeParam == "custom" {
			fromStr := r.URL.Query().Get("from")
			toStr := r.URL.Query().Get("to")
			if fromStr == "" || toStr == "" {
				writeJSONError(w, http.StatusBadRequest, "custom range requires from and to parameters (RFC3339 or 2006-01-02T15:04)")
				return
			}
			// I4: Limit param length to prevent oversized input processing.
			if len(fromStr) > 100 || len(toStr) > 100 {
				writeJSONError(w, http.StatusBadRequest, "from/to parameters exceed maximum length")
				return
			}
			parseTime := func(s string) (time.Time, error) {
				for _, layout := range []string{time.RFC3339, "2006-01-02T15:04", "2006-01-02"} {
					if t, err := time.Parse(layout, s); err == nil {
						return t, nil
					}
				}
				return time.Time{}, fmt.Errorf("unrecognised time format: %q", s)
			}
			fromT, err := parseTime(fromStr)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, "invalid from: "+err.Error())
				return
			}
			toT, err := parseTime(toStr)
			if err != nil {
				writeJSONError(w, http.StatusBadRequest, "invalid to: "+err.Error())
				return
			}
			if !toT.After(fromT) {
				writeJSONError(w, http.StatusBadRequest, "to must be after from")
				return
			}
			duration := toT.Sub(fromT)
			// C4: Limit custom range to 365 days to prevent timeout/OOM.
			if duration > 365*24*time.Hour {
				writeJSONError(w, http.StatusBadRequest, "custom range exceeds maximum of 365 days")
				return
			}

			// Choose table and bucket granularity based on duration
			var customQuery string
			var customFormat string
			fromArg := len(queryArgs) + 1
			toArg := len(queryArgs) + 2
			if nsFilter != "" {
				fromArg = 3
				toArg = 4
				queryArgs = append(queryArgs, fromT, toT)
			} else {
				fromArg = 2
				toArg = 3
				queryArgs = append(queryArgs, fromT, toT)
			}

			switch {
			case duration <= 2*time.Hour:
				// minute buckets from raw metrics
				customQuery = fmt.Sprintf(`
					SELECT date_trunc('minute', recorded_at) AS bucket,
						SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
						SUM((CAST(cpu_usage   AS FLOAT) * $1) / 360.0) AS use
					FROM metrics
					WHERE recorded_at BETWEEN $%d AND $%d%s
					GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClause)
				customFormat = "15:04"
			case duration <= 7*24*time.Hour:
				// hourly buckets from raw metrics
				customQuery = fmt.Sprintf(`
					SELECT date_trunc('hour', recorded_at) AS bucket,
						SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
						SUM((CAST(cpu_usage   AS FLOAT) * $1) / 360.0) AS use
					FROM metrics
					WHERE recorded_at BETWEEN $%d AND $%d%s
					GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClause)
				customFormat = "01/02 15:04"
			case duration <= 90*24*time.Hour:
				// daily buckets from metrics_hourly aggregates
				customQuery = fmt.Sprintf(`
					SELECT date_trunc('day', hour_bucket) AS bucket,
						SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
						SUM((CAST(avg_cpu_usage   AS FLOAT) * $1) / 360.0) AS use
					FROM metrics_hourly
					WHERE hour_bucket BETWEEN $%d AND $%d%s
					GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClauseAgg)
				customFormat = "01/02"
			default:
				// weekly buckets from metrics_daily aggregates
				customQuery = fmt.Sprintf(`
					SELECT date_trunc('week', day_bucket) AS bucket,
						AVG((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
						AVG((CAST(avg_cpu_usage   AS FLOAT) * $1) / 360.0) AS use
					FROM metrics_daily
					WHERE day_bucket BETWEEN $%d AND $%d%s
					GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClauseAgg)
				customFormat = "2006-01-02"
			}

			// I3: Adaptive timeout proportional to the requested range.
			var customTimeout time.Duration
			switch {
			case duration <= 7*24*time.Hour:
				customTimeout = dbTimeout * 3
			case duration <= 90*24*time.Hour:
				customTimeout = dbTimeout * 8
			default:
				customTimeout = dbTimeout * 15
			}
			queryCtx, queryCancel := context.WithTimeout(r.Context(), customTimeout)
			defer queryCancel()
			rows, err := db.QueryContext(queryCtx, customQuery, queryArgs...)
			if err != nil {
				logSQLError("query_history_custom", err)
				writeJSONError(w, http.StatusInternalServerError, "internal server error")
				return
			}
			defer rows.Close()
			var points []HistoryPoint
			for rows.Next() {
				var bucket time.Time
				var reqCost, useCost float64
				if err := rows.Scan(&bucket, &reqCost, &useCost); err != nil {
					writeJSONError(w, http.StatusInternalServerError, "internal server error")
					return
				}
				points = append(points, HistoryPoint{Time: bucket.In(time.Local).Format(customFormat), ReqCost: reqCost, UseCost: useCost})
			}
			if err := rows.Err(); err != nil {
				writeJSONError(w, http.StatusInternalServerError, "internal server error")
				return
			}
			if err := json.NewEncoder(w).Encode(points); err != nil {
				slog.Error("failed to encode custom history response", "component", "http", "err", err)
			}
			return
		}

		var query string
		var timeFormat string
		var timeout time.Duration

		switch rangeParam {
		case "30m":
			query = `
				SELECT date_trunc('minute', recorded_at) AS bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics
				WHERE recorded_at > NOW() - INTERVAL '30 minutes'` + nsClause + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			timeout = dbTimeout
		case "1h":
			query = `
				SELECT date_trunc('minute', recorded_at) AS bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics
				WHERE recorded_at > NOW() - INTERVAL '1 hour'` + nsClause + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			timeout = dbTimeout
		case "6h":
			query = `
				SELECT date_trunc('hour', recorded_at) + 
					INTERVAL '5 min' * (EXTRACT(minute FROM recorded_at)::INT / 5) AS bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics
				WHERE recorded_at > NOW() - INTERVAL '6 hours'` + nsClause + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			timeout = dbTimeout * 2
		case "24h":
			// For the CTE case with namespace filter we need to duplicate the $2 reference
			rawNsClause := ""
			hourlyNsClause := ""
			if nsFilter != "" {
				rawNsClause = " AND namespace = $2"
				hourlyNsClause = " AND namespace = $2"
			}
			query = `
				WITH combined AS (
					SELECT date_trunc('hour', recorded_at) + 
						INTERVAL '15 min' * (EXTRACT(minute FROM recorded_at)::INT / 15) AS bucket,
						cpu_request, cpu_usage
					FROM metrics
					WHERE recorded_at > NOW() - INTERVAL '24 hours'` + rawNsClause + `
					UNION ALL
					SELECT hour_bucket AS bucket, avg_cpu_request AS cpu_request, avg_cpu_usage AS cpu_usage
					FROM metrics_hourly
					WHERE hour_bucket > NOW() - INTERVAL '24 hours'` + hourlyNsClause + `
						AND hour_bucket < (SELECT MIN(recorded_at) FROM metrics)
				)
				SELECT bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM combined
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			timeout = dbTimeout * 3
		case "7d":
			query = `
				SELECT hour_bucket AS bucket,
					SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_hourly
				WHERE hour_bucket > NOW() - INTERVAL '7 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "01/02 15:04"
			timeout = dbTimeout * 3
		case "30d":
			query = `
				SELECT day_bucket AS bucket,
					SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_daily
				WHERE day_bucket > NOW() - INTERVAL '30 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "01/02"
			timeout = dbTimeout * 2
		case "90d":
			query = `
				SELECT day_bucket AS bucket,
					SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_daily
				WHERE day_bucket > NOW() - INTERVAL '90 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "01/02"
			timeout = dbTimeout * 2
		case "365d":
			query = `
				SELECT date_trunc('week', day_bucket) AS bucket,
					AVG((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					AVG((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_daily
				WHERE day_bucket > NOW() - INTERVAL '365 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "2006-01-02"
			timeout = dbTimeout * 3
		default:
			writeJSONError(w, http.StatusBadRequest, "invalid range; valid values: 30m, 1h, 6h, 24h, 7d, 30d, 90d, 365d")
			return
		}

		queryCtx, queryCancel := context.WithTimeout(r.Context(), timeout)
		defer queryCancel()

		rows, err := db.QueryContext(queryCtx, query, queryArgs...)
		if err != nil {
			logSQLError("query_history", err)
			slog.Error("sql query error", "component", "http", "range", rangeParam, "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		defer rows.Close()

		scanPoints := func(r *sql.Rows, fmt string) ([]HistoryPoint, error) {
			var pts []HistoryPoint
			for r.Next() {
				var bucket time.Time
				var req, use float64
				if err := r.Scan(&bucket, &req, &use); err != nil {
					return nil, err
				}
				pts = append(pts, HistoryPoint{
					Time:    bucket.In(time.Local).Format(fmt),
					ReqCost: req,
					UseCost: use,
				})
			}
			return pts, r.Err()
		}

		points, err := scanPoints(rows, timeFormat)
		if err != nil {
			logSQLError("history_rows_iteration", err)
			slog.Error("history row iteration failed", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}

		// Fallback: for long-range presets (30d/90d/365d), if metrics_daily is empty,
		// serve all available data from metrics_hourly so the chart is never blank.
		if len(points) == 0 && (rangeParam == "30d" || rangeParam == "90d" || rangeParam == "365d") {
			fallbackQuery := `
				SELECT hour_bucket AS bucket,
					SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_hourly` + func() string {
				if nsFilter != "" {
					return " WHERE namespace = $2"
				}
				return ""
			}() + `
				GROUP BY bucket ORDER BY bucket ASC`

			fbCtx, fbCancel := context.WithTimeout(r.Context(), timeout)
			defer fbCancel()

			fbRows, fbErr := db.QueryContext(fbCtx, fallbackQuery, queryArgs...)
			if fbErr == nil {
				defer fbRows.Close()
				fbPoints, fbScanErr := scanPoints(fbRows, "01/02 15:04")
				if fbScanErr == nil && len(fbPoints) > 0 {
					slog.Info("history fallback to metrics_hourly", "component", "http", "range", rangeParam, "points", len(fbPoints))
					w.Header().Set("X-Sentinel-Data-Note", "insufficient-daily-data-showing-hourly-fallback")
					points = fbPoints
				}
			}
		}

		if err := json.NewEncoder(w).Encode(points); err != nil {
			slog.Error("failed to encode history response", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	})

	mux.HandleFunc("/api/waste", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)

		statsMutex.Lock()
		snapshot := make([]PodStats, len(latestStats))
		copy(snapshot, latestStats)
		statsMutex.Unlock()

		resp := WasteResponse{
			Entries:     []WasteEntry{},
			ByNamespace: make(map[string]NamespaceWaste),
		}

		for _, s := range snapshot {
			if s.PotentialSavingMCpu == nil {
				continue
			}
			saving := *s.PotentialSavingMCpu
			entry := WasteEntry{
				Name:                s.Name,
				Namespace:           s.Namespace,
				AppLabel:            s.AppLabel,
				CPUUsage:            s.CPUUsage,
				CPURequest:          s.CPURequest,
				MemUsage:            s.MemUsage,
				MemRequest:          s.MemRequest,
				PotentialSavingMCpu: saving,
				WastePct:            s.WastePct,
				Severity:            s.Severity,
				Opportunity:         s.Opportunity,
				IsSystem:            systemNamespaces[s.Namespace],
			}
			resp.Entries = append(resp.Entries, entry)
			resp.TotalSavingMCpu += saving
			resp.WastedPods++

			ns := resp.ByNamespace[s.Namespace]
			ns.SavingMCpu += saving
			ns.WastedPods++
			resp.ByNamespace[s.Namespace] = ns
		}

		// Rank by potential saving descending
		sort.Slice(resp.Entries, func(i, j int) bool {
			return resp.Entries[i].PotentialSavingMCpu > resp.Entries[j].PotentialSavingMCpu
		})

		// USD estimate: milliCPU / 1000 * usdPerVcpuHour (hourly rate)
		resp.TotalSavingUSD = float64(resp.TotalSavingMCpu) / 1000.0 * usdPerVcpuHour

		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("failed to encode waste response", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
		}
	})

	mux.HandleFunc("/api/efficiency", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)

		statsMutex.Lock()
		snapshot := make([]PodStats, len(latestStats))
		copy(snapshot, latestStats)
		statsMutex.Unlock()

		type nsAccum struct {
			cpuUsage   int64
			cpuRequest int64
			memUsage   int64
			memRequest int64
			pods       int
		}
		accum := make(map[string]*nsAccum)
		for _, s := range snapshot {
			a := accum[s.Namespace]
			if a == nil {
				a = &nsAccum{}
				accum[s.Namespace] = a
			}
			a.cpuUsage += s.CPUUsage
			a.cpuRequest += s.CPURequest
			a.memUsage += s.MemUsage
			a.memRequest += s.MemRequest
			a.pods++
		}

		efficiencyGrade := func(score float64) string {
			switch {
			case score >= 75:
				return "A"
			case score >= 50:
				return "B"
			case score >= 30:
				return "C"
			case score >= 15:
				return "D"
			default:
				return "F"
			}
		}

		includeSystem := r.URL.Query().Get("system") == "true"

		all := make([]NamespaceEfficiency, 0, len(accum))
		for ns, a := range accum {
			e := NamespaceEfficiency{
				Namespace:  ns,
				PodCount:   a.pods,
				CPUUsage:   a.cpuUsage,
				CPURequest: a.cpuRequest,
				MemUsage:   a.memUsage,
				MemRequest: a.memRequest,
				IsSystem:   systemNamespaces[ns],
				Unmanaged:  a.cpuRequest == 0 && a.memRequest == 0,
			}
			if a.cpuRequest > 0 {
				e.CPUScore = min100(float64(a.cpuUsage) / float64(a.cpuRequest) * 100)
			}
			if a.memRequest > 0 {
				e.MemScore = min100(float64(a.memUsage) / float64(a.memRequest) * 100)
			}
			switch {
			case a.cpuRequest > 0 && a.memRequest > 0:
				e.Score = (e.CPUScore + e.MemScore) / 2
			case a.cpuRequest > 0:
				e.Score = e.CPUScore
			case a.memRequest > 0:
				e.Score = e.MemScore
			}
			if !e.Unmanaged {
				e.Grade = efficiencyGrade(e.Score)
			}
			all = append(all, e)
		}

		results := make([]NamespaceEfficiency, 0, len(all))
		for _, e := range all {
			if !e.IsSystem || includeSystem {
				results = append(results, e)
			}
		}
		// Sort: unmanaged first (policy violation), then worst score first
		sort.Slice(results, func(i, j int) bool {
			if results[i].Unmanaged != results[j].Unmanaged {
				return results[i].Unmanaged
			}
			return results[i].Score < results[j].Score
		})

		if err := json.NewEncoder(w).Encode(results); err != nil {
			slog.Error("failed to encode efficiency response", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
		}
	})

	mux.HandleFunc("/api/namespaces", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		nsList, err := clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
		if err != nil {
			slog.Error("failed to list namespaces", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		names := make([]string, 0, len(nsList.Items))
		for _, ns := range nsList.Items {
			names = append(names, ns.Name)
		}
		sort.Strings(names)
		if err := json.NewEncoder(w).Encode(names); err != nil {
			slog.Error("failed to encode namespaces response", "component", "http", "err", err)
		}
	})

	mux.HandleFunc("/api/workloads", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)
		ns := r.URL.Query().Get("namespace")
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		var result []WorkloadInfo

		deps, err := clientset.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			slog.Error("failed to list deployments", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		for _, d := range deps.Items {
			img := ""
			if len(d.Spec.Template.Spec.Containers) > 0 {
				img = d.Spec.Template.Spec.Containers[0].Image
			}
			result = append(result, WorkloadInfo{
				Name:      d.Name,
				Namespace: d.Namespace,
				Kind:      "Deployment",
				Desired:   *d.Spec.Replicas,
				Ready:     d.Status.ReadyReplicas,
				Available: d.Status.AvailableReplicas,
				Image:     img,
				Age:       humanAge(d.CreationTimestamp.Time),
			})
		}

		sts, err := clientset.AppsV1().StatefulSets(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			slog.Error("failed to list statefulsets", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		for _, s := range sts.Items {
			img := ""
			if len(s.Spec.Template.Spec.Containers) > 0 {
				img = s.Spec.Template.Spec.Containers[0].Image
			}
			result = append(result, WorkloadInfo{
				Name:      s.Name,
				Namespace: s.Namespace,
				Kind:      "StatefulSet",
				Desired:   *s.Spec.Replicas,
				Ready:     s.Status.ReadyReplicas,
				Available: s.Status.ReadyReplicas,
				Image:     img,
				Age:       humanAge(s.CreationTimestamp.Time),
			})
		}

		if result == nil {
			result = []WorkloadInfo{}
		}
		if err := json.NewEncoder(w).Encode(result); err != nil {
			slog.Error("failed to encode workloads response", "component", "http", "err", err)
		}
	})

	mux.HandleFunc("/api/pods", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)
		ns := r.URL.Query().Get("namespace")
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		pods, err := clientset.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
		if err != nil {
			slog.Error("failed to list pods", "component", "http", "err", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}

		result := make([]PodInfo, 0, len(pods.Items))
		for _, p := range pods.Items {
			var restarts int32
			readyCount := 0
			totalCount := len(p.Spec.Containers)
			for _, cs := range p.Status.ContainerStatuses {
				restarts += cs.RestartCount
				if cs.Ready {
					readyCount++
				}
			}
			result = append(result, PodInfo{
				Name:      p.Name,
				Namespace: p.Namespace,
				Phase:     string(p.Status.Phase),
				Ready:     fmt.Sprintf("%d/%d", readyCount, totalCount),
				Restarts:  restarts,
				Node:      p.Spec.NodeName,
				Age:       humanAge(p.CreationTimestamp.Time),
			})
		}
		if err := json.NewEncoder(w).Encode(result); err != nil {
			slog.Error("failed to encode pods response", "component", "http", "err", err)
		}
	})

	// /api/pods/{namespace}/{name}/logs — tail last 100 lines
	mux.HandleFunc("/api/pods/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		// Expect path: /api/pods/{namespace}/{name}/logs
		parts := splitPath(r.URL.Path, "/api/pods/")
		if len(parts) != 3 || parts[2] != "logs" {
			writeJSONError(w, http.StatusNotFound, "not found")
			return
		}
		ns := parts[0]
		podName := parts[1]

		// I2: Validate namespace and pod name format to prevent unexpected API calls.
		validName := regexp.MustCompile(`^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$`)
		if !validName.MatchString(ns) || !validName.MatchString(podName) {
			writeJSONError(w, http.StatusBadRequest, "invalid namespace or pod name format")
			return
		}

		tailLines := int64(100)
		req := clientset.CoreV1().Pods(ns).GetLogs(podName, &corev1.PodLogOptions{
			TailLines: &tailLines,
		})
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		stream, err := req.Stream(ctx)
		if err != nil {
			slog.Error("failed to get pod logs", "component", "http", "pod", podName, "ns", ns, "err", err)
			writeJSONError(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer stream.Close()
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		buf := make([]byte, 32*1024)
		for {
			n, err := stream.Read(buf)
			if n > 0 {
				if _, werr := w.Write(buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				break
			}
		}
	})

	// ForecastPoint is a single projected cost point returned by /api/forecast.
	type ForecastPoint struct {
		Time    string  `json:"time"`
		ReqCost float64 `json:"reqCost"`
		UseCost float64 `json:"useCost"`
		ReqLow  float64 `json:"reqLow"`
		ReqHigh float64 `json:"reqHigh"`
		UseHow  float64 `json:"useLow"`
		UseHigh float64 `json:"useHigh"`
	}

	// linearForecast performs ordinary least-squares linear regression on vals
	// and returns n projected values starting one step after the last observed point.
	// It also returns the root-mean-square error for confidence band computation.
	linearForecast := func(vals []float64, n int) (projected []float64, rmse float64) {
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
		// OLS: y = a + b*x  where x = 0,1,...,m-1
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
		// RMSE on historical window
		var sumSq float64
		for i, v := range vals {
			diff := v - (a + b*float64(i))
			sumSq += diff * diff
		}
		rmse = 0
		if m > 1 {
			// population rmse
			rmse = sumSq / float64(m)
			if rmse < 0 {
				rmse = 0
			}
			// sqrt approximation via Newton
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

	mux.HandleFunc("/api/forecast", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		setSecureHeaders(w)

		rangeParam := r.URL.Query().Get("range")
		if rangeParam == "" {
			rangeParam = "30m"
		}

		nsFilter := r.URL.Query().Get("namespace")
		nsClause := ""
		nsClauseAgg := ""
		queryArgs := []interface{}{usdPerVcpuHour / 1000.0}
		if nsFilter != "" {
			queryArgs = append(queryArgs, nsFilter)
			nsClause = " AND namespace = $2"
			nsClauseAgg = " AND namespace = $2"
		}

		var histQuery string
		var timeFormat string
		var stepDur time.Duration
		var timeout time.Duration

		switch rangeParam {
		case "30m":
			histQuery = `
				SELECT date_trunc('minute', recorded_at) AS bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics
				WHERE recorded_at > NOW() - INTERVAL '30 minutes'` + nsClause + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			stepDur = time.Minute
			timeout = dbTimeout
		case "1h":
			histQuery = `
				SELECT date_trunc('minute', recorded_at) AS bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics
				WHERE recorded_at > NOW() - INTERVAL '1 hour'` + nsClause + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			stepDur = time.Minute
			timeout = dbTimeout
		case "6h":
			histQuery = `
				SELECT date_trunc('hour', recorded_at) +
					INTERVAL '5 min' * (EXTRACT(minute FROM recorded_at)::INT / 5) AS bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics
				WHERE recorded_at > NOW() - INTERVAL '6 hours'` + nsClause + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			stepDur = 5 * time.Minute
			timeout = dbTimeout * 2
		case "24h":
			rawNs := ""
			hourlyNs := ""
			if nsFilter != "" {
				rawNs = " AND namespace = $2"
				hourlyNs = " AND namespace = $2"
			}
			histQuery = `
				WITH combined AS (
					SELECT date_trunc('hour', recorded_at) +
						INTERVAL '15 min' * (EXTRACT(minute FROM recorded_at)::INT / 15) AS bucket,
						cpu_request, cpu_usage
					FROM metrics
					WHERE recorded_at > NOW() - INTERVAL '24 hours'` + rawNs + `
					UNION ALL
					SELECT hour_bucket AS bucket, avg_cpu_request AS cpu_request, avg_cpu_usage AS cpu_usage
					FROM metrics_hourly
					WHERE hour_bucket > NOW() - INTERVAL '24 hours'` + hourlyNs + `
						AND hour_bucket < (SELECT MIN(recorded_at) FROM metrics)
				)
				SELECT bucket,
					SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM combined
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "15:04"
			stepDur = 15 * time.Minute
			timeout = dbTimeout * 3
		case "7d":
			histQuery = `
				SELECT hour_bucket AS bucket,
					SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_hourly
				WHERE hour_bucket > NOW() - INTERVAL '7 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "01/02 15:04"
			stepDur = time.Hour
			timeout = dbTimeout * 3
		case "30d":
			histQuery = `
				SELECT day_bucket AS bucket,
					SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_daily
				WHERE day_bucket > NOW() - INTERVAL '30 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "01/02"
			stepDur = 24 * time.Hour
			timeout = dbTimeout * 2
		case "90d":
			histQuery = `
				SELECT day_bucket AS bucket,
					SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_daily
				WHERE day_bucket > NOW() - INTERVAL '90 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "01/02"
			stepDur = 24 * time.Hour
			timeout = dbTimeout * 2
		case "365d":
			histQuery = `
				SELECT date_trunc('week', day_bucket) AS bucket,
					AVG((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req,
					AVG((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use
				FROM metrics_daily
				WHERE day_bucket > NOW() - INTERVAL '365 days'` + nsClauseAgg + `
				GROUP BY bucket ORDER BY bucket ASC`
			timeFormat = "2006-01-02"
			stepDur = 7 * 24 * time.Hour
			timeout = dbTimeout * 3
		default:
			writeJSONError(w, http.StatusBadRequest, "invalid range; valid values: 30m, 1h, 6h, 24h, 7d, 30d, 90d, 365d")
			return
		}

		queryCtx, queryCancel := context.WithTimeout(r.Context(), timeout)
		defer queryCancel()

		rows, err := db.QueryContext(queryCtx, histQuery, queryArgs...)
		if err != nil {
			logSQLError("query_forecast_history", err)
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		defer rows.Close()

		var buckets []time.Time
		var reqVals []float64
		var useVals []float64

		for rows.Next() {
			var bucket time.Time
			var req, use float64
			if err := rows.Scan(&bucket, &req, &use); err != nil {
				writeJSONError(w, http.StatusInternalServerError, "internal server error")
				return
			}
			buckets = append(buckets, bucket)
			reqVals = append(reqVals, req)
			useVals = append(useVals, use)
		}
		if err := rows.Err(); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "internal server error")
			return
		}

		n := len(buckets)
		if n == 0 {
			if err := json.NewEncoder(w).Encode([]ForecastPoint{}); err != nil {
				slog.Error("failed to encode forecast response", "component", "http", "err", err)
			}
			return
		}

		// Project same number of future points as historical points
		reqProj, reqRmse := linearForecast(reqVals, n)
		useProj, useRmse := linearForecast(useVals, n)

		// Confidence band: ±1.5 * rmse (Azure-style shaded area)
		reqBand := reqRmse * 1.5
		useBand := useRmse * 1.5

		// Last bucket timestamp
		lastBucket := buckets[n-1].In(time.Local)

		points := make([]ForecastPoint, n)
		for i := 0; i < n; i++ {
			futureT := lastBucket.Add(stepDur * time.Duration(i+1))
			rV := reqProj[i]
			if rV < 0 {
				rV = 0
			}
			uV := useProj[i]
			if uV < 0 {
				uV = 0
			}
			points[i] = ForecastPoint{
				Time:    futureT.Format(timeFormat),
				ReqCost: rV,
				UseCost: uV,
				ReqLow:  max(0, rV-reqBand),
				ReqHigh: rV + reqBand,
				UseHow:  max(0, uV-useBand),
				UseHigh: uV + useBand,
			}
		}

		if err := json.NewEncoder(w).Encode(points); err != nil {
			slog.Error("failed to encode forecast response", "component", "http", "err", err)
		}
	})

	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:")
		_, _ = w.Write(statusHTML)
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:")
		_, _ = w.Write(dashboardHTML)
	})

	mux.HandleFunc("/static/dashboard.css", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		_, _ = w.Write(dashboardCSS)
	})

	mux.HandleFunc("/static/dashboard.js", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		_, _ = w.Write(dashboardJS)
	})

	listenAddr := getEnv("LISTEN_ADDR", "127.0.0.1:8080")
	rateLimit := getEnvInt("RATE_LIMIT_RPS", 100)

	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      withMiddleware(mux, recoverMiddleware, requestLoggerMiddleware, rateLimitMiddleware(rateLimit)),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	slog.Info("Sentinel Cluster Overview", "component", "app", "url", fmt.Sprintf("http://%s", listenAddr))

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "component", "http", "err", err)
			os.Exit(1)
		}
	}()

	<-sigChan
	slog.Info("shutting down gracefully...", "component", "app")
	appCancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "component", "http", "err", err)
	}
	if err := db.Close(); err != nil {
		slog.Warn("database close failed", "component", "db", "err", err)
	}
}
