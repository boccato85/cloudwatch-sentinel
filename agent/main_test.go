package main

import (
	"os"
	"testing"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func ptr[T any](v T) *T { return &v }

// ── defaultThresholds ────────────────────────────────────────────────────────

func TestDefaultThresholds_Values(t *testing.T) {
	d := defaultThresholds()

	cases := []struct {
		name string
		got  float64
		want float64
	}{
		{"cpu.warning", d.CPU.Warning, 70},
		{"cpu.critical", d.CPU.Critical, 85},
		{"memory.warning", d.Memory.Warning, 75},
		{"memory.critical", d.Memory.Critical, 90},
		{"disk.warning", d.Disk.Warning, 70},
		{"disk.critical", d.Disk.Critical, 85},
		{"waste.overprovisioned_warning", d.Waste.OverprovisionedWarning, 60},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("defaultThresholds.%s = %.1f, want %.1f", c.name, c.got, c.want)
		}
	}
	if d.Waste.MinRequestMCpu != 5 {
		t.Errorf("defaultThresholds.waste.min_request_mcpu = %d, want 5", d.Waste.MinRequestMCpu)
	}
	if d.Pods.PendingWarningMinutes != 5 {
		t.Errorf("defaultThresholds.pods.pending_warning_minutes = %d, want 5", d.Pods.PendingWarningMinutes)
	}
	if !d.Pods.CrashLoopCritical {
		t.Error("defaultThresholds.pods.crash_loop_critical should be true")
	}
}

// ── loadThresholds ────────────────────────────────────────────────────────────

func TestLoadThresholds_FileNotFound_ReturnsDefaults(t *testing.T) {
	got := loadThresholds("/nonexistent/path/thresholds.yaml")
	want := defaultThresholds()

	if got.CPU.Warning != want.CPU.Warning {
		t.Errorf("expected cpu.warning=%.1f, got %.1f", want.CPU.Warning, got.CPU.Warning)
	}
	if got.Waste.OverprovisionedWarning != want.Waste.OverprovisionedWarning {
		t.Errorf("expected waste.overprovisioned_warning=%.1f, got %.1f", want.Waste.OverprovisionedWarning, got.Waste.OverprovisionedWarning)
	}
}

