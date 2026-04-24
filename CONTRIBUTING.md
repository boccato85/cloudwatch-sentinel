# Contributing to Sentinel

Thank you for your interest in contributing. Sentinel is a focused SRE/FinOps tool — contributions that add complexity without clear operational value will be declined. Read the guiding principles in [ROADMAP.md](ROADMAP.md) before starting.

---

## Prerequisites

- Go 1.25+
- Helm 3
- Docker or Podman
- A Kubernetes cluster with Metrics Server enabled (for cluster-based dev); or docker-compose for local UI/API dev without a cluster

---

## Dev setup

**Local (no cluster required):**
```bash
git clone https://github.com/boccato85/Sentinel
cd Sentinel
cp .env.example .env   # fill DB_PASSWORD and AUTH_TOKEN (no defaults)
docker compose up --build
# Dashboard: http://localhost:8080/?token=<AUTH_TOKEN>
```

**Cluster-based:**

See the Helm setup in [README.md](README.md#setup). Ensure your kubeconfig points to the target cluster before running `helm install`.

---

## Running tests

All tests run from the `agent/` directory:

```bash
cd agent
go test ./...          # all packages
go test -v ./...       # verbose
go test ./pkg/store/...    # single package
```

Harness tests (Python):

```bash
python3 harness/test_output_validator.py
```

Smoke test for a running local or deployed agent:

```bash
BASE_URL=http://localhost:8080 AUTH_TOKEN=<token> ./harness/smoke_api.sh
```

CI runs both `go test -v ./...` and `helm lint helm/sentinel --set agent.auth.token=test-token --set database.password=test-password` on pushes to `main`/`develop` and PRs to `main`. Ensure both pass locally before opening a PR.

---

## Architecture constraints

These constraints exist for operational reasons — do not work around them:

| Constraint | Reason |
|---|---|
| Deterministic rules are the product baseline | Sentinel must stay useful without `AlfGuard` |
| No inline `onclick` in HTML | CSP `script-src-attr 'none'` blocks them — use `addEventListener` in a JS module |
| All JS edits via Write tool or Python | Unicode characters in JS files cause silent corruption with some edit tools |
| `agentVersion` is hardcoded | Increment it manually in `agent/main.go` on every release |
| Cache-busting `?v=X.XX` in dashboard.html | Update both JS and CSS versions together on every release |
| No system namespace noise | `kube-system`, `kubernetes-dashboard`, etc. are excluded by default from governance panels |
| `UNMANAGED` is its own grade | Pods without `resources.requests` are not grade F — they are a scheduler blind spot |

---

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Common scopes: `api`, `ui`, `k8s`, `store`, `incidents`, `helm`, `docs`, `m7`

Examples:
```
feat(api): add /api/events endpoint
fix(ui): prevent XSS in drawer namespace label
docs(m7): complete OpenAPI spec with missing endpoints
chore: bump agentVersion to 0.51.0
```

---

## Pull request guidelines

1. One logical change per PR — avoid mixing features with unrelated cleanup.
2. All tests must pass (`go test ./...`, harness tests and `helm lint` with explicit auth and database secrets).
3. If you add or change an API endpoint, update `agent/pkg/api/openapi.yaml`.
4. If you add a new env var, document it in the Environment Variables table in `README.md`.
5. Do not bump `agentVersion` in a feature PR — version bumps are done separately as release commits.
6. Do not commit local agent/tooling files — these are dev workflow artifacts, not product code.

---

## What we won't accept

- Multi-cluster support (post-1.0 scope)
- Local model runtimes or GPU-dependent features
- Prometheus or Grafana integration (violates standalone-first principle)
- Breaking changes to existing API response schemas
- Features that require `AlfGuard` to be useful

---

## Release tagging

Tags trigger the GHCR image pipeline (`release.yml`). Always use three-part semver:

```
v1.0.0        # stable release
v1.1.0-rc1    # release candidate
v1.2.0-beta1  # beta
```

Two-part tags like `v1.0` cause the semver patterns in `metadata-action` to fail — the `type=ref,event=tag` fallback will still publish the image, but `{{version}}` and `{{major}}.{{minor}}` tags won't be generated.

---

## Security issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.
