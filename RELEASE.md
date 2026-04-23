# Sentinel v1.0.0-rc.2 Release Notes

Release date: 2026-04-23

## Operational Summary

`v1.0.0-rc.2` is a release-readiness hardening candidate. It focuses on consistent versioning, secure-by-default Helm installation, production-first exposure guidance and clearer v1.0 support boundaries.

## Breaking / Operator-Visible Changes

- Helm no longer provides usable credential defaults for production paths.
- `database.password` is required during Helm install/upgrade.
- `agent.auth.token` is required when `agent.auth.enabled=true`.
- The chart default service type is `ClusterIP`; use Ingress for production and explicitly opt into NodePort for dev/lab.
- v1.0 has no public LLM runtime contract. Intelligence-layer work is v1.1 scope.

## Install

```bash
AUTH_TOKEN=$(python3 -c "import secrets; print(secrets.token_hex(32))")
DB_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")

helm install sentinel helm/sentinel -n sentinel --create-namespace \
  --set agent.auth.token="$AUTH_TOKEN" \
  --set database.password="$DB_PASSWORD" \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts[0].host=sentinel.example.com \
  --set ingress.tls[0].secretName=sentinel-tls \
  --set ingress.tls[0].hosts[0]=sentinel.example.com
```

## Upgrade

```bash
helm upgrade sentinel helm/sentinel -n sentinel \
  --reuse-values \
  --set image.tag=1.0.0-rc.2 \
  --set agent.auth.token="$AUTH_TOKEN" \
  --set database.password="$DB_PASSWORD"
```

## Rollback

```bash
helm history sentinel -n sentinel
helm rollback sentinel <REVISION> -n sentinel
kubectl rollout status deployment/sentinel -n sentinel
```

## Quality Gate

Run these checks before tagging the release:

```bash
cd agent && go test ./...
python3 harness/test_output_validator.py
helm lint helm/sentinel --set agent.auth.token=test-token --set database.password=test-password
```

Expected negative check:

```bash
helm lint helm/sentinel
```

This should fail because production credentials are intentionally required.

## Known Limitations

- Metrics Server is required for production-quality metrics, incidents and FinOps calculations.
- TLS between Sentinel and an external PostgreSQL service must be configured via `database.sslmode`.
- Audit logging is not implemented.
- Multi-cluster aggregation is not supported in v1.0.
