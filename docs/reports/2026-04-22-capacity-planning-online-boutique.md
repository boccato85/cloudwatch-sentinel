# Capacity Planning: Online Boutique (google-demo)

## Executive Summary
Several Online Boutique microservices were identified as operating with **Memory Undersizing** (Actual Usage > Reserved Request). This state places the cluster at high risk of instability and unexpected pod evictions.

## Undersized Pods (Usage > Request)

| Pod | Current Usage (Mi) | Request (Mi) | % of Request | SRE Risk |
|-----|--------------------|--------------|--------------|----------|
| **currencyservice** | 101 Mi | 64 Mi | **157%** | CRITICAL |
| **paymentservice** | 89 Mi | 64 Mi | **139%** | CRITICAL |
| **cartservice** | 93 Mi | 64 Mi | **145%** | CRITICAL |
| **emailservice** | 72 Mi | 64 Mi | **112%** | WARNING |
| **sentinel-postgresql** | 158 Mi | 128 Mi | **123%** | CRITICAL |

## Technical Analysis (Sentinel v0.50)
Online Boutique uses an aggressive resource configuration (low requests). When usage exceeds the request, the pod begins utilizing unreserved node memory. During high load or node resource exhaustion scenarios, the Kubelet prioritizes terminating pods consuming resources above their reservation (Eviction).

## Remediation Plan (Runbook)
1. **Rightsizing Adjustment**: Increase `resources.requests.memory` to at least 120% of the current observed usage.
2. **Patch Example (CurrencyService)**:
   ```bash
   kubectl patch deployment currencyservice -n google-demo --patch '{"spec":{"template":{"spec":{"containers":[{"name":"server","resources":{"requests":{"memory":"128Mi"}}}]}}}}'
   ```
3. **Monitoring**: Verify if the status in the Sentinel Dashboard returns to **OK** (Usage < 75% of Request).
