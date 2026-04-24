# Changelog

All notable changes to Sentinel are documented in this file.

## [Unreleased]

### Added
- Operational release notes in `RELEASE.md` with install/upgrade/rollback guidance.
- Public support matrix in `docs/support-matrix.md` with explicit dependencies, validated environments and limitations.
- API smoke test harness usage documented in quality/release docs.
- GitHub Project planning artifacts for post-v1.0 priorities (`P1`, `P2`, `P3`).
- Compatibility and schema evolution docs: `docs/compatibility-policy.md`, `docs/schema-upgrade-strategy.md`.
- Reproducible examples guide and synthetic dataset pack for docs/demos/tests (`docs/reproducible-real-use-examples.md`, `docs/datasets/synthetic/*`).
- Self-observability product guide (`docs/self-observability-guide.md`) with `/health`/`/status` diagnostics and signal interpretation.

### Changed
- Security defaults hardened for Helm/database/auth paths (explicit production secrets).
- Production deployment guidance updated to ingress-first; NodePort positioned as dev/lab-only.
- Dashboard auth UX improved to avoid persistent token storage.
- Dashboard now shows explicit degraded-mode banner when Metrics Server is unavailable, with impact and remediation pointers.
- Dashboard first-run onboarding now includes a guided step-by-step tour (spotlight + next/back/skip), plus token/session guidance, live `/health` interpretation, and support/release/runbook links.
- Guided tour flow refined: closes open drawers between steps to avoid overlay conflicts, and now covers header controls, Recent Incidents, Financial Correlation, and FinOps/Efficiency tabs.
- Roadmap updated with explicit execution track (`P0`-`P3`) and aligned M7 version (`v1.0.0-rc.2`).
- README changelog section trimmed; full history centralized in this `CHANGELOG.md`.
- Public documentation sanitized to keep the repository focused on Sentinel Core OSS.
- Release workflow now generates signed images, SPDX SBOM, and SBOM attestations.
- Helm values schema strengthened for deployment/security validation (service, sslmode, ingress, retention, auth).

### Fixed
- CI quality gates and project sync workflow behavior for manual dispatch/token permissions.
- UI cleanup: removed debug leftovers and explicit no-op catches for safer frontend hygiene.

### Removed
- Unused optional enrichment package from the public OSS runtime.

## [v1.0.0-rc.2] - 2026-04-23

### Changed
- Release alignment to `v1.0.0-rc.2` and final pre-release hardening.
- Security fixes from static analysis findings (XSS and command-injection related paths).
- Documentation clarified cluster assumptions (generic Kubernetes deployment, not Minikube-specific).

### Breaking / Operator-visible
- v1.0 remains deterministic-only; `AlfGuard` is outside the public runtime contract.

### Known limitations
- Metrics Server is required for production-quality metrics and incidents.
- Multi-cluster aggregation is not supported in v1.0.
- Write-path remediation automation is not supported in v1.0.

### Notes
- Tag-backed release: `v1.0.0-rc.2`.

## [v1.0-rc1]

### Changed
- OpenAPI spec completed with all 15 endpoints documented (schemas, securitySchemes and reusable responses).
- README corrected for setup, API endpoint table, Go version and ranges.
- Added `CONTRIBUTING.md` with dev setup, architecture constraints, commit conventions and PR boundaries.
- GHCR release pipeline in `release.yml` builds and pushes `ghcr.io/boccato85/sentinel` on semver tags.
- Added root `docker-compose.yml` for local development without Minikube (agent + PostgreSQL).
- Dockerfile builder pinned to `golang:1.25-alpine`; runtime updated to `alpine:3.21`.
- ROADMAP updated for post-v1.0 planning.
- Incident narrative strings translated from PT-BR to English in backend.
- CI updated to `go-version: 1.25`.
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
- Fixed latent nil-pointer risk in optional enrichment facade.
- Added disabled-mode tests for optional enrichment branches.
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
- Added "By Deployment" mode in Waste Analysis drawer (aggregates by `app` label).
- Added "By Pod | By Deployment" toggle.

## [v0.10.14]

### Changed
- Added Namespace Efficiency Score panel with A→F grades.
- Added inline glossary card ("What these metrics mean").

## [v0.10.1]

### Added
- `/health` endpoint with DB and collector status.
- 22 automated tests.

## Historical notes

- `v1.0.0-rc.2` and `v1.0-rc1` are the tag-backed release references used in this repository.
- Earlier `v0.x` entries are maintained as historical milestone checkpoints from the project evolution and may not map 1:1 to git tags.
