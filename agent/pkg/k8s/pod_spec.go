package k8s

import (
	corev1 "k8s.io/api/core/v1"
)

type PodSpec struct {
	CPUReq, CPULim, MemReq, MemLim int64
	AppLabel                       string
	NodeName                       string
	Phase                          string
	ReqFound                       bool
}

func BuildPodSpecMap(pods []corev1.Pod) map[string]map[string]PodSpec {
	result := make(map[string]map[string]PodSpec)
	for _, p := range pods {
		var totalCPUReq, totalCPULim, totalMemReq, totalMemLim int64
		cpuReqPresent := false
		for _, c := range p.Spec.Containers {
			cpuR := c.Resources.Requests.Cpu().MilliValue()
			cpuL := c.Resources.Limits.Cpu().MilliValue()
			memR := c.Resources.Requests.Memory().Value() / 1024 / 1024
			memL := c.Resources.Limits.Memory().Value() / 1024 / 1024

			totalCPUReq += cpuR
			totalCPULim += cpuL
			totalMemReq += memR
			totalMemLim += memL
			if cpuR > 0 {
				cpuReqPresent = true
			}
		}
		if result[p.Namespace] == nil {
			result[p.Namespace] = make(map[string]PodSpec)
		}
		result[p.Namespace][p.Name] = PodSpec{
		        CPUReq:   totalCPUReq,
		        CPULim:   totalCPULim,
		        MemReq:   totalMemReq,
		        MemLim:   totalMemLim,
		        AppLabel: p.Labels["app"],
		        NodeName: p.Spec.NodeName,
		        ReqFound: cpuReqPresent,
		}	}
	return result
}
lt
}
