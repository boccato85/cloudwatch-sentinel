package main

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sentinel-agent/pkg/api"
	"sentinel-agent/pkg/incidents"
	"sentinel-agent/pkg/k8s"
	"sentinel-agent/pkg/store"
	"sort"
	"strconv"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

//go:embed static
var staticFS embed.FS

var (
	usdPerVcpuHour float64
	usdPerGbHour   float64
)

const agentVersion = "1.0.0-rc.2"
const collectorStaleThreshold = 30 * time.Second

var (
	latestStats   []api.PodStats
	latestSummary api.ClusterSummary
	statsMutex    sync.Mutex
	db            *sql.DB

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

func logCollectorError(op string, err error) {
	slog.Error("collector error", "component", "collector", "op", op, "err", err)
}

// getPodRequest looks up the CPU request (mCPU) for a pod in the given namespace map.
func getPodRequest(m map[string]map[string]int64, ns, pod string) (int64, bool) {
	if m == nil {
		return 0, false
	}
	if nsMap, ok := m[ns]; ok {
		if req, ok := nsMap[pod]; ok {
			return req, true
		}
	}
	return 0, false
}

func main() {
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

	usdPerVcpuHour = getEnvFloat("USD_PER_VCPU_HOUR", 0.04)
	usdPerGbHour = getEnvFloat("USD_PER_GB_HOUR", 0.005)

	dbUser := requireEnv("DB_USER")
	dbPass := requireEnv("DB_PASSWORD")
	dbName := getEnv("DB_NAME", "sentinel_db")
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	sslMode := getEnv("DB_SSLMODE", "disable")
	store.DBTimeout = time.Duration(getEnvInt("DB_TIMEOUT_SEC", 5)) * time.Second

	thresholdsPath := getEnv("THRESHOLDS_PATH", "../config/thresholds.yaml")
	thresholds := incidents.LoadThresholds(thresholdsPath)

	retentionRawHours := getEnvInt("RETENTION_RAW_HOURS", 24)
	retentionHourlyDays := getEnvInt("RETENTION_HOURLY_DAYS", 30)
	retentionDailyDays := getEnvInt("RETENTION_DAILY_DAYS", 365)

	if sslMode == "disable" {
		slog.Warn("PostgreSQL SSL is disabled — set DB_SSLMODE=require for production", "component", "db")
	}

	connStr := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s connect_timeout=10",
		dbHost, dbPort, dbUser, dbPass, dbName, sslMode)

	slog.Info("connecting to PostgreSQL", "component", "db", "host", dbHost, "port", dbPort, "database", dbName)
	var err error
	store.DB, err = sql.Open("postgres", connStr)
	if err != nil {
		slog.Error("database connection failed", "component", "db", "err", err)
		os.Exit(1)
	}

	store.DB.SetMaxOpenConns(25)
	store.DB.SetMaxIdleConns(5)
	store.DB.SetConnMaxLifetime(5 * time.Minute)
	store.DB.SetConnMaxIdleTime(1 * time.Minute)

	maxRetries := getEnvInt("DB_CONNECT_RETRIES", 10)
	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		pingCtx, pingCancel := store.WithDBTimeout(context.Background())
		lastErr = store.DB.PingContext(pingCtx)
		pingCancel()

		if lastErr == nil {
			slog.Info("database connection established", "component", "db", "attempt", attempt)
			break
		}

		if attempt == maxRetries {
			slog.Warn("database ping failed after all retries, starting in DEGRADED state", "component", "db", "attempts", maxRetries, "err", lastErr)
			break
		}

		backoff := time.Duration(1<<(attempt-1)) * time.Second
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
		slog.Warn("database not ready, retrying...", "component", "db", "attempt", attempt, "maxRetries", maxRetries, "backoff", backoff, "err", lastErr)
		time.Sleep(backoff)
	}

	schemaCtx, schemaCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err = store.EnsureSchema(schemaCtx); err != nil {
		slog.Warn("failed to create database schema (starting in DEGRADED state)", "component", "db", "err", err)
	} else {
		slog.Info("database schema verified", "component", "db")
	}
	schemaCancel()

	slog.Info("Sentinel Intelligence Engine: Active", "component", "app", "version", agentVersion)

	if err := k8s.InitClients(); err != nil {
		slog.Error("failed to initialize k8s clients", "component", "k8s", "err", err)
		os.Exit(1)
	}

	appCtx, appCancel := context.WithCancel(context.Background())
	defer appCancel()

	authEnabled := getEnv("AUTH_ENABLED", "true") == "true"
	authToken := getEnv("AUTH_TOKEN", "")
	if authEnabled && authToken == "" {
		slog.Error("AUTH_TOKEN must be set when AUTH_ENABLED=true — refusing to start with no token", "component", "app")
		os.Exit(1)
	}

	go store.StartRetentionWorker(appCtx, retentionRawHours, retentionHourlyDays, retentionDailyDays)

	go func() {
		backoff := 10 * time.Second
		for {
			summary := api.ClusterSummary{PodsByPhase: make(map[string]int)}
			ctx, cancel := context.WithTimeout(appCtx, 15*time.Second)

			hadError := false

			nodes, err := k8s.ListNodes(ctx)
			nodeMap := make(map[string]*api.NodeInfo)
			if err != nil {
				slog.Error("failed to list nodes", "component", "collector", "err", err)
				hadError = true
			} else {
				for _, n := range nodes.Items {
					nodeInfo := &api.NodeInfo{
						Name:           n.Name,
						Status:         "Running",
						CpuAllocatable: n.Status.Allocatable.Cpu().MilliValue(),
						MemAllocatable: n.Status.Allocatable.Memory().Value() / 1024 / 1024,
					}
					nodeMap[n.Name] = nodeInfo
					summary.CpuAllocatable += nodeInfo.CpuAllocatable
					summary.MemAllocatable += nodeInfo.MemAllocatable
				}
			}

			pods, err := k8s.ListPods(ctx, "")
			podSpecMap := make(map[string]map[string]k8s.PodSpec)

			if err != nil {
				slog.Error("failed to list pods", "component", "collector", "err", err)
				hadError = true
			} else {
				podSpecMap = k8s.BuildPodSpecMap(pods.Items)
				for _, p := range pods.Items {
					summary.PodsByPhase[string(p.Status.Phase)]++
					if p.Status.Phase == "Failed" {
						summary.FailedPods = append(summary.FailedPods, api.PodAlert{Name: p.Name, Namespace: p.Namespace})
					}

					nInfo, nodeExists := nodeMap[p.Spec.NodeName]
					if nodeExists {
						nInfo.PodCount++
					}

					for _, c := range p.Spec.Containers {
						cpuReq := c.Resources.Requests.Cpu().MilliValue()
						memReq := c.Resources.Requests.Memory().Value() / 1024 / 1024
						summary.CpuRequested += cpuReq
						summary.MemRequested += memReq
						if nodeExists {
							nInfo.CpuRequested += cpuReq
							nInfo.MemRequested += memReq
						}
					}
				}
			}

			for _, nInfo := range nodeMap {
				summary.Nodes = append(summary.Nodes, *nInfo)
			}
			sort.Slice(summary.Nodes, func(i, j int) bool {
				return summary.Nodes[i].Name < summary.Nodes[j].Name
			})

			var newStats []api.PodStats
			mList, mListErr := k8s.ListPodMetricsWithRetry(ctx)
			if mListErr != nil {
				logCollectorError("list_pod_metrics", mListErr)
				hadError = true
			} else {
				func() {
					dbCtx, dbCancel := store.WithDBTimeout(appCtx)
					defer dbCancel()
					tx, err := store.DB.BeginTx(dbCtx, nil)
					if err != nil {
						store.LogSQLError("begin_tx_metrics_insert", err)
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

						spec := k8s.PodSpec{}
						if nsMap, ok := podSpecMap[m.Namespace]; ok {
							spec = nsMap[m.Name]
						}

						var nodeAllocCPU int64
						if n, ok := nodeMap[spec.NodeName]; ok {
							nodeAllocCPU = n.CpuAllocatable
						}
						pStat := api.PodStats{
							Name:               m.Name,
							Namespace:          m.Namespace,
							NodeName:           spec.NodeName,
							Phase:              spec.Phase,
							AppLabel:           spec.AppLabel,
							CPUUsage:           podCPU,
							CPURequest:         spec.CPUReq,
							CPULimit:           spec.CPULim,
							CPURequestPresent:  spec.ReqFound,
							NodeAllocatableCPU: nodeAllocCPU,
							MemUsage:           podMem,
							MemRequest:         spec.MemReq,
							MemLimit:           spec.MemLim,
						}
						saving, opportunity, wastePct, severity := incidents.AnalyzeWaste(pStat.CPURequestPresent, pStat.CPURequest, pStat.CPUUsage, thresholds)
						if saving != nil {
							pStat.PotentialSavingMCpu = saving
							pStat.Opportunity = opportunity
							pStat.WastePct = wastePct
							pStat.Severity = severity
						}

						if _, err := tx.ExecContext(dbCtx, `INSERT INTO metrics (pod_name, namespace, container_name, cpu_usage, cpu_request, mem_usage, mem_request, opportunity) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
							m.Name, m.Namespace, "all", podCPU, spec.CPUReq, podMem, spec.MemReq, pStat.Opportunity); err != nil {
							store.LogSQLError("insert_metric", err)
							slog.Warn("insert metric failed", "component", "collector", "pod", m.Name, "namespace", m.Namespace, "err", err)
							continue
						}
						newStats = append(newStats, pStat)
					}

					if err := tx.Commit(); err != nil {
						store.LogSQLError("commit_metrics_insert", err)
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

			collectMutex.Lock()
			lastCollectTime = time.Now()
			collectMutex.Unlock()

			cancel()
			if hadError {
				backoff *= 2
				if backoff > 60*time.Second {
					backoff = 60 * time.Second
				}
				slog.Warn("collector backoff increased due to error", "component", "collector", "backoff", backoff)
			} else {
				backoff = 10 * time.Second
			}
			select {
			case <-appCtx.Done():
				return
			case <-time.After(backoff):
			}
		}
	}()

	mux := http.NewServeMux()

	apiService := &api.API{
		AgentVersion:            agentVersion,
		CollectorStaleThreshold: collectorStaleThreshold,
		USDPerVcpuHour:          usdPerVcpuHour,
		Thresholds:              thresholds,
		AuthEnabled:             authEnabled,
		AuthToken:               authToken,
		GetLatestStats: func() ([]api.PodStats, api.ClusterSummary) {
			statsMutex.Lock()
			defer statsMutex.Unlock()
			return latestStats, latestSummary
		},
		GetLastCollectTime: func() time.Time {
			collectMutex.Lock()
			defer collectMutex.Unlock()
			return lastCollectTime
		},
		StaticFS: staticFS,
	}

	apiService.RegisterHandlers(mux)

	listenAddr := getEnv("LISTEN_ADDR", "127.0.0.1:8080")
	rateLimit := getEnvInt("RATE_LIMIT_RPS", 100)

	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      api.WithMiddleware(mux, api.RecoverMiddleware, api.RequestLoggerMiddleware, api.RateLimitMiddleware(rateLimit), apiService.AuthMiddleware),
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
	if err := store.DB.Close(); err != nil {
		slog.Warn("database close failed", "component", "db", "err", err)
	}
}
