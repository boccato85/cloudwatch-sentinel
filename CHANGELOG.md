# Changelog

All notable changes to Sentinel are documented in this file.

## [v1.0.0-rc.2] - 2026-04-23

### Added
- Operational release notes in `RELEASE.md` with install/upgrade/rollback guidance.
- Public support matrix in `docs/support-matrix.md` with supported, tested and not-supported boundaries.
- API smoke test harness via `harness/smoke_api.sh`.

### Changed
- Docs/runtime alignment: setup paths use root `.env.example`; agent management docs match real Makefile targets.
- Helm hardening: GHCR image defaults, explicit database password requirement and cleaned `values.yaml` structure.
- Production-first deploy: chart defaults to `ClusterIP`, adds Ingress rendering and documents NodePort as dev/lab only.
- Rate limiting now uses the remote address observed by the agent; forwarded IP headers are ignored in v1.0.

### Breaking / Operator-visible
- `database.password` must be explicitly provided for Helm install/upgrade.
- `agent.auth.token` must be explicitly provided when `agent.auth.enabled=true`.
- NodePort is no longer the primary production exposure path.
- v1.0 remains deterministic-only; provider-agnostic cloud intelligence is M8 scope.

### Known limitations
- Metrics Server is required for production-quality metrics and incidents.
- Multi-cluster aggregation is not supported in v1.0.
- Write-path remediation automation is not supported in v1.0.

## [v1.0-rc1]

### Changed
- OpenAPI spec completed with all 15 endpoints documented (schemas, securitySchemes and reusable responses).
- README corrected for setup, API endpoint table, Go version and ranges.
- Added `CONTRIBUTING.md` with dev setup, architecture constraints, commit conventions and PR boundaries.
- GHCR release pipeline in `release.yml` builds and pushes `ghcr.io/boccato85/sentinel` on semver tags.
- Added root `docker-compose.yml` for local development without Minikube (agent + PostgreSQL).
- Dockerfile builder pinned to `golang:1.25-alpine`; runtime updated to `alpine:3.21`.
- ROADMAP M8 rewritten to the agentic investigation workflow model.
- Incident narrative strings translated from PT-BR to English in backend.
- CI updated to `go-version: 1.25` and `eval/gemini` trigger path.
- Screenshots refreshed with v1.0-rc1 visuals (replacing v0.10.x references).
- `SECURITY.md` supported version and `AUTH_ENABLED` default corrected.

## [v0.50.6]

### Changed
- Status Ribbon replaced context bar with persistent version, namespace and sync state.
- FinOps correlation chart enhanced (Budget vs Actual + forecast overlay).
- Host security hardening with stronger CSP headers and XSS mitigations.

## [v0.50]

### Changed
- M6 closed with Online Boutique validation under 1000-user load.
- Added Chaos Lab report documenting throttling, OOMKill risk and resource waste escalation.
- UI prioritization verified under stress (CRITICAL/HighCPU behavior).

## [v0.36]

### Changed
- HighCPU fallback detects pods without `resources.requests.cpu` using node allocatable percentages (#13).
- CRITICAL and HighCPU incidents bypass system-namespace/time filters in drawers (#18).
- Recent Incidents table sorting improvements and waste/age display fixes.
- Cleanup of redundant namespace selectors and JS cache-busting fixes.

## [v0.35]

### Changed
- Security (JS): copy button in Alerts drawer uses `data-runbook` + `addEventListener` (DOMPurify-safe).
- Runbooks: `ErrImagePull` and `CreateContainerConfigError` now use `kubectl describe pod` instead of logs.
- Fixed latent nil-pointer risk in disabled intelligence provider facade.
- Added `pkg/llm` unit tests for disabled-mode branches (Go: 14; harness: 23; total: 37).
- Swapped M6/M7 sequencing in roadmap (real lab before docs/polish stabilization).

## [v0.34]

### Changed
- Added auto-scaling Honeycomb map for cluster visual density.
- Added node detail drawer with CPU/memory saturation bars and pod listing.
- Improved UX navigation with back buttons.
- Added robust event delegation for dynamic re-renders and sanitized DOM interactions.

## [v0.12]

### Changed
- Security hardening: `AUTH_TOKEN` fail-fast, `/health` disclosure fix, XSS mitigation, Helm `required` guard.
- M5 foundation: `Narrative` field on `Incident`; harness remediation guard.
- Infrastructure: JS modularization (7 modules), `embed.FS` + `http.FileServer`.

## [v0.11]

### Changed
- Dashboard v2 no-scroll layout.
- FinOps/Efficiency toggle with line chart and donut breakdown.
- Recent Events tile with full drawer, search and filters.

## [v0.10.15]

### Changed
- Added "By Deployment" mode in Waste Intelligence drawer (aggregates by `app` label).
- Added "By Pod | By Deployment" toggle.

## [v0.10.14]

### Changed
- Added Namespace Efficiency Score panel with A→F grades.
- Added inline glossary card ("What these metrics mean").

## [v0.10.1]

### Added
- `/health` endpoint with DB and collector status.
- 22 automated tests.
