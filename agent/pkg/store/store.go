package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"

	_ "github.com/lib/pq"
)

var (
	DB        *sql.DB
	DBTimeout = 5 * time.Second
)

func WithDBTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	if parent == nil {
		parent = context.Background()
	}
	return context.WithTimeout(parent, DBTimeout)
}

func LogSQLError(operation string, err error) {
	if err == nil {
		return
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		slog.Warn("sql context error", "component", "db", "operation", operation, "timeout", DBTimeout.String(), "err", err)
		return
	}
	slog.Warn("sql operation failed", "component", "db", "operation", operation, "err", err)
}

func EnsureSchema(ctx context.Context) error {
	// Migration: rename legacy 'timestamp' column to 'recorded_at' if needed
	_, _ = DB.ExecContext(ctx, `
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
	_, err := DB.ExecContext(ctx, schema)
	return err
}

// AggregateHourlyMetrics aggregates raw metrics older than 1 hour into hourly buckets
func AggregateHourlyMetrics(ctx context.Context) error {
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
	_, err := DB.ExecContext(ctx, query)
	return err
}

// AggregateDailyMetrics aggregates hourly metrics older than 1 day into daily buckets
func AggregateDailyMetrics(ctx context.Context) error {
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
	_, err := DB.ExecContext(ctx, query)
	return err
}

// StartRetentionWorker runs aggregation and cleanup jobs periodically
func StartRetentionWorker(ctx context.Context, rawHours, hourlyDays, dailyDays int) {
	// Run immediately on startup
	RunRetentionJobs(rawHours, hourlyDays, dailyDays)

	// Then run every hour
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("retention worker stopped", "component", "retention")
			return
		case <-ticker.C:
			RunRetentionJobs(rawHours, hourlyDays, dailyDays)
		}
	}
}

func RunRetentionJobs(rawHours, hourlyDays, dailyDays int) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// Aggregate hourly
	if err := AggregateHourlyMetrics(ctx); err != nil {
		slog.Warn("hourly aggregation failed", "component", "retention", "err", err)
	} else {
		slog.Debug("hourly aggregation completed", "component", "retention")
	}

	// Aggregate daily
	if err := AggregateDailyMetrics(ctx); err != nil {
		slog.Warn("daily aggregation failed", "component", "retention", "err", err)
	} else {
		slog.Debug("daily aggregation completed", "component", "retention")
	}

	// Cleanup old data
	rawDel, hourlyDel, dailyDel, err := CleanupOldMetrics(ctx, rawHours, hourlyDays, dailyDays)
	if err != nil {
		slog.Warn("cleanup failed", "component", "retention", "err", err)
	} else if rawDel > 0 || hourlyDel > 0 || dailyDel > 0 {
		slog.Info("retention cleanup completed", "component", "retention", "raw_deleted", rawDel, "hourly_deleted", hourlyDel, "daily_deleted", dailyDel)
	}
}

// CleanupOldMetrics removes metrics older than the configured retention periods
func CleanupOldMetrics(ctx context.Context, rawHours, hourlyDays, dailyDays int) (int64, int64, int64, error) {
	var rawDeleted, hourlyDeleted, dailyDeleted int64

	// Delete raw metrics older than retention period (keep only last hour for aggregation)
	res, err := DB.ExecContext(ctx, `DELETE FROM metrics WHERE recorded_at < NOW() - INTERVAL '1 hour' * $1`, rawHours)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("cleanup raw metrics: %w", err)
	}
	rawDeleted, _ = res.RowsAffected()

	// Delete hourly aggregates older than retention period
	res, err = DB.ExecContext(ctx, `DELETE FROM metrics_hourly WHERE hour_bucket < NOW() - INTERVAL '1 day' * $1`, hourlyDays)
	if err != nil {
		return rawDeleted, 0, 0, fmt.Errorf("cleanup hourly metrics: %w", err)
	}
	hourlyDeleted, _ = res.RowsAffected()

	// Delete daily aggregates older than retention period
	res, err = DB.ExecContext(ctx, `DELETE FROM metrics_daily WHERE day_bucket < NOW() - INTERVAL '1 day' * $1`, dailyDays)
	if err != nil {
		return rawDeleted, hourlyDeleted, 0, fmt.Errorf("cleanup daily metrics: %w", err)
	}
	dailyDeleted, _ = res.RowsAffected()

	// Also cleanup old cost history
	_, err = DB.ExecContext(ctx, `DELETE FROM cost_history WHERE recorded_at < NOW() - INTERVAL '1 day' * $1`, dailyDays)
	if err != nil {
		return rawDeleted, hourlyDeleted, dailyDeleted, fmt.Errorf("cleanup cost history: %w", err)
	}

	return rawDeleted, hourlyDeleted, dailyDeleted, nil
}
