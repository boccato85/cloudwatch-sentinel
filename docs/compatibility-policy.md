# Sentinel Compatibility Policy

This policy defines compatibility expectations for Sentinel OSS runtime releases.

## Scope

- Applies to the public Sentinel repository and release artifacts.
- Covers Kubernetes/runtime compatibility, API contract stability, and Helm chart behavior.

## Versioning policy

- Sentinel uses SemVer-style tags for release artifacts.
- `v1.0.0-rc.x` tags are release candidates and may still receive hardening changes before final `v1.0.0`.
- Breaking changes are not expected inside the same major line without explicit release notes.

## Kubernetes and deployment compatibility

- Supported baseline is documented in [docs/support-matrix.md](support-matrix.md).
- Minimum cluster support target remains Kubernetes `v1.19+`.
- Production path compatibility target:
  - Helm 3
  - `ClusterIP + Ingress + TLS`
  - Explicit auth and DB secrets

## API compatibility

- Public API contract source of truth is `agent/pkg/api/openapi.yaml` (mirrored in `docs/api/openapi.yaml`).
- New endpoints and fields should be additive.
- Existing endpoint removals or incompatible schema changes require explicit release-note callout and upgrade guidance.

## Helm chart compatibility

- Chart values must pass schema validation (`helm/sentinel/values.schema.json`).
- Security-sensitive values (e.g. `database.password`, auth token when enabled) remain explicit and required.
- Defaults may evolve for safety, but must be documented in `RELEASE.md` and `CHANGELOG.md`.

## Container supply chain expectations

- Release images are published to GHCR.
- Release workflow produces:
  - OCI image signature (keyless via OIDC/cosign).
  - SBOM (SPDX JSON).
  - SBOM attestation bound to image digest.

## Deprecation policy

- Deprecated behavior should be documented at least one release before removal where feasible.
- Deprecation notices should appear in:
  - `CHANGELOG.md` (`Unreleased` section)
  - `RELEASE.md` for the tagged release
  - Relevant docs (`README`/support matrix) when operationally relevant

