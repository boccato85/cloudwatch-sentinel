package api

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"time"

	"database/sql"
	"sentinel-agent/pkg/incidents"
	"sentinel-agent/pkg/k8s"
	"sentinel-agent/pkg/store"
)

func (a *API) RegisterHandlers(mux *http.ServeMux) {
	iconData, _ := fs.ReadFile(a.StaticFS, "static/icon.png")
	h := md5.Sum(iconData)
	a.IconETag = `"` + hex.EncodeToString(h[:]) + `"`

	mux.HandleFunc("/health", a.handleHealth)
	mux.HandleFunc("/static/icon.png", a.handleIcon)
	mux.HandleFunc("/api/summary", a.handleSummary)
	mux.HandleFunc("/api/metrics", a.handleMetrics)
	mux.HandleFunc("/api/history", a.handleHistory)
	mux.HandleFunc("/api/waste", a.handleWaste)
	mux.HandleFunc("/api/efficiency", a.handleEfficiency)
	mux.HandleFunc("/api/namespaces", a.handleNamespaces)
	mux.HandleFunc("/api/workloads", a.handleWorkloads)
	mux.HandleFunc("/api/pods", a.handlePods)
	mux.HandleFunc("/api/pods/", a.handlePodLogs)
	mux.HandleFunc("/api/forecast", a.handleForecast)
	mux.HandleFunc("/api/events", a.handleEvents)
	mux.HandleFunc("/api/incidents", a.handleIncidents)
	mux.HandleFunc("/docs", a.handleSwaggerUI)
	mux.HandleFunc("/openapi.yaml", a.handleOpenAPI)
	mux.HandleFunc("/status", a.handleStatusHTML)
	mux.HandleFunc("/", a.handleDashboardHTML)

	// Serve all remaining static assets (CSS, JS modules, etc.) via embedded FS.
	// /static/icon.png is handled separately above for ETag caching support.
	sub, _ := fs.Sub(a.StaticFS, "static")
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(sub))))
}

func (a *API) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	breakerState := store.DBBreaker.State()

	resp := HealthResponse{
		Status:         "ok",
		Version:        a.AgentVersion,
		DBBreakerState: breakerState,
		Checks:         make(map[string]HealthStatus),
	}
	httpStatus := http.StatusOK

	if breakerState != "CLOSED" {
		resp.Status = "degraded"
	}

	dbStart := time.Now()
	pingCtx, pingCancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer pingCancel()
	dbErr := store.DB.PingContext(pingCtx)
	dbLatency := time.Since(dbStart).Milliseconds()
	if dbErr != nil {
		slog.Error("database ping failed", "component", "health", "err", dbErr)
		resp.Checks["database"] = HealthStatus{Status: "unhealthy", Message: "database unreachable"}
		resp.Status = "degraded"
	} else {
		resp.Checks["database"] = HealthStatus{Status: "ok", LatencyMs: &dbLatency}
	}

	k8sStart := time.Now()
	k8sCtx, k8sCancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer k8sCancel()
	k8sErr := k8s.PingK8sAPI(k8sCtx)
	k8sLatency := time.Since(k8sStart).Milliseconds()
	if k8sErr != nil {
		slog.Error("k8s api ping failed", "component", "health", "err", k8sErr)
		resp.Checks["k8s_api"] = HealthStatus{Status: "unhealthy", Message: "kubernetes api unreachable"}
		resp.Status = "degraded"
	} else {
		resp.Checks["k8s_api"] = HealthStatus{Status: "ok", LatencyMs: &k8sLatency}
	}

	metricsStart := time.Now()
	metricsCtx, metricsCancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer metricsCancel()
	metricsErr := k8s.PingMetricsAPI(metricsCtx)
	metricsLatency := time.Since(metricsStart).Milliseconds()
	if metricsErr != nil {
		slog.Error("metrics api ping failed", "component", "health", "err", metricsErr)
		resp.Checks["metrics_api"] = HealthStatus{Status: "unhealthy", Message: "metrics api unreachable"}
		resp.Status = "degraded"
	} else {
		resp.Checks["metrics_api"] = HealthStatus{Status: "ok", LatencyMs: &metricsLatency}
	}

	last := a.GetLastCollectTime()
	if last.IsZero() {
		resp.Checks["collector"] = HealthStatus{Status: "starting", Message: "no collect completed yet"}
		resp.Status = "degraded"
	} else {
		ago := time.Since(last)
		agoSec := int64(ago.Seconds())
		if ago > a.CollectorStaleThreshold {
			resp.Checks["collector"] = HealthStatus{
				Status:  "degraded",
				Message: fmt.Sprintf("last collect %ds ago (threshold: %ds)", agoSec, int64(a.CollectorStaleThreshold.Seconds())),
			}
			resp.Status = "degraded"
		} else {
			resp.Checks["collector"] = HealthStatus{Status: "ok", LatencyMs: &agoSec}
		}
	}

	setSecureHeaders(w)
	w.WriteHeader(httpStatus)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("failed to encode health response", "component", "http", "err", err)
	}
}

