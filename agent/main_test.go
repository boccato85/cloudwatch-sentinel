package main

import (
	"testing"
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

func TestFailingCI(t *testing.T) {
	t.Errorf("CI pipeline failure test")
}

