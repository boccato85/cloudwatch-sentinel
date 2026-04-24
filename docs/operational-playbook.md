# Sentinel Operational Playbook (P1)

This playbook is for operators running Sentinel `v1.0.0-rc.2` in Kubernetes.
It focuses on safe day-2 operations: verify health, backup/restore, upgrade, rollback, and basic troubleshooting.

## Scope

- Deployment model: Helm chart in a dedicated namespace (examples use `sentinel`).
- Production exposure: Ingress + TLS.
- Dev/lab exposure: NodePort only for controlled non-production usage.

## Preconditions

1. `kubectl` context points to the target cluster.
2. Release exists in namespace:

```bash
kubectl get deploy,statefulset,svc -n sentinel
helm list -n sentinel
```

## Daily health checks

### Quick API check

```bash
kubectl port-forward svc/sentinel 8080:8080 -n sentinel
curl -s http://127.0.0.1:8080/health | jq .
```

### Status interpretation (`/health`)

- `status=ok`: core dependencies are healthy.
- `status=degraded`: at least one dependency or collector state is degraded.
- `checks.database.status`: `ok` or `unhealthy`.
- `checks.k8s_api.status`: `ok` or `unhealthy`.
- `checks.metrics_api.status`: `ok` or `unhealthy` (if unhealthy, metrics-backed views degrade).
- `checks.collector.status`:
  - `ok`: collector is recent.
  - `starting`: first collect has not completed yet.
  - `degraded`: collect stale beyond threshold.

### Pod and rollout check

```bash
kubectl get pods -n sentinel -o wide
kubectl rollout status deployment/sentinel -n sentinel
kubectl get events -n sentinel --sort-by=.lastTimestamp | tail -n 30
```

## PostgreSQL backup and restore

### Discover DB pod

```bash
DB_POD=$(kubectl get pod -n sentinel -l app.kubernetes.io/component=database -o jsonpath='{.items[0].metadata.name}')
echo "$DB_POD"
```

### Logical backup (`pg_dump`)

```bash
kubectl exec -n sentinel "$DB_POD" -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > sentinel_backup.sql
```

### Restore (controlled maintenance window)

```bash
kubectl exec -i -n sentinel "$DB_POD" -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < sentinel_backup.sql
```

After restore:

```bash
kubectl rollout restart deployment/sentinel -n sentinel
kubectl rollout status deployment/sentinel -n sentinel
curl -s http://127.0.0.1:8080/health | jq .
```

## Helm upgrade and rollback

### Upgrade

```bash
helm upgrade sentinel helm/sentinel -n sentinel \
  --reuse-values \
  --set image.tag=1.0.0-rc.2 \
  --set agent.auth.token="$AUTH_TOKEN" \
  --set database.password="$DB_PASSWORD"
kubectl rollout status deployment/sentinel -n sentinel
```

### Rollback

```bash
helm history sentinel -n sentinel
helm rollback sentinel <REVISION> -n sentinel
kubectl rollout status deployment/sentinel -n sentinel
```

## Troubleshooting quick map

- Symptom: `401 Unauthorized` on `/api/*`
  - Check `Authorization: Bearer <AUTH_TOKEN>`.
  - Verify token in chart secret and dashboard session.
- Symptom: `/health` degraded due to `metrics_api`
  - Check Metrics Server availability: `kubectl get apiservices | grep metrics`.
  - Validate `metrics.k8s.io` health before investigating Sentinel logic.
- Symptom: DB unreachable
  - Check database pod events and storage/PVC.
  - Verify DB credentials in release values/secret.
  - For external DB, validate network path and `DB_SSLMODE`.
- Symptom: collector stale
  - Check agent logs for `collector error`:
    `kubectl logs deploy/sentinel -n sentinel --since=15m`.
  - Confirm Kubernetes API and Metrics API connectivity.

## Minimal release/maintenance checklist

1. `cd agent && go test ./...`
2. `python3 harness/test_output_validator.py`
3. `helm lint helm/sentinel --set agent.auth.token=test-token --set database.password=test-password`
4. Run smoke probe against running environment:
   `BASE_URL=https://sentinel.example.com AUTH_TOKEN=<token> ./harness/smoke_api.sh`