func (a *API) handleIcon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.Header.Get("If-None-Match") == a.IconETag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	iconData, err := fs.ReadFile(a.StaticFS, "static/icon.png")
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=3600, must-revalidate")
	w.Header().Set("ETag", a.IconETag)
	w.Write(iconData)
}

func (a *API) handleSummary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)
	_, summary := a.GetLatestStats()
	if err := json.NewEncoder(w).Encode(summary); err != nil {
		slog.Error("failed to encode summary response", "component", "http", "err", err)
		writeJSONError(w, http.StatusInternalServerError, "internal server error")
	}
}

func (a *API) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)
	stats, _ := a.GetLatestStats()
	if err := json.NewEncoder(w).Encode(stats); err != nil {
		slog.Error("failed to encode metrics response", "component", "http", "err", err)
		writeJSONError(w, http.StatusInternalServerError, "internal server error")
	}
}

func (a *API) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)

	rangeParam := r.URL.Query().Get("range")
	if rangeParam == "" {
		rangeParam = "30m"
	}
	validRanges := map[string]bool{"30m": true, "1h": true, "6h": true, "24h": true, "7d": true, "30d": true, "90d": true, "365d": true, "custom": true}
	if !validRanges[rangeParam] {
		writeJSONError(w, http.StatusBadRequest, "invalid range; valid values: 30m, 1h, 6h, 24h, 7d, 30d, 90d, 365d, custom")
		return
	}

	includeSystem := r.URL.Query().Get("system") == "true"
	nsFilter := r.URL.Query().Get("namespace")
	nsClause := ""
	nsClauseAgg := ""
	queryArgs := []interface{}{a.USDPerVcpuHour / 1000.0}
	if nsFilter != "" {
		queryArgs = append(queryArgs, nsFilter)
		nsClause = " AND namespace = $2"
		nsClauseAgg = " AND namespace = $2"
	} else if !includeSystem {
		sysStr := "'kube-system', 'kube-public', 'kube-node-lease', 'kubernetes-dashboard', 'cert-manager', 'monitoring', 'logging', 'ingress-nginx', 'istio-system'"
		nsClause = " AND namespace NOT IN (" + sysStr + ")"
		nsClauseAgg = " AND namespace NOT IN (" + sysStr + ")"
	}

	if rangeParam == "custom" {
		fromStr := r.URL.Query().Get("from")
		toStr := r.URL.Query().Get("to")
		if fromStr == "" || toStr == "" {
			writeJSONError(w, http.StatusBadRequest, "custom range requires from and to parameters")
			return
		}
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
			return time.Time{}, fmt.Errorf("unrecognised time format")
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
		if duration > 365*24*time.Hour {
			writeJSONError(w, http.StatusBadRequest, "custom range exceeds maximum of 365 days")
			return
		}

		var customQuery string
		var customFormat string
		fromArg := len(queryArgs) + 1
		toArg := len(queryArgs) + 2
		if nsFilter != "" {
			fromArg = 3
			toArg = 4
		} else {
			fromArg = 2
			toArg = 3
		}
		queryArgs = append(queryArgs, fromT, toT)

		switch {
		case duration <= 2*time.Hour:
			customQuery = fmt.Sprintf(`SELECT date_trunc('minute', recorded_at) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage   AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at BETWEEN $%d AND $%d%s GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClause)
			customFormat = "15:04"
		case duration <= 7*24*time.Hour:
			customQuery = fmt.Sprintf(`SELECT date_trunc('hour', recorded_at) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage   AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at BETWEEN $%d AND $%d%s GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClause)
			customFormat = "01/02 15:04"
		case duration <= 90*24*time.Hour:
			customQuery = fmt.Sprintf(`SELECT date_trunc('day', hour_bucket) AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage   AS FLOAT) * $1) / 360.0) AS use FROM metrics_hourly WHERE hour_bucket BETWEEN $%d AND $%d%s GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClauseAgg)
			customFormat = "01/02"
		default:
			customQuery = fmt.Sprintf(`SELECT date_trunc('week', day_bucket) AS bucket, AVG((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, AVG((CAST(avg_cpu_usage   AS FLOAT) * $1) / 360.0) AS use FROM metrics_daily WHERE day_bucket BETWEEN $%d AND $%d%s GROUP BY bucket ORDER BY bucket ASC`, fromArg, toArg, nsClauseAgg)
			customFormat = "2006-01-02"
		}

		var customTimeout time.Duration
		switch {
		case duration <= 7*24*time.Hour:
			customTimeout = store.DBTimeout * 3
		case duration <= 90*24*time.Hour:
			customTimeout = store.DBTimeout * 8
		default:
			customTimeout = store.DBTimeout * 15
		}
		queryCtx, queryCancel := context.WithTimeout(r.Context(), customTimeout)
		defer queryCancel()
		var rows *sql.Rows
		err = store.DBBreaker.Execute(func() error {
			var e error
			rows, e = store.DB.QueryContext(queryCtx, customQuery, queryArgs...)
			return e
		})
		if err != nil {
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
		json.NewEncoder(w).Encode(points)
		return
	}

	var query string
	var timeFormat string
	var timeout time.Duration

	switch rangeParam {
	case "30m":
		query = `SELECT date_trunc('minute', recorded_at) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at > NOW() - INTERVAL '30 minutes'` + nsClause + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		timeout = store.DBTimeout
	case "1h":
		query = `SELECT date_trunc('minute', recorded_at) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at > NOW() - INTERVAL '1 hour'` + nsClause + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		timeout = store.DBTimeout
	case "6h":
		query = `SELECT date_trunc('hour', recorded_at) + INTERVAL '5 min' * (EXTRACT(minute FROM recorded_at)::INT / 5) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at > NOW() - INTERVAL '6 hours'` + nsClause + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		timeout = store.DBTimeout * 2
	case "24h":
		rawNs := nsClause
		hourlyNs := nsClauseAgg
		query = `WITH combined AS (SELECT date_trunc('hour', recorded_at) + INTERVAL '15 min' * (EXTRACT(minute FROM recorded_at)::INT / 15) AS bucket, cpu_request, cpu_usage FROM metrics WHERE recorded_at > NOW() - INTERVAL '24 hours'` + rawNs + ` UNION ALL SELECT hour_bucket AS bucket, avg_cpu_request AS cpu_request, avg_cpu_usage AS cpu_usage FROM metrics_hourly WHERE hour_bucket > NOW() - INTERVAL '24 hours'` + hourlyNs + ` AND hour_bucket < (SELECT MIN(recorded_at) FROM metrics)) SELECT bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM combined GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		timeout = store.DBTimeout * 3
	case "7d":
		query = `SELECT hour_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_hourly WHERE hour_bucket > NOW() - INTERVAL '7 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "01/02 15:04"
		timeout = store.DBTimeout * 3
	case "30d":
		query = `SELECT day_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_daily WHERE day_bucket > NOW() - INTERVAL '30 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "01/02"
		timeout = store.DBTimeout * 2
	case "90d":
		query = `SELECT day_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_daily WHERE day_bucket > NOW() - INTERVAL '90 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "01/02"
		timeout = store.DBTimeout * 2
	case "365d":
		query = `SELECT date_trunc('week', day_bucket) AS bucket, AVG((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, AVG((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_daily WHERE day_bucket > NOW() - INTERVAL '365 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "2006-01-02"
		timeout = store.DBTimeout * 3
	default:
		writeJSONError(w, http.StatusBadRequest, "invalid range")
		return
	}

	queryCtx, queryCancel := context.WithTimeout(r.Context(), timeout)
	defer queryCancel()

	var rows *sql.Rows
	err := store.DBBreaker.Execute(func() error {
		var e error
		rows, e = store.DB.QueryContext(queryCtx, query, queryArgs...)
		return e
	})
	if err != nil {
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
			pts = append(pts, HistoryPoint{Time: bucket.In(time.Local).Format(fmt), ReqCost: req, UseCost: use})
		}
		return pts, r.Err()
	}

	points, err := scanPoints(rows, timeFormat)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if len(points) > 1 {
		points = points[:len(points)-1]
	}

	if len(points) == 0 && (rangeParam == "30d" || rangeParam == "90d" || rangeParam == "365d") {
		var fallbackQuery string
		switch {
		case nsFilter != "":
			fallbackQuery = `SELECT hour_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_hourly WHERE namespace = $2 GROUP BY bucket ORDER BY bucket ASC`
		case !includeSystem:
			fallbackQuery = `SELECT hour_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_hourly WHERE namespace NOT IN ('kube-system', 'kube-public', 'kube-node-lease', 'kubernetes-dashboard', 'cert-manager', 'monitoring', 'logging', 'ingress-nginx', 'istio-system') GROUP BY bucket ORDER BY bucket ASC`
		default:
			fallbackQuery = `SELECT hour_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_hourly GROUP BY bucket ORDER BY bucket ASC`
		}
		fbCtx, fbCancel := context.WithTimeout(r.Context(), timeout)
		defer fbCancel()
		var fbRows *sql.Rows
		fbErr := store.DBBreaker.Execute(func() error {
			var e error
			fbRows, e = store.DB.QueryContext(fbCtx, fallbackQuery, queryArgs...)
			return e
		})
		if fbErr == nil {
			defer fbRows.Close()
			fbPoints, fbScanErr := scanPoints(fbRows, "01/02 15:04")
			if fbScanErr == nil && len(fbPoints) > 0 {
				w.Header().Set("X-Sentinel-Data-Note", "insufficient-daily-data-showing-hourly-fallback")
				points = fbPoints
			}
		}
	}

	json.NewEncoder(w).Encode(points)
}

func (a *API) handleWaste(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)

	stats, _ := a.GetLatestStats()
	resp := WasteResponse{
		Entries:     []WasteEntry{},
		ByNamespace: make(map[string]NamespaceWaste),
	}

	for _, s := range stats {
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
			IsSystem:            incidents.SystemNamespaces[s.Namespace],
		}
		resp.Entries = append(resp.Entries, entry)
		resp.TotalSavingMCpu += saving
		resp.WastedPods++

		ns := resp.ByNamespace[s.Namespace]
		ns.SavingMCpu += saving
		ns.WastedPods++
		resp.ByNamespace[s.Namespace] = ns
	}

	sort.Slice(resp.Entries, func(i, j int) bool {
		return resp.Entries[i].PotentialSavingMCpu > resp.Entries[j].PotentialSavingMCpu
	})
	resp.TotalSavingUSD = float64(resp.TotalSavingMCpu) / 1000.0 * a.USDPerVcpuHour

	json.NewEncoder(w).Encode(resp)
}

func (a *API) handleEfficiency(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)

	stats, _ := a.GetLatestStats()
	type nsAccum struct {
		cpuUsage   int64
		cpuRequest int64
		memUsage   int64
		memRequest int64
		pods       int
	}
	accum := make(map[string]*nsAccum)
	for _, s := range stats {
		acc := accum[s.Namespace]
		if acc == nil {
			acc = &nsAccum{}
			accum[s.Namespace] = acc
		}
		acc.cpuUsage += s.CPUUsage
		acc.cpuRequest += s.CPURequest
		acc.memUsage += s.MemUsage
		acc.memRequest += s.MemRequest
		acc.pods++
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
	for ns, acc := range accum {
		e := NamespaceEfficiency{
			Namespace:  ns,
			PodCount:   acc.pods,
			CPUUsage:   acc.cpuUsage,
			CPURequest: acc.cpuRequest,
			MemUsage:   acc.memUsage,
			MemRequest: acc.memRequest,
			IsSystem:   incidents.SystemNamespaces[ns],
			Unmanaged:  acc.cpuRequest == 0 && acc.memRequest == 0,
		}
		if acc.cpuRequest > 0 {
			e.CPUScore = min100(float64(acc.cpuUsage) / float64(acc.cpuRequest) * 100)
		}
		if acc.memRequest > 0 {
			e.MemScore = min100(float64(acc.memUsage) / float64(acc.memRequest) * 100)
		}
		switch {
		case acc.cpuRequest > 0 && acc.memRequest > 0:
			e.Score = (e.CPUScore + e.MemScore) / 2
		case acc.cpuRequest > 0:
			e.Score = e.CPUScore
		case acc.memRequest > 0:
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
	sort.Slice(results, func(i, j int) bool {
		if results[i].Unmanaged != results[j].Unmanaged {
			return results[i].Unmanaged
		}
		return results[i].Score < results[j].Score
	})

	json.NewEncoder(w).Encode(results)
}

func (a *API) handleNamespaces(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	nsList, err := k8s.ListNamespaces(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	names := make([]string, 0, len(nsList.Items))
	for _, ns := range nsList.Items {
		names = append(names, ns.Name)
	}
	sort.Strings(names)
	json.NewEncoder(w).Encode(names)
}

func (a *API) handleWorkloads(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)
	ns := r.URL.Query().Get("namespace")
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var result []WorkloadInfo
	deps, err := k8s.ListDeployments(ctx, ns)
	if err == nil {
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
	}

	sts, err := k8s.ListStatefulSets(ctx, ns)
	if err == nil {
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
	}

	if result == nil {
		result = []WorkloadInfo{}
	}
	json.NewEncoder(w).Encode(result)
}

func (a *API) handlePods(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)
	ns := r.URL.Query().Get("namespace")
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pods, err := k8s.ListPods(ctx, ns)
	if err != nil {
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
	json.NewEncoder(w).Encode(result)
}

func (a *API) handlePodLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	parts := splitPath(r.URL.Path, "/api/pods/")
	if len(parts) != 3 || parts[2] != "logs" {
		writeJSONError(w, http.StatusNotFound, "not found")
		return
	}
	ns := parts[0]
	podName := parts[1]

	validName := regexp.MustCompile(`^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?$`)
	if !validName.MatchString(ns) || !validName.MatchString(podName) {
		writeJSONError(w, http.StatusBadRequest, "invalid namespace or pod name format")
		return
	}

	req := k8s.GetPodLogsRequest(ns, podName, 100)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	stream, err := req.Stream(ctx)
	if err != nil {
		slog.Error("failed to stream pod logs", "component", "http", "namespace", ns, "pod", podName, "err", err)
		writeJSONError(w, http.StatusInternalServerError, "internal server error")
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
}

func (a *API) handleForecast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)

	rangeParam := r.URL.Query().Get("range")
	if rangeParam == "" {
		rangeParam = "30m"
	}

	includeSystem := r.URL.Query().Get("system") == "true"
	nsFilter := r.URL.Query().Get("namespace")
	nsClause := ""
	nsClauseAgg := ""
	queryArgs := []interface{}{a.USDPerVcpuHour / 1000.0}
	if nsFilter != "" {
		queryArgs = append(queryArgs, nsFilter)
		nsClause = " AND namespace = $2"
		nsClauseAgg = " AND namespace = $2"
	} else if !includeSystem {
		sysStr := "'kube-system', 'kube-public', 'kube-node-lease', 'kubernetes-dashboard', 'cert-manager', 'monitoring', 'logging', 'ingress-nginx', 'istio-system'"
		nsClause = " AND namespace NOT IN (" + sysStr + ")"
		nsClauseAgg = " AND namespace NOT IN (" + sysStr + ")"
	}

	var histQuery string
	var timeFormat string
	var stepDur time.Duration
	var timeout time.Duration

	switch rangeParam {
	case "30m":
		histQuery = `SELECT date_trunc('minute', recorded_at) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at > NOW() - INTERVAL '30 minutes'` + nsClause + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		stepDur = time.Minute
		timeout = store.DBTimeout
	case "1h":
		histQuery = `SELECT date_trunc('minute', recorded_at) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at > NOW() - INTERVAL '1 hour'` + nsClause + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		stepDur = time.Minute
		timeout = store.DBTimeout
	case "6h":
		histQuery = `SELECT date_trunc('hour', recorded_at) + INTERVAL '5 min' * (EXTRACT(minute FROM recorded_at)::INT / 5) AS bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics WHERE recorded_at > NOW() - INTERVAL '6 hours'` + nsClause + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		stepDur = 5 * time.Minute
		timeout = store.DBTimeout * 2
	case "24h":
		rawNs := nsClause
		hourlyNs := nsClauseAgg
		histQuery = `WITH combined AS (SELECT date_trunc('hour', recorded_at) + INTERVAL '15 min' * (EXTRACT(minute FROM recorded_at)::INT / 15) AS bucket, cpu_request, cpu_usage FROM metrics WHERE recorded_at > NOW() - INTERVAL '24 hours'` + rawNs + ` UNION ALL SELECT hour_bucket AS bucket, avg_cpu_request AS cpu_request, avg_cpu_usage AS cpu_usage FROM metrics_hourly WHERE hour_bucket > NOW() - INTERVAL '24 hours'` + hourlyNs + ` AND hour_bucket < (SELECT MIN(recorded_at) FROM metrics)) SELECT bucket, SUM((CAST(cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM combined GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "15:04"
		stepDur = 15 * time.Minute
		timeout = store.DBTimeout * 3
	case "7d":
		histQuery = `SELECT hour_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_hourly WHERE hour_bucket > NOW() - INTERVAL '7 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "01/02 15:04"
		stepDur = time.Hour
		timeout = store.DBTimeout * 3
	case "30d":
		histQuery = `SELECT day_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_daily WHERE day_bucket > NOW() - INTERVAL '30 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "01/02"
		stepDur = 24 * time.Hour
		timeout = store.DBTimeout * 2
	case "90d":
		histQuery = `SELECT day_bucket AS bucket, SUM((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, SUM((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_daily WHERE day_bucket > NOW() - INTERVAL '90 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "01/02"
		stepDur = 24 * time.Hour
		timeout = store.DBTimeout * 2
	case "365d":
		histQuery = `SELECT date_trunc('week', day_bucket) AS bucket, AVG((CAST(avg_cpu_request AS FLOAT) * $1) / 360.0) AS req, AVG((CAST(avg_cpu_usage AS FLOAT) * $1) / 360.0) AS use FROM metrics_daily WHERE day_bucket > NOW() - INTERVAL '365 days'` + nsClauseAgg + ` GROUP BY bucket ORDER BY bucket ASC`
		timeFormat = "2006-01-02"
		stepDur = 7 * 24 * time.Hour
		timeout = store.DBTimeout * 3
	default:
		writeJSONError(w, http.StatusBadRequest, "invalid range")
		return
	}

	queryCtx, queryCancel := context.WithTimeout(r.Context(), timeout)
	defer queryCancel()

	var rows *sql.Rows
	err := store.DBBreaker.Execute(func() error {
		var e error
		rows, e = store.DB.QueryContext(queryCtx, histQuery, queryArgs...)
		return e
	})
	if err != nil {
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

	if len(buckets) > 1 {
		buckets = buckets[:len(buckets)-1]
		reqVals = reqVals[:len(reqVals)-1]
		useVals = useVals[:len(useVals)-1]
	}

	n := len(buckets)
	if n == 0 {
		json.NewEncoder(w).Encode([]ForecastPoint{})
		return
	}

	reqProj, reqRmse := linearForecast(reqVals, n)
	useProj, useRmse := linearForecast(useVals, n)

	reqBand := reqRmse * 1.5
	useBand := useRmse * 1.5

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
			UseLow:  max(0, uV-useBand),
			UseHigh: uV + useBand,
		}
	}

	json.NewEncoder(w).Encode(points)
}

func (a *API) handleIncidents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	pods, err := k8s.ListPods(ctx, "")
	if err != nil {
		slog.Error("failed to list pods for incidents", "component", "http", "err", err)
		writeJSONError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	stats, _ := a.GetLatestStats()
	statsMap := make(map[string]PodStats)
	for _, s := range stats {
		statsMap[s.Namespace+"/"+s.Name] = s
	}

	var incs []Incident

	for _, p := range pods.Items {
		ageDur := time.Since(p.CreationTimestamp.Time)
		ageStr := humanAge(p.CreationTimestamp.Time)

		st, hasStats := statsMap[p.Namespace+"/"+p.Name]
		var cpuPct, memPct float64
		var cpuLimPct, memLimPct float64
		if hasStats {
			if st.CPURequest > 0 {
				cpuPct = float64(st.CPUUsage) / float64(st.CPURequest) * 100
			}
			if st.MemRequest > 0 {
				memPct = float64(st.MemUsage) / float64(st.MemRequest) * 100
			}
			if st.CPULimit > 0 {
				cpuLimPct = float64(st.CPUUsage) / float64(st.CPULimit) * 100
			}
			if st.MemLimit > 0 {
				memLimPct = float64(st.MemUsage) / float64(st.MemLimit) * 100
			}
		}

		if p.Status.Phase == "Pending" && ageDur > time.Duration(a.Thresholds.Pods.PendingWarningMinutes)*time.Minute {
			incs = append(incs, Incident{
				PodName:   p.Name,
				Namespace: p.Namespace,
				Type:      "Pending",
				Severity:  "WARNING",
				Message:   fmt.Sprintf("Pod stuck in Pending for %s", ageStr),
				Narrative: "Pod aguardando agendamento. Causas comuns: falta de recursos nos nós, seletores de nós (labels) incompatíveis ou falha na montagem de volumes (PVC).",
				Runbook:   fmt.Sprintf("kubectl describe pod %s -n %s", p.Name, p.Namespace),
				Age:       ageStr,
			})
			continue
		}

		crashLoopFound := false
		oomKilledFound := false
		var crashLoopMsg string

		for _, cs := range p.Status.ContainerStatuses {
			if cs.State.Waiting != nil {
				reason := cs.State.Waiting.Reason
				if reason == "CrashLoopBackOff" || reason == "CreateContainerConfigError" || reason == "ErrImagePull" {
					narrative := "Falha ao iniciar o container. Verifique os logs para erros fatais ou configurações ausentes."
					if reason == "ErrImagePull" {
						narrative = "O Kubernetes não conseguiu baixar a imagem. Verifique se o nome da imagem está correto e se o cluster tem permissão de acesso ao registro."
					}

					if reason == "CrashLoopBackOff" {
						crashLoopFound = true
						crashLoopMsg = fmt.Sprintf("Container %s in %s", cs.Name, reason)
					} else if reason == "ErrImagePull" {
						incs = append(incs, Incident{
							PodName:   p.Name,
							Namespace: p.Namespace,
							Type:      reason,
							Severity:  "CRITICAL",
							Message:   fmt.Sprintf("Container %s in %s", cs.Name, reason),
							Narrative: narrative,
							Runbook:   fmt.Sprintf("kubectl describe pod %s -n %s", p.Name, p.Namespace),
							Age:       ageStr,
						})
					} else {
						// CreateContainerConfigError and other init failures
						incs = append(incs, Incident{
							PodName:   p.Name,
							Namespace: p.Namespace,
							Type:      reason,
							Severity:  "CRITICAL",
							Message:   fmt.Sprintf("Container %s in %s", cs.Name, reason),
							Narrative: narrative,
							Runbook:   fmt.Sprintf("kubectl describe pod %s -n %s", p.Name, p.Namespace),
							Age:       ageStr,
						})
					}
				}
			}
			if cs.State.Terminated != nil && cs.State.Terminated.Reason == "OOMKilled" {
				oomKilledFound = true
				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "OOMKilled",
					Severity:  "CRITICAL",
					Message:   fmt.Sprintf("Container %s OOMKilled", cs.Name),
					Narrative: "O container foi terminado por exceder o limite de memória. Se recorrente, aumente o resources.limits.memory.",
					Runbook:   fmt.Sprintf("kubectl describe pod %s -n %s", p.Name, p.Namespace),
					Age:       ageStr,
				})
			}
		}

		// Correlation: CrashLoop + CPU
		if crashLoopFound {
			narrative := "O container está falhando consecutivamente. Verifique os logs para erros fatais da aplicação ou configurações ausentes (env vars, secrets)."
			runbook := fmt.Sprintf("kubectl logs pod/%s -n %s --previous", p.Name, p.Namespace)
			if cpuPct >= a.Thresholds.CPU.Warning {
				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "CrashLoopCpuThrottling",
					Severity:  "CRITICAL",
					Message:   fmt.Sprintf("%s correlated with High CPU (%.1f%%)", crashLoopMsg, cpuPct),
					Narrative: "O container está em CrashLoop e consumindo CPU excessiva durante o boot. Isso pode indicar um loop infinito no código de inicialização.",
					Runbook:   runbook,
					Age:       ageStr,
				})
			} else if a.Thresholds.Pods.CrashLoopCritical {
				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "CrashLoopBackOff",
					Severity:  "CRITICAL",
					Message:   crashLoopMsg,
					Narrative: narrative,
					Runbook:   runbook,
					Age:       ageStr,
				})
			} else {
				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "CrashLoopBackOff",
					Severity:  "WARNING",
					Message:   crashLoopMsg,
					Narrative: narrative,
					Runbook:   runbook,
					Age:       ageStr,
				})
			}
		}

		// CPU/Mem Thresholds
		if hasStats && !crashLoopFound && !oomKilledFound {
			// CPU logic
			if st.CPULimit > 0 && cpuLimPct >= a.Thresholds.CPU.Critical {
				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "HighCPU",
					Severity:  "CRITICAL",
					Message:   fmt.Sprintf("CPU usage at %.1f%% of LIMIT (danger of throttling)", cpuLimPct),
					Narrative: "Uso de CPU atingiu o limite configurado. Isso causa throttling severo e degradação de performance. Aumente o limite de CPU.",
					Runbook:   fmt.Sprintf("kubectl top pod %s -n %s", p.Name, p.Namespace),
					Age:       ageStr,
				})
			} else if cpuPct >= a.Thresholds.CPU.Warning {
				// Above request is always a warning, but only critical if it hits limit or is extremely high
				sev := "WARNING"
				msg := fmt.Sprintf("CPU usage at %.1f%% of request", cpuPct)
				narrative := "O uso de CPU está acima da reserva solicitada. Isso pode causar latência se outros pods no mesmo nó também demandarem recursos."
				if cpuPct > 200 {
					sev = "CRITICAL" // Extreme case, probably misconfigured
					msg = fmt.Sprintf("CPU usage at %.1f%% of request (Extreme over-usage)", cpuPct)
					narrative = "O uso de CPU está drasticamente acima da reserva. Risco alto de instabilidade. Revise o dimensionamento do pod."
				}
				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "HighCPU",
					Severity:  sev,
					Message:   msg,
					Narrative: narrative,
					Runbook:   fmt.Sprintf("kubectl top pod %s -n %s", p.Name, p.Namespace),
					Age:       ageStr,
				})
			}

			// Memory logic
			if st.MemLimit > 0 && memLimPct >= a.Thresholds.Memory.Critical {
				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "HighMemory",
					Severity:  "CRITICAL",
					Message:   fmt.Sprintf("Memory usage at %.1f%% of LIMIT (danger of OOMKill)", memLimPct),
					Narrative: "Uso de memória próximo ao limite fatal. O container corre risco iminente de OOMKill. Aumente o limite de memória imediatamente.",
					Runbook:   fmt.Sprintf("kubectl top pod %s -n %s", p.Name, p.Namespace),
					Age:       ageStr,
				})
			} else if memPct >= a.Thresholds.Memory.Warning {
				sev := "WARNING"
				msg := fmt.Sprintf("Memory usage at %.1f%% of request", memPct)
				narrative := "Uso de memória acima da reserva solicitada. Risco de expulsão (eviction) pelo Kubelet se o nó ficar sem memória livre."
				if st.MemLimit == 0 && memPct > 250 {
					sev = "CRITICAL"
					msg = fmt.Sprintf("Memory usage at %.1f%% of request (No limit set, risk of eviction)", memPct)
					narrative = "O pod não possui limite de memória e está consumindo muito além da reserva. Isso ameaça a estabilidade de outros pods no nó."
				}

				incs = append(incs, Incident{
					PodName:   p.Name,
					Namespace: p.Namespace,
					Type:      "HighMemory",
					Severity:  sev,
					Message:   msg,
					Narrative: narrative,
					Runbook:   fmt.Sprintf("kubectl top pod %s -n %s", p.Name, p.Namespace),
					Age:       ageStr,
				})
			}
		}
	}

	for _, s := range stats {
		if s.Severity != "" && s.Severity != "info" && s.Severity != "ok" {
			// standard severity mapping
			sev := "WARNING"
			if s.Severity == "critical" || s.Severity == "CRITICAL" {
				sev = "CRITICAL"
			}
			incs = append(incs, Incident{
				PodName:   s.Name,
				Namespace: s.Namespace,
				Type:      "ResourceWaste",
				Severity:  sev,
				Message:   s.Opportunity,
				Narrative: "Esta carga está superprovisionada. Reduzir as reservas de recursos para patamares mais próximos do uso real pode gerar economia significativa.",
				Runbook:   fmt.Sprintf("kubectl get pod %s -n %s -o yaml", s.Name, s.Namespace),
				Age:       "-",
				IsWaste:   true,
			})
		}
	}

	if incs == nil {
		incs = []Incident{}
	}

	// TODO(arch): LLM enrichment must NOT be called synchronously here.
	// Calling GenerateEnrichment() inline would block this handler goroutine for
	// the full LLM round-trip (potentially 5-30s on Ollama), degrading all
	// concurrent dashboard requests. The correct pattern: enrich incidents in a
	// background goroutine during the collector cycle and cache the result here.
	slog.Debug("incidents computed", "component", "http", "count", len(incs))
	json.NewEncoder(w).Encode(incs)
}

func (a *API) handleStatusHTML(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	data, _ := fs.ReadFile(a.StaticFS, "static/status.html")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:")
	w.Write(data)
}

func (a *API) handleDashboardHTML(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	data, _ := fs.ReadFile(a.StaticFS, "static/dashboard.html")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:")
	w.Write(data)
}

func (a *API) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	setSecureHeaders(w)
	ns := r.URL.Query().Get("namespace")
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	events, err := k8s.ListEvents(ctx, ns)
	if err != nil {
		slog.Error("failed to list events", "component", "http", "err", err)
		writeJSONError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	result := make([]EventInfo, 0, len(events.Items))
	for _, e := range events.Items {
		result = append(result, EventInfo{
			Type:      e.Type,
			Reason:    e.Reason,
			Name:      e.InvolvedObject.Name,
			Namespace: e.InvolvedObject.Namespace,
			Message:   e.Message,
			Age:       humanAge(e.LastTimestamp.Time),
			Timestamp: e.LastTimestamp.Time.Format(time.RFC3339),
		})
	}

	// Sort by timestamp descending
	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp > result[j].Timestamp
	})

	json.NewEncoder(w).Encode(result)
}
