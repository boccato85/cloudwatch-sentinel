# Changelog

All notable changes to Sentinel are documented in this file.

## [v1.0.0-rc.2] - 2026-04-23

### Added
- Operational release notes in `RELEASE.md` with install/upgrade/rollback guidance.
- Public support matrix in `docs/support-matrix.md` with supported, tested and not-supported boundaries.
- API smoke test harness via `harness/smoke_api.sh`.

### Changed
- Helm chart defaults are now secure-by-default for production paths.
- Production-first deployment guidance now prioritizes Ingress + TLS.

### Breaking / Operator-visible
- `database.password` must be explicitly provided for Helm install/upgrade.
- `agent.auth.token` must be explicitly provided when `agent.auth.enabled=true`.
- NodePort is no longer the primary production exposure path.

### Known limitations
- Metrics Server is required for production-quality metrics and incidents.
- Multi-cluster aggregation is not supported in v1.0.
- Write-path remediation automation is not supported in v1.0.
