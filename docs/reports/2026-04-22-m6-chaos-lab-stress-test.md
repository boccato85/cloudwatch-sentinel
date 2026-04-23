# M6 Chaos Lab Report: Online Boutique

## Executive Summary
As part of Milestone 6 (M6 - Real Lab / QA / Prod-Like), the `google-demo` stack was subjected to severe stress testing (1000 concurrent users, limit restrictions, false overprovisioning). We successfully validated Sentinel's resilience and detection logic under extreme high load and resource starvation conditions.

## Fault Injection Scenarios
1. **Massive Load Injection**: `loadgenerator` scaled to 10 replicas and patched to trigger `USERS=1000`.
2. **Memory Starvation (OOMKill Risk)**: `currencyservice` limits restricted to 100Mi RAM.
3. **Artificial Horizontal Scaling**: `emailservice` forced to 6 replicas to generate massive Resource Waste.

## Sentinel Observations

| Affected Component | Identified Issue | Severity | Sentinel UI Behavior |
|--------------------|------------------|----------|----------------------|
| **frontend** | CPU usage at 150.0% of request (danger of throttling) | CRITICAL / HIGHCPU | Displayed at absolute top, bypassing namespace and time-range filters. |
| **currencyservice** | Memory usage at 93.0% of LIMIT (danger of OOMKill) | CRITICAL / HIGHMEMORY | Reported lethal proximity to limit, ignoring "Resource Waste" to prioritize real failure. |
| **google-demo (NS)** | 46 Waste Opportunities detected | WARNING | FinOps Budget line exceeded, indicating 96% of costs wasted on overhead. |

## Technical Analysis (Sentinel v0.50)
Sentinel achieved absolute success in dynamic diagnosis during Chaos Engineering. The visual heuristics confirmed that incidents based on Resource Limits (HighCPU and OOMKill risk) successfully pierced through the "Waste" noise, granting SREs immediate visibility during chronic incidents.

## Remediation Plan (Runbook)
1. **Load Normalization**: Scale down `loadgenerator` replicas and USERS count.
2. **CurrencyService Rescue**: Increase Memory Limits to prevent OOMKill.
3. **Waste Reduction**: Return `emailservice` to 1 replica.
