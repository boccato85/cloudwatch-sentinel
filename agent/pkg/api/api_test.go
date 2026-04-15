package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/assert"
	"sentinel-agent/pkg/store"
	"sentinel-agent/pkg/k8s"
	"context"
)

func TestHandleHealth(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.MonitorPingsOption(true))
	assert.NoError(t, err)
	defer db.Close()
	store.DB = db

	// Mock k8s pings
	originalPingK8s := k8s.PingK8sAPI
	originalPingMetrics := k8s.PingMetricsAPI
	k8s.PingK8sAPI = func(ctx context.Context) error { return nil }
	k8s.PingMetricsAPI = func(ctx context.Context) error { return nil }
	defer func() {
		k8s.PingK8sAPI = originalPingK8s
		k8s.PingMetricsAPI = originalPingMetrics
	}()

	mock.ExpectPing().WillReturnError(nil)

	a := &API{
		AgentVersion:            "v1.0.0",
		CollectorStaleThreshold: 2 * time.Minute,
		GetLastCollectTime: func() time.Time {
			return time.Now()
		},
	}

	req, err := http.NewRequest("GET", "/health", nil)
	assert.NoError(t, err)

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(a.handleHealth)

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp HealthResponse
	err = json.NewDecoder(rr.Body).Decode(&resp)
	assert.NoError(t, err)
	assert.Equal(t, "ok", resp.Status)
	assert.Equal(t, "v1.0.0", resp.Version)
	assert.Equal(t, "ok", resp.Checks["database"].Status)
}

func TestHandleSummary(t *testing.T) {
	a := &API{
		GetLatestStats: func() ([]PodStats, ClusterSummary) {
			return nil, ClusterSummary{
				Nodes: []NodeInfo{{Name: "minikube", Status: "Ready"}},
			}
		},
	}

	req, err := http.NewRequest("GET", "/api/summary", nil)
	assert.NoError(t, err)

	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(a.handleSummary)

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)

	var resp ClusterSummary
	err = json.NewDecoder(rr.Body).Decode(&resp)
	assert.NoError(t, err)
	assert.Len(t, resp.Nodes, 1)
	assert.Equal(t, "minikube", resp.Nodes[0].Name)
}
