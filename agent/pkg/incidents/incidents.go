package incidents

import (
	"fmt"
	"log/slog"
	"os"

	"gopkg.in/yaml.v2"
)

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

func LoadThresholds(path string) Thresholds {
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

func AnalyzeWaste(cpuRequestPresent bool, cpuRequest, cpuUsage int64, t Thresholds) (saving *int64, opportunity string, wastePct float64, severity string) {
	if !cpuRequestPresent {
		return nil, "", 0, ""
	}
	if cpuRequest <= t.Waste.MinRequestMCpu {
		return nil, "", 0, ""
	}
	usageThreshold := int64(float64(cpuRequest) * (1.0 - t.Waste.OverprovisionedWarning/100.0))
	if cpuUsage < usageThreshold {
		s := cpuRequest - cpuUsage
		opportunity = fmt.Sprintf("-%dm", s)
		wastePct = (float64(s) / float64(cpuRequest)) * 100.0

		criticalThreshold := t.Waste.OverprovisionedWarning + 20.0
		if wastePct >= criticalThreshold {
			severity = "critical"
		} else {
			severity = "warning"
		}
		return &s, opportunity, wastePct, severity
	}
	return nil, "", 0, ""
}
