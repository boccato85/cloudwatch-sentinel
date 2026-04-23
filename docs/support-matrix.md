# Sentinel Support Matrix

This matrix applies to Sentinel `v1.0-rc2`.

## Supported

| Area | Supported |
|---|---|
| Kubernetes | `v1.19+` with `metrics.k8s.io` available |
| Deployment | Helm 3 chart in a dedicated namespace |
| Exposure | Ingress with TLS in production; port-forward or NodePort for dev/lab only |
| Database | PostgreSQL 15 via bundled chart or external PostgreSQL-compatible service |
| Authentication | `AUTH_ENABLED=true` with explicit `AUTH_TOKEN` |
| Intelligence layer | Not supported in v1.0; deterministic rules only |

## Tested

| Area | Evidence |
|---|---|
| Go unit tests | `cd agent && go test ./...` |
| Harness safety tests | `python3 harness/test_output_validator.py` |
| Helm rendering/lint | `helm lint helm/sentinel --set agent.auth.token=test-token --set database.password=test-password` |
| Chaos/lab evidence | `docs/reports/2026-04-22-m6-chaos-lab-stress-test.md` |
| Capacity planning evidence | `docs/reports/2026-04-22-capacity-planning-online-boutique.md` |

## Not Supported

| Area | Status |
|---|---|
| Prometheus/Grafana dependency mode | Not planned for v1.0; Sentinel is standalone-first |
| Local LLM runtimes | Not supported; provider-agnostic cloud intelligence is future v1.1 scope |
| Multi-cluster aggregation | Post-v1.0 scope |
| Write-path remediation automation | Not supported in v1.0 |
| Production NodePort exposure | Not recommended or supported as the main production path |

## Metrics Server Behavior

Metrics Server is required for production use. Without Metrics Server, Sentinel can still serve the dashboard and API shell, but metrics-backed views, incidents and FinOps calculations are degraded or empty until `metrics.k8s.io` is available.
