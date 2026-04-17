package api

import (
	"fmt"
	"net/http"
	"time"
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
	Status         string                  `json:"status"`
	Version        string                  `json:"version"`
	DBBreakerState string                  `json:"db_breaker_state,omitempty"`
	Checks         map[string]HealthStatus `json:"checks"`
}

type ForecastPoint struct {
	Time    string  `json:"time"`
	ReqCost float64 `json:"reqCost"`
	UseCost float64 `json:"useCost"`
	ReqLow  float64 `json:"reqLow"`
	ReqHigh float64 `json:"reqHigh"`
	UseLow  float64 `json:"useLow"`
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

type EventInfo struct {
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Message   string `json:"message"`
	Age       string `json:"age"`
	Timestamp string `json:"timestamp"`
}