func TestLoadThresholds_InvalidYAML_ReturnsDefaults(t *testing.T) {
	f, err := os.CreateTemp("", "thresholds-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())
	f.WriteString("{ this is: [not valid yaml")
	f.Close()

	got := loadThresholds(f.Name())
	want := defaultThresholds()

	if got.CPU.Warning != want.CPU.Warning {
		t.Errorf("expected default cpu.warning=%.1f after parse error, got %.1f", want.CPU.Warning, got.CPU.Warning)
	}
}

func TestLoadThresholds_ValidFile_OverridesValues(t *testing.T) {
	content := `
cpu:
  warning: 50
  critical: 75
memory:
  warning: 60
  critical: 80
waste:
  overprovisioned_warning: 40
  min_request_mcpu: 10
`
	f, err := os.CreateTemp("", "thresholds-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())
	f.WriteString(content)
	f.Close()

	got := loadThresholds(f.Name())

	if got.CPU.Warning != 50 {
		t.Errorf("cpu.warning: got %.1f, want 50", got.CPU.Warning)
	}
	if got.CPU.Critical != 75 {
		t.Errorf("cpu.critical: got %.1f, want 75", got.CPU.Critical)
	}
	if got.Waste.OverprovisionedWarning != 40 {
		t.Errorf("waste.overprovisioned_warning: got %.1f, want 40", got.Waste.OverprovisionedWarning)
	}
	if got.Waste.MinRequestMCpu != 10 {
		t.Errorf("waste.min_request_mcpu: got %d, want 10", got.Waste.MinRequestMCpu)
	}
}

func TestLoadThresholds_PartialFile_KeepsDefaults(t *testing.T) {
	// Only cpu section — disk and waste should keep defaults
	content := `
cpu:
  warning: 55
  critical: 80
`
	f, err := os.CreateTemp("", "thresholds-*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())
	f.WriteString(content)
	f.Close()

	got := loadThresholds(f.Name())
	def := defaultThresholds()

	if got.CPU.Warning != 55 {
		t.Errorf("cpu.warning: got %.1f, want 55", got.CPU.Warning)
	}
	// Unspecified sections must fall back to defaults
	if got.Disk.Warning != def.Disk.Warning {
		t.Errorf("disk.warning: got %.1f, want %.1f (default)", got.Disk.Warning, def.Disk.Warning)
	}
	if got.Waste.OverprovisionedWarning != def.Waste.OverprovisionedWarning {
		t.Errorf("waste.overprovisioned_warning: got %.1f, want %.1f (default)", got.Waste.OverprovisionedWarning, def.Waste.OverprovisionedWarning)
	}
}

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

// ── applyWasteAnalysis ────────────────────────────────────────────────────────

func TestApplyWasteAnalysis_NoRequest_NoOpportunity(t *testing.T) {
	stat := PodStats{
		Name:              "pod-a",
		CPUUsage:          10,
		CPURequest:        0,
		CPURequestPresent: false,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu != nil {
		t.Error("expected no opportunity when CPURequestPresent=false")
	}
}

func TestApplyWasteAnalysis_RequestBelowMinimum_NoOpportunity(t *testing.T) {
	// min_request_mcpu = 5; request = 4 → below minimum, should not flag
	stat := PodStats{
		Name:              "pod-tiny",
		CPUUsage:          1,
		CPURequest:        4,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu != nil {
		t.Error("expected no opportunity when request <= min_request_mcpu")
	}
}

func TestApplyWasteAnalysis_EfficientPod_NoOpportunity(t *testing.T) {
	// overprovisioned_warning=60: usage must be < 40% of request to flag.
	// request=100, usage=50 → 50% usage → above threshold → not flagged.
	stat := PodStats{
		Name:              "pod-efficient",
		CPUUsage:          50,
		CPURequest:        100,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu != nil {
		t.Errorf("expected no opportunity for efficient pod (50%% usage), got saving=%d", *result.PotentialSavingMCpu)
	}
}

func TestApplyWasteAnalysis_WastedPod_HasOpportunity(t *testing.T) {
	// overprovisioned_warning=60: usage < 40% of request → flagged.
	// request=100, usage=10 → 10% usage → flagged, saving=90, wastePct=90%.
	stat := PodStats{
		Name:              "pod-wasteful",
		CPUUsage:          10,
		CPURequest:        100,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu == nil {
		t.Fatal("expected opportunity for wasted pod")
	}
	if *result.PotentialSavingMCpu != 90 {
		t.Errorf("expected saving=90, got %d", *result.PotentialSavingMCpu)
	}
	if result.Opportunity != "-90m" {
		t.Errorf("expected opportunity='-90m', got '%s'", result.Opportunity)
	}
	if result.WastePct != 90.0 {
		t.Errorf("expected wastePct=90.0, got %.1f", result.WastePct)
	}
	// waste=90% >= warning(60)+20=80 → critical
	if result.Severity != "critical" {
		t.Errorf("expected severity='critical' for 90%% waste, got '%s'", result.Severity)
	}
}

func TestApplyWasteAnalysis_ExactBoundary_NoOpportunity(t *testing.T) {
	// overprovisioned_warning=60 → threshold = 40% of request.
	// request=100, usage=40 → exactly at threshold → NOT flagged (< required).
	stat := PodStats{
		Name:              "pod-boundary",
		CPUUsage:          40,
		CPURequest:        100,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu != nil {
		t.Errorf("expected no opportunity at exact boundary (usage=40, threshold=40), got saving=%d", *result.PotentialSavingMCpu)
	}
}

func TestApplyWasteAnalysis_CustomThreshold(t *testing.T) {
	// Custom threshold: overprovisioned_warning=80 → flag if usage < 20% of request.
	// request=100, usage=15 → 15% < 20% → flagged, saving=85.
	t2 := defaultThresholds()
	t2.Waste.OverprovisionedWarning = 80

	stat := PodStats{
		Name:              "pod-custom",
		CPUUsage:          15,
		CPURequest:        100,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, t2)
	if result.PotentialSavingMCpu == nil {
		t.Fatal("expected opportunity with custom threshold")
	}
	if *result.PotentialSavingMCpu != 85 {
		t.Errorf("expected saving=85, got %d", *result.PotentialSavingMCpu)
	}
}

func TestApplyWasteAnalysis_ZeroUsage_MaxSaving(t *testing.T) {
	// Pod with zero CPU usage should always be flagged (if request > min).
	stat := PodStats{
		Name:              "pod-idle",
		CPUUsage:          0,
		CPURequest:        200,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu == nil {
		t.Fatal("expected opportunity for idle pod")
	}
	if *result.PotentialSavingMCpu != 200 {
		t.Errorf("expected saving=200, got %d", *result.PotentialSavingMCpu)
	}
}

func TestApplyWasteAnalysis_SeverityWarning(t *testing.T) {
	// overprovisioned_warning=60, critical band = 60+20=80%.
	// request=100, usage=35 → saving=65, wastePct=65% → warning (65 < 80).
	stat := PodStats{
		Name:              "pod-warn",
		CPUUsage:          35,
		CPURequest:        100,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu == nil {
		t.Fatal("expected opportunity")
	}
	if result.Severity != "warning" {
		t.Errorf("expected severity='warning' for 65%% waste, got '%s'", result.Severity)
	}
}

func TestApplyWasteAnalysis_SeverityCritical(t *testing.T) {
	// overprovisioned_warning=60, critical band = 60+20=80%.
	// request=100, usage=5 → saving=95, wastePct=95% → critical (95 >= 80).
	stat := PodStats{
		Name:              "pod-crit",
		CPUUsage:          5,
		CPURequest:        100,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu == nil {
		t.Fatal("expected opportunity")
	}
	if result.Severity != "critical" {
		t.Errorf("expected severity='critical' for 95%% waste, got '%s'", result.Severity)
	}
}

func TestApplyWasteAnalysis_WastePctCalculation(t *testing.T) {
	// request=200, usage=60 → saving=140, wastePct=70%
	stat := PodStats{
		Name:              "pod-pct",
		CPUUsage:          60,
		CPURequest:        200,
		CPURequestPresent: true,
	}
	result := applyWasteAnalysis(stat, defaultThresholds())
	if result.PotentialSavingMCpu == nil {
		t.Fatal("expected opportunity")
	}
	if result.WastePct != 70.0 {
		t.Errorf("expected wastePct=70.0, got %.1f", result.WastePct)
	}
}
