# Sentinel Database Schema Upgrade Strategy

This strategy defines how Sentinel evolves PostgreSQL schema safely across releases.

## Current model (`v1.0.0-rc.2`)

- Schema bootstrap is executed at agent startup via `store.EnsureSchema(...)`.
- Changes are expected to be additive and backward-compatible.
- If schema verification fails, agent enters degraded operational posture with explicit logs.

## Upgrade principles

1. Expand first, migrate second, remove last.
2. Prefer additive changes:
   - New nullable columns
   - New tables/indexes
   - New views/materializations
3. Avoid destructive DDL in normal startup path.
4. Keep read paths tolerant while data backfill catches up.

## Safe rollout sequence

1. Backup database (`pg_dump`) before upgrade.
2. Apply release via Helm upgrade.
3. Verify rollout and `/health`.
4. Monitor logs for schema/SQL warnings.
5. Validate dashboards/API on key ranges (`30m`, `24h`, `7d`).

## Breaking schema changes (post-v1.0 planning)

If a truly breaking schema change is required:

1. Introduce dual-read/dual-write compatibility window.
2. Provide an explicit migration tool/script path.
3. Document maintenance-window requirements.
4. Publish rollback implications in `RELEASE.md`.

Breaking schema transitions should not be hidden inside routine startup bootstrap.

## Rollback posture

- Helm rollback restores previous app manifests, not database state.
- Database rollback requires restore from backup.
- For this reason, schema evolution must preserve backward read compatibility for at least one rollback window when feasible.

## Operator checklist

- Pre-upgrade backup confirmed.
- Release notes reviewed for schema-impact flags.
- Post-upgrade `/health` and API smoke checks passed.
- Retention/aggregation jobs healthy after upgrade window.

