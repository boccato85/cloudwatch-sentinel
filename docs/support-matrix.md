# Sentinel Support Matrix

This matrix applies to Sentinel `v1.0.0-rc.2`.

## Supported

| Area | Supported |
|---|---|
| Kubernetes | `v1.19+` with `metrics.k8s.io` available |
| Deployment | Helm 3 chart in a dedicated namespace |
| Exposure | Ingress with TLS in production; port-forward or NodePort for dev/lab only |
| Database | PostgreSQL 15 via bundled chart or external PostgreSQL-compatible service |
| Authentication | `AUTH_ENABLED=true` with explicit `AUTH_TOKEN` |
| Commercial investigation layer | Not supported in v1.0; deterministic rules only |

## Required Dependencies

| Dependency | Requirement |
|---|---|
| Kubernetes API | Reachable from Sentinel agent service account |
| Metrics API (`metrics.k8s.io`) | Required for production-quality metrics, incidents and FinOps |
| PostgreSQL | PostgreSQL 15 compatible endpoint (bundled or external) |
| Helm | Helm 3 for install/upgrade workflows |
| Ingress controller | Required for production-first TLS exposure |

## Validated Environments

| Environment | Validation status |
|---|---|
| Local dev (`docker compose`) | Validated for API/dashboard development workflow |
| Kubernetes dev/lab (`service.type=NodePort`) | Validated for non-production troubleshooting/lab usage |
| Kubernetes production-style (`ClusterIP + Ingress + TLS`) | Validated and recommended primary path |

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
| Multi-cluster aggregation | Post-v1.0 scope |
| Write-path remediation automation | Not supported in v1.0 |
| Production NodePort exposure | Not recommended or supported as the main production path |

## Known Limitations

- Metrics freshness and incident quality depend on `metrics.k8s.io` availability.
- No multi-cluster aggregation in v1.0.
- No public runtime contract for `AlfGuard` in v1.0.
- No write-path remediation automation in v1.0.

## Metrics Server Behavior

Metrics Server is required for production use. Without Metrics Server, Sentinel can still serve the dashboard and API shell, but metrics-backed views, incidents and FinOps calculations are degraded or empty until `metrics.k8s.io` is available.
