# Sentinel Self-Observability Guide (P2)

Sentinel observes Kubernetes workloads and also exposes operational signals about itself.
This guide turns those signals into a practical diagnostic workflow.

## Why this matters

Self-observability reduces guesswork during incidents:

- Is Sentinel unhealthy, or is the cluster unhealthy?
- Is data stale due to collector lag?
- Is the issue database, Kubernetes API, or Metrics API?

In Sentinel OSS, this is intentionally first-class via `/health`, `/status`, and structured logs.

## Core self-observability surfaces

### 1. `/health` (machine-readable state)

`/health` returns:

- `status`: `ok` or `degraded`
- `db_breaker_state`: database breaker state
- `checks.database`
- `checks.k8s_api`
- `checks.metrics_api`
- `checks.collector`

Quick probe:

```bash
curl -s http://localhost:8080/health | jq .
```

### 2. `/status` (operator-friendly view)

`/status` provides a visual status page for fast triage.
Use it when you need a quick view without parsing JSON.

### 3. Structured logs (`slog`)

Sentinel emits structured logs with component context.
Useful filters:

```bash
kubectl logs deploy/sentinel -n sentinel --since=15m | grep -E "component|collector|health|db|k8s"
```

## Signal interpretation map

### `checks.database.unhealthy`

Likely causes:

- database pod unavailable
- credential mismatch
- network/storage issue

Next checks:

```bash
kubectl get pods -n sentinel -l app.kubernetes.io/component=database
kubectl describe pod -n sentinel -l app.kubernetes.io/component=database
```

### `checks.k8s_api.unhealthy`

Likely causes:

- API server connectivity/RBAC issues

Next checks:

```bash
kubectl auth can-i list pods --as=system:serviceaccount:sentinel:sentinel
kubectl get --raw=/readyz
```

### `checks.metrics_api.unhealthy`

Likely causes:

- Metrics Server unavailable or degraded

Impact:

- metrics-backed views, incidents, and FinOps signals can degrade or become empty

Next checks:

```bash
kubectl get apiservices | grep metrics
kubectl top nodes
```

### `checks.collector.degraded`

Likely causes:

- collector cannot complete cycles in expected interval
- upstream dependency errors (k8s/metrics/db)

Next checks:

```bash
kubectl logs deploy/sentinel -n sentinel --since=15m | grep "collector error"
```

## Diagnostic examples

### Example A: dashboard mostly empty

1. Check `/health`.
2. If `metrics_api` is unhealthy, treat as Metrics Server dependency issue.
3. Confirm Sentinel is reachable and auth/API still works.
4. Remediate Metrics Server before changing Sentinel thresholds or chart values.

### Example B: incidents stale after restart

1. Check `checks.collector`.
2. If `starting`, wait one or more collection cycles.
3. If `degraded`, inspect collector logs and dependent checks in `/health`.

### Example C: false assumption of full outage

1. `/status` shows partial degradation, not full outage.
2. Validate core APIs (`/api/summary`, `/api/incidents`) individually.
3. Scope remediation to failing component only.

## Product positioning notes

Self-observability is not an extra page; it is part of Sentinel's operational contract:

- deterministic health states for automation and scripts
- human-readable status for quick triage
- structured logs for evidence-driven debugging

This is part of Sentinel's standalone-first value: no external observability stack is required to diagnose Sentinel itself.

