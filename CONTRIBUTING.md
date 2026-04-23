# Contributing to Sentinel

Thank you for your interest in contributing. Sentinel is a focused SRE/FinOps tool — contributions that add complexity without clear operational value will be declined. Read the guiding principles in [ROADMAP.md](ROADMAP.md) before starting.

---

## Prerequisites

- Go 1.23+
- Minikube with Metrics Server enabled (`minikube addons enable metrics-server`)
- Helm 3
- Podman or Docker (for image builds)

---

## Dev setup

```bash
git clone https://github.com/boccato85/Sentinel
cd Sentinel

# Copy env template and fill in DB credentials
cd agent
make setup   # copies .env.example → .env

# Build and run locally (requires local PostgreSQL)
make start
make logs
```

For cluster-based development, see the Helm setup in [README.md](README.md#setup).

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

CI runs both `go test -v ./...` and `helm lint helm/sentinel` on every push to `main`. Ensure both pass locally before opening a PR.

---

## Architecture constraints

These constraints exist for operational reasons — do not work around them:

| Constraint | Reason |
|---|---|
| Deterministic rules run before LLM | If the LLM is down, Sentinel must still produce useful output |
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

Common scopes: `api`, `ui`, `k8s`, `store`, `incidents`, `llm`, `helm`, `m7`

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
2. All tests must pass (`go test ./...` + `helm lint`).
3. If you add or change an API endpoint, update `agent/pkg/api/openapi.yaml`.
4. If you add a new env var, document it in the Environment Variables table in `README.md`.
5. Do not bump `agentVersion` in a feature PR — version bumps are done separately as release commits.
6. Do not modify `.claude/`, `.gemini/`, or any AI skills files — these are dev tooling, not product artifacts.

---

## What we won't accept

- Multi-cluster support (post-1.0 scope)
- Local Ollama full implementation (post-1.0 scope)
- Prometheus or Grafana integration (violates standalone-first principle)
- Breaking changes to existing API response schemas
- Features that require the LLM layer to be useful

---

## Security issues

Do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the responsible disclosure process.
