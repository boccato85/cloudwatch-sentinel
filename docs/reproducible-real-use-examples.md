# Reproducible Real-Use Examples (P2)

This guide provides practical, repeatable examples to evaluate Sentinel without relying only on screenshots.

## 1. Hello-cluster scenario (quick baseline)

Goal: validate install, auth, health, incidents and waste endpoints in a clean baseline.

### Steps

1. Deploy Sentinel (Helm or docker compose).
2. Ensure `AUTH_TOKEN` is set.
3. Run smoke checks:

```bash
BASE_URL=http://localhost:8080 AUTH_TOKEN=<token> ./harness/smoke_api.sh
```

4. Confirm baseline responses:

```bash
curl -s -H "Authorization: Bearer <token>" http://localhost:8080/health | jq .
curl -s -H "Authorization: Bearer <token>" http://localhost:8080/api/summary | jq .
curl -s -H "Authorization: Bearer <token>" http://localhost:8080/api/incidents | jq .
```

### Success criteria

- `/health` responds with `status` and `checks`.
- `/api/summary` returns cluster/pod aggregates.
- `/api/incidents` responds deterministically (possibly empty if no active incidents).
- `/api/waste` responds deterministically (possibly empty if no actionable waste yet).

## 2. Synthetic dataset pack

Use these files when you need deterministic examples for docs, demos or parser tests:

- `docs/datasets/synthetic/health-degraded-metrics-api.json`
- `docs/datasets/synthetic/incidents-highcpu-and-waste.json`
- `docs/datasets/synthetic/waste-by-deployment.json`

These datasets are synthetic and not captured from production.

### Quick inspection

```bash
jq . docs/datasets/synthetic/health-degraded-metrics-api.json
jq . docs/datasets/synthetic/incidents-highcpu-and-waste.json
jq . docs/datasets/synthetic/waste-by-deployment.json
```

## 3. Incident walkthrough (symptom -> root cause -> fix -> verify)

Example: `HighCPU` alert on a pod.

### Symptom

- Sentinel shows `HighCPU`/critical severity for a workload.
- Resource pressure is visible in overview/incidents.

### Investigation

```bash
kubectl top pod -n <namespace> <pod>
kubectl describe pod -n <namespace> <pod>
curl -s -H "Authorization: Bearer <token>" http://localhost:8080/api/incidents | jq .
```

### Likely root cause patterns

- Request too low for normal workload profile.
- Sudden traffic increase.
- Noisy-neighbor effects on the node.

### Example fix path

1. Adjust `resources.requests.cpu`/`limits.cpu`.
2. If applicable, scale replicas for burst handling.
3. Re-check if incident severity drops from critical/high.

### Verification

```bash
curl -s -H "Authorization: Bearer <token>" http://localhost:8080/api/incidents | jq .
curl -s -H "Authorization: Bearer <token>" http://localhost:8080/api/waste | jq .
```

## 4. Troubleshooting examples

### A. `401 Unauthorized` on `/api/*`

- Check Bearer token format.
- Validate current session token.
- Confirm `AUTH_ENABLED`/`AUTH_TOKEN` values in deployment.

### B. `/health` degraded due to `metrics_api`

- Verify Metrics Server availability:

```bash
kubectl get apiservices | grep metrics
```

- Sentinel remains reachable, but metrics-backed panels/incidents can be partial or empty.

### C. Empty data after fresh install

- Collector may still be in `starting` state.
- Wait one or more collection cycles and re-check `/health`.

## 5. Value demonstration in 5 minutes

Use this sequence to show practical value quickly:

1. Run smoke API checks.
2. Open dashboard and locate top consumers (CPU/memory).
3. Inspect `/api/waste` for immediate rightsizing candidates.
4. Inspect `/api/incidents` for deterministic operational signals.
5. Validate `/status` and `/health` for operator readiness.

This demonstrates Sentinel's deterministic baseline: observability + FinOps + incident signal without external monitoring stacks.

