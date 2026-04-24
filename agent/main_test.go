package main

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

// ── getPodRequest ─────────────────────────────────────────────────────────────

func TestGetPodRequest_Found(t *testing.T) {
	m := map[string]map[string]int64{
		"sentinel": {"agent": 100},
	}
	req, found := getPodRequest(m, "sentinel", "agent")
	if !found {
		t.Fatal("expected found=true")
	}
	if req != 100 {
		t.Errorf("expected req=100, got %d", req)
	}
}

func TestGetPodRequest_NamespaceNotFound(t *testing.T) {
	m := map[string]map[string]int64{
		"sentinel": {"agent": 100},
	}
	_, found := getPodRequest(m, "other-ns", "agent")
	if found {
		t.Error("expected found=false for missing namespace")
	}
}

func TestGetPodRequest_PodNotFound(t *testing.T) {
	m := map[string]map[string]int64{
		"sentinel": {"agent": 100},
	}
	_, found := getPodRequest(m, "sentinel", "nonexistent")
	if found {
		t.Error("expected found=false for missing pod")
	}
}

func TestGetPodRequest_EmptyMap(t *testing.T) {
	_, found := getPodRequest(nil, "sentinel", "agent")
	if found {
		t.Error("expected found=false for nil map")
	}
}

func TestResolveLogLevel(t *testing.T) {
	tests := []struct {
		in   string
		want slog.Level
	}{
		{in: "debug", want: slog.LevelDebug},
		{in: "warn", want: slog.LevelWarn},
		{in: "error", want: slog.LevelError},
		{in: "info", want: slog.LevelInfo},
		{in: "anything-else", want: slog.LevelInfo},
	}

	for _, tt := range tests {
		got := resolveLogLevel(tt.in)
		if got != tt.want {
			t.Fatalf("resolveLogLevel(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestBuildDBConnString(t *testing.T) {
	cfg := runtimeConfig{
		DBHost:    "db.local",
		DBPort:    "5432",
		DBUser:    "sentinel",
		DBPass:    "secret",
		DBName:    "sentinel_db",
		DBSSLMode: "require",
	}

	got := buildDBConnString(cfg)
	wants := []string{
		"host=db.local",
		"port=5432",
		"user=sentinel",
		"password=secret",
		"dbname=sentinel_db",
		"sslmode=require",
		"connect_timeout=10",
	}
	for _, want := range wants {
		if !strings.Contains(got, want) {
			t.Fatalf("buildDBConnString missing %q in %q", want, got)
		}
	}
}

func TestNextCollectorBackoff(t *testing.T) {
	tests := []struct {
		name     string
		current  time.Duration
		hadError bool
		want     time.Duration
	}{
		{name: "reset on success", current: 40 * time.Second, hadError: false, want: 10 * time.Second},
		{name: "double on error", current: 10 * time.Second, hadError: true, want: 20 * time.Second},
		{name: "cap on error", current: 40 * time.Second, hadError: true, want: 60 * time.Second},
	}

	for _, tt := range tests {
		got := nextCollectorBackoff(tt.current, tt.hadError)
		if got != tt.want {
			t.Fatalf("%s: nextCollectorBackoff(%v, %v) = %v, want %v", tt.name, tt.current, tt.hadError, got, tt.want)
		}
	}
}
