# Sentinel Security Hardening Guide (P1)

This guide complements `SECURITY.md` with practical operator hardening steps for `v1.0.0-rc.2`.

## 1. Token handling model

Current behavior in dashboard (`agent/static/js/01-init.js`):

- Token can be provided interactively or via `?token=...` for controlled dev usage.
- Token is stored in `sessionStorage` (tab-scoped).
- If `?token=...` is used, Sentinel removes it from the URL using `history.replaceState`.
- API requests use `Authorization: Bearer <token>`.

Operational recommendations:

1. Keep `AUTH_ENABLED=true` in production.
2. Generate 32-byte+ random token:
   `python3 -c "import secrets; print(secrets.token_hex(32))"`.
3. Rotate token on a fixed cadence or after operator offboarding.
4. Avoid sharing tokenized URLs outside controlled environments.

## 2. Secret and token rotation

Helm-managed rotation example:

```bash
NEW_AUTH_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
NEW_DB_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")

helm upgrade sentinel helm/sentinel -n sentinel \
  --reuse-values \
  --set agent.auth.token="$NEW_AUTH_TOKEN" \
  --set database.password="$NEW_DB_PASSWORD"

kubectl rollout status deployment/sentinel -n sentinel
```

Post-rotation checks:

```bash
kubectl get pods -n sentinel
kubectl logs deploy/sentinel -n sentinel --since=10m
```

## 3. Minimum production hardening baseline

- Exposure:
  - Use `service.type=ClusterIP`.
  - Expose via Ingress + TLS.
  - Do not use NodePort as production path.
- Authentication:
  - Keep `AUTH_ENABLED=true`.
  - Do not deploy with empty or weak `AUTH_TOKEN`.
- RBAC:
  - Review cluster-wide permissions in `helm/sentinel/templates/rbac.yaml`.
  - Restrict deployment to trusted clusters/namespaces.
- Runtime:
  - Keep image pinned to a known tag.
  - Keep `LOG_LEVEL=info` (avoid `debug` in production).
- Storage:
  - Use persistent storage for PostgreSQL.
  - Keep regular logical backups (`pg_dump`) and restore drill cadence.

## 4. Audit logging status (current limitation)

Sentinel currently provides structured request/application logs (`slog`), but does not implement full security audit trails (for example, per-user auth events with identity provenance and immutable audit sinks).

Recommendation:

- Forward container logs to a centralized logging backend.
- Keep retention and access controls in that backend.
- Treat "full audit logging" as a tracked post-v1.0 maturity item.

## 5. TLS guidance for Agent <-> Database

Sentinel supports PostgreSQL TLS mode via `DB_SSLMODE` / chart `database.sslmode`.

- Dev/lab local setup can use `disable`.
- Production with external PostgreSQL should use at least `require`.
- If your DB endpoint supports certificate validation, prefer stricter modes supported by your PostgreSQL deployment policy.

Helm example:

```bash
helm upgrade sentinel helm/sentinel -n sentinel \
  --reuse-values \
  --set database.sslmode=require
```

Validation:

```bash
kubectl exec -n sentinel deploy/sentinel -- printenv DB_SSLMODE
kubectl logs deploy/sentinel -n sentinel --since=10m | grep -i ssl
```

