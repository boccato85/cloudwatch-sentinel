# Sentinel

<p align="center">
  <img src="docs/assets/cw_sentinel_logo.png" alt="Sentinel Logo" width="180"/>
</p>

> **Kubernetes SRE intelligence for teams that can't afford a dedicated specialist.**
> Incident detection, waste analysis, cost forecasting and AI-powered explanations — no Prometheus required.

<p align="center">
  <img src="docs/screenshots/sentinel_ss_1.0-rc(1).png" alt="Sentinel Dashboard v1.0-rc1" width="900"/>
</p>

![Status](https://img.shields.io/badge/status-v1.0--rc1-brightgreen)
![Kubernetes](https://img.shields.io/badge/Kubernetes-v1.35.1-blue)
![Go](https://img.shields.io/badge/Go-1.25-00ADD8)
![Standalone](https://img.shields.io/badge/standalone-no%20Prometheus-green)
![Tests](https://img.shields.io/badge/tests-37%20passing-brightgreen)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)

---

## What is Sentinel?

Sentinel is a standalone SRE and FinOps intelligence platform for Kubernetes. It continuously collects metrics via the Kubernetes Metrics API, persists data in PostgreSQL, calculates waste per pod and deployment, scores namespace efficiency and serves an interactive real-time dashboard — with no dependency on Prometheus, Grafana or AlertManager.

**Philosophy:** Observability-first, intelligence-second. If the LLM goes down, Sentinel keeps working through deterministic rules. If the dashboard fails, the API remains usable.

**Two layers:**

- **Go Agent** — standalone binary that collects, persists and exposes a web dashboard (port 8080)
- **LLM Agent (optional)** — analysis layer that consumes the agent API, applies reasoning and generates runbooks

---

## Why Sentinel?

Most small engineering teams overpay for Kubernetes without knowing it. Tools like Kubecost or Harness are built for enterprise budgets and dedicated FinOps teams. Sentinel is built for the SRE or platform engineer who wears multiple hats — reliability, cost, and operations all at once.

- **Zero external monitoring stack** — no Prometheus, no Grafana, no AlertManager
- **FinOps native** — waste per pod and deployment, linear forecast, namespace efficiency grades
- **Deterministic first** — rules detect problems without LLM; optional LLM explains in plain language
- **Simple deploy** — Helm chart, single namespace, up in minutes

---

## Screenshots

| Dashboard Overview | Status Page |
|---|---|
| ![Overview](docs/screenshots/sentinel_ss_1.0-rc(1).png) | ![Status](docs/screenshots/sentinel_ss_1.0-rc(2).png) |

| Incident Detail (HighMemory) | Waste Intelligence |
|---|---|
| ![Incident](docs/screenshots/sentinel_ss_1.0-rc(3).png) | ![Waste](docs/screenshots/sentinel_ss_1.0-rc(4).png) |

| Namespace Efficiency Grades | |
|---|---|
| ![Efficiency](docs/screenshots/sentinel_ss_1.0-rc(5).png) | |

---

## Lab Reports & Evidence

As part of our commitment to transparency and battle-tested engineering, we maintain a collection of technical reports from our chaos experiments and capacity planning sessions.

- [**M6 Chaos Lab Stress Test**](docs/reports/2026-04-22-m6-chaos-lab-stress-test.md) — High load (1000 users) and resource starvation validation.
- [**Capacity Planning: Online Boutique**](docs/reports/2026-04-22-capacity-planning-online-boutique.md) — Rightsizing analysis and memory undersizing detection.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Go Agent (port 8080)              │
│                                                     │
│  continuous collection (~10s) → PostgreSQL          │
│  /api/summary    /api/metrics   /api/history        │
│  /api/forecast   /api/pods      /api/waste          │
│  /api/efficiency /api/incidents /health             │
│  /status         /docs          /openapi.yaml       │
│                                                     │
│  Dashboard: KPIs → tiles → drawers → rightsizing    │
└───────────────────────┬─────────────────────────────┘
                        │ REST API
                        ▼
┌─────────────────────────────────────────────────────┐
│                  LLM Agent (optional)                 │
│  /startup   → checks Minikube + Go agent            │
│  /incident  → LLM analysis + runbook via harness    │
└─────────────────────────────────────────────────────┘
```

---

## Stack

| Layer | Technology |
|---|---|
| Cluster | Minikube (KVM2) — Kubernetes v1.35.1 |
| Agent | Go 1.25 (client-go, net/http, slog, embed) |
| Persistence | PostgreSQL (`sentinel_db`) — runs as a pod in the cluster |
| Dashboard | HTML + CSS + Chart.js (embedded in binary) |
| LLM Agent | Optional — any LLM agent (Claude, Gemini, Minimax…) |

---

## Prerequisites

- Minikube running with Metrics Server enabled
- Go 1.25+ (only for local development without Helm)

> **Note:** PostgreSQL is **not a local prerequisite**. It is provisioned automatically as a pod in the `sentinel` namespace by the Helm chart.

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/boccato85/Sentinel
cd Sentinel
```

### 2. Go Agent

**Option A: deploy on Kubernetes via Helm (recommended)**

```bash
# Build the image
podman build -t localhost/sentinel:1.0-rc1 agent/
podman save localhost/sentinel:1.0-rc1 | minikube image load -

# Deploy (PostgreSQL spins up automatically as a pod)
# IMPORTANT: The deployment name MUST be 'sentinel'
helm install sentinel helm/sentinel -n sentinel-gemini --create-namespace \
  --set image.tag=1.0-rc1 \
  --set image.pullPolicy=Never \
  --set agent.auth.token=<your-secret-token>

# Check pods
kubectl get pods -n sentinel-gemini

# Access (default NodePort: 30080)
minikube ip   # → use http://<minikube-ip>:30080
```

**Option B: standalone (local development)**

```bash
# Requires local PostgreSQL with database sentinel_db
export DB_USER=postgres
export DB_PASSWORD=postgres
export DB_NAME=sentinel_db
export DB_HOST=localhost
export DB_SSLMODE=disable

cd agent
make build   # compile binary
make start   # start service in background
```

Configurable retention:

```bash
export RETENTION_RAW_HOURS=24       # raw metrics (~10s)
export RETENTION_HOURLY_DAYS=30     # hourly aggregates
export RETENTION_DAILY_DAYS=365     # daily aggregates
```

---

## Usage

**Bootstrap:**
```
/startup
```
Checks Minikube and starts the Go agent if needed.

**Incident analysis:**
```
/incident
```
Consumes the Go agent API, applies LLM reasoning and generates a runbook via harness (requires LLM agent).

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Interactive dashboard (HTML) |
| `GET /status` | Status page — 4 component health cards with auto-refresh |
| `GET /health` | JSON: agent status, version, DB and collector |
| `GET /api/summary` | Nodes, pods, allocatable CPU/Mem |
| `GET /api/metrics` | Per-pod metrics: usage, request, waste, memRequest |
| `GET /api/pods` | Full pod list with phase and namespace |
| `GET /api/history?range=X` | Cost history (30m/1h/6h/24h/7d/30d/90d/365d/custom) |
| `GET /api/forecast?range=X` | Linear forecast with ±1.5σ confidence band |
| `GET /api/workloads` | Deployments and StatefulSets with replica status, image and age |
| `GET /api/events` | Kubernetes events sorted by timestamp descending |
| `GET /api/waste` | Per-pod waste: cpuUsage, cpuRequest, potentialSavingMCpu, appLabel, isSystem |
| `GET /api/efficiency` | Namespace efficiency score (grade A→F + UNMANAGED) |
| `GET /api/incidents` | Deterministic incidents: Pending, CrashLoop, OOMKilled, HighCPU, HighMemory, ResourceWaste |
| `GET /api/pods/{ns}/{pod}/logs` | Last 100 log lines from a pod container (plain text) |
| `GET /docs` | Swagger UI (CDN unpkg.com — no external build dependency) |
| `GET /openapi.yaml` | OpenAPI spec embedded in binary, covers all endpoints |

**Supported ranges:** `30m` `1h` `6h` `24h` `7d` `30d` `90d` `365d` `custom`

For custom range: `?range=custom&from=<ISO>&to=<ISO>`

---

## Dashboard Features

### KPI Strip
6 clickable cards at the top: Total Nodes, Active Pods, Failed Pods, Top CPU Consumer, Top Memory Consumer, Waste Opportunities. Each card opens a detailed drawer.

### Main Tiles (row-4)
- **Node Health Map** — honeycomb by node state; drawer with metrics glossary
- **Pod Distribution** — donut by namespace or phase; inherits NS filter; system NS toggle
- **CPU Resources** — allocation donut + Requested/Allocatable bar; NS filter; drawer with CPU Free + CPU Pressure
- **Memory Resources** — purple donut + pressure ratio; NS filter; Optimal/High/Critical badge

All drawers include an inline "ⓘ What these metrics mean" glossary card.

### Namespace Efficiency Score
Full-width panel with A→F grades per namespace. Scoring based on CPU Usage/Request ratio. Pods without `resources.requests` receive UNMANAGED grade (worse than F). Inline "How grades work" tooltip.

### Financial Correlation
Cost history chart (Budget vs Actual), dashed forecast line, ±1.5σ confidence bands and projected metric cards.

### Waste Intelligence
Waste table with two views in the drawer:
- **By Pod** — individual list with CPU/Mem waste, severity, namespace/severity/search filters and system NS toggle
- **By Deployment** — aggregated by `app` label: Deployment · Namespaces · Pods · CPU Saveable · Mem Not Used · Est. Saving

### Status Page (`/status`)
Standalone page with 5 health cards: Sentinel Agent, Database, Metrics Collector, Kubernetes API, Metrics API. Dynamic green/orange/red banner from `/health`. Auto-refresh every 10s.

### Connected Badge
Hover tooltip showing: Cluster, Endpoint, Version, Session uptime, Last sync, Database status.

---

## Agent Management

```bash
cd agent/
make start    # compile + start in background
make stop     # stop the service
make restart  # recompile and restart
make status   # current state
make logs     # tail logs in real time
make build    # compile only
```

---

## Thresholds

Defined in `config/thresholds.yaml` — single source of truth, mounted via ConfigMap in Helm.

| Metric | WARNING | CRITICAL |
|---|---|---|
| CPU | > 70% | > 85% |
| Memory | > 75% | > 90% |
| Disk | > 70% | > 85% |
| Pod Pending | > 5min | — |
| Pod CrashLoopBackOff | — | immediate |
| Waste per pod | > 60% | — |

---

## Data Retention

| Layer | Granularity | Default retention | Env var |
|---|---|---|---|
| Raw | ~10s | 24h | `RETENTION_RAW_HOURS` |
| Hourly | 1h | 30 days | `RETENTION_HOURLY_DAYS` |
| Daily | 1 day | 365 days | `RETENTION_DAILY_DAYS` |

Aggregation and cleanup run automatically every hour.

---

## Environment Variables

The Sentinel Go Agent can be configured via environment variables. If using Helm, these can be set via the `agent.env` values.

| Variable | Default | Description |
|---|---|---|
| **API & Security** | | |
| `LISTEN_ADDR` | `0.0.0.0:8080` | Bind address and port for the dashboard and API. |
| `RATE_LIMIT_RPS` | `100` | Global rate limit in requests per second. |
| `AUTH_ENABLED` | `true` | Enable Bearer token authentication for API endpoints (except `/health`). |
| `AUTH_TOKEN` | **(Required when auth enabled)** | The token required when `AUTH_ENABLED` is true. Agent refuses to start if empty. No default is provided — operator must supply a secret value. |
| **FinOps Pricing** | | |
| `USD_PER_VCPU_HOUR` | `0.04` | Cost of 1 CPU core (1000m) per hour, used for waste forecast. |
| `USD_PER_GB_HOUR` | `0.005` | Cost of 1 GB (1024MiB) of Memory per hour. |
| **Database** | | |
| `DB_USER` | (Required) | PostgreSQL user. |
| `DB_PASSWORD` | (Required) | PostgreSQL password. |
| `DB_NAME` | `sentinel_db` | PostgreSQL database name. |
| `DB_HOST` | `localhost` | PostgreSQL host. |
| `DB_PORT` | `5432` | PostgreSQL port. |
| `DB_SSLMODE` | `disable` | Set to `require` in production if connecting to an external DB. |
| `DB_CONNECT_RETRIES`| `10` | Max connection attempts on boot. |
| `DB_TIMEOUT_SEC` | `5` | Query timeout in seconds. |
| **Retention** | | |
| `RETENTION_RAW_HOURS`| `24` | Hours to keep minute-level raw data. |
| `RETENTION_HOURLY_DAYS`| `30` | Days to keep hourly aggregated data. |
| `RETENTION_DAILY_DAYS`| `365` | Days to keep daily aggregated data. |
| **Intelligence (Optional LLM)** | | |
| `LLM_PROVIDER` | *(unset — deterministic mode)* | LLM provider to use for incident narrative enrichment. Supported value: `ollama`. If unset or unsupported, Sentinel operates in deterministic-only mode. |
| `OLLAMA_ENDPOINT` | `http://ollama.default.svc.cluster.local:11434` | Ollama API base URL. Only used when `LLM_PROVIDER=ollama`. |
| `OLLAMA_MODEL` | `llama3` | Model name to request from Ollama. Only used when `LLM_PROVIDER=ollama`. |

---

## Project Structure

```
sentinel/
├── ROADMAP.md                       # Milestones M1–M7 toward v1.0
├── README.md
├── agent/
│   ├── main.go                      # Bootstrap, collector goroutine, HTTP server (~220 lines)
│   ├── main_test.go                 # Tests for main-package helpers
│   ├── Dockerfile                   # Multi-stage Alpine build
│   ├── go.mod / go.sum
│   ├── Makefile
│   ├── pkg/
│   │   ├── api/                     # HTTP handlers, types, middleware, Swagger
│   │   │   ├── api.go               # Types (PodStats, WasteEntry, Incident…), middleware
│   │   │   ├── api_handlers.go      # All HTTP handlers incl. /api/incidents
│   │   │   ├── api_test.go
│   │   │   ├── swagger.go           # /docs + /openapi.yaml handlers
│   │   │   ├── swagger-ui.html      # Swagger UI (CDN, embedded)
│   │   │   ├── openapi.go           # //go:embed openapi.yaml
│   │   │   └── openapi.yaml         # OpenAPI spec for all endpoints
│   │   ├── incidents/               # Threshold loading + deterministic analysis
│   │   │   ├── incidents.go
│   │   │   └── incidents_test.go
│   │   ├── k8s/                     # Kubernetes client + Metrics API wrappers
│   │   │   ├── k8s.go
│   │   │   └── k8s_test.go
│   │   ├── llm/                     # LLM provider interface + Ollama skeleton
│   │   │   ├── client.go            # Provider interface, NewClient(), ollamaProvider
│   │   │   └── client_test.go
│   │   └── store/                   # PostgreSQL: schema, aggregation, retention
│   │       ├── store.go
│   │       └── store_test.go
│   └── static/
│       ├── dashboard.html           # Dashboard (embedded in binary via embed.FS)
│       ├── dashboard.css
│       ├── js/                      # Dashboard JS modules (loaded in order)
│       │   ├── 01-init.js           # State, auth, utilities
│       │   ├── 02-charts.js         # Chart.js wrappers
│       │   ├── 03-namespace.js      # Namespace/tab management
│       │   ├── 04-overview.js       # Overview tab + tile updaters
│       │   ├── 05-workloads.js      # Workloads, pods, efficiency, FinOps drawer
│       │   ├── 06-drawers.js        # Drawer engine + all 9 drawer renderers
│       │   └── 07-polling.js        # Event bindings, init calls
│       ├── status.html              # Status page (embedded)
│       └── icon.png
├── helm/sentinel/                   # Kubernetes Helm chart
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
├── config/
│   └── thresholds.yaml              # Operational thresholds
├── tools/
│   ├── monitor.py                   # Monitor via Go agent API
│   └── report_tool.py               # Safe write via harness
├── harness/
│   ├── validador_saida.py           # Gatekeeper: blocks destructive commands
│   └── test_validador_saida.py      # Unit tests (23 tests)
├── docs/
│   ├── screenshots/                 # Dashboard screenshots (v1.0-rc1)
│   └── reports/                     # Lab reports and chaos engineering evidence
├── .github/
│   └── workflows/
│       ├── ci.yml                   # Go tests + Helm lint on push/PR to main
│       └── release.yml              # Build + push to GHCR on semver tags
├── CONTRIBUTING.md                  # Dev setup, constraints, PR guidelines
└── SECURITY.md                      # Vulnerability disclosure and secure deployment
```

---

## Harness Engineering

Every final report passes through `harness/validador_saida.py` before being written:

| Rule | Behavior |
|---|---|
| Blocks destructive commands | `rm -rf`, `kubectl delete`, `DROP TABLE`, fork bombs, `> /dev/` redirects |
| Blocks M5 remediation risks | `kubectl exec`, `kubectl apply -f -` (stdin), `kubectl scale --replicas=0`, `kubectl patch` with `replicas: 0`, `helm uninstall`, `helm delete` |
| Requires `## Resumo Executivo` | Reports without this section are rejected |
| Minimum size | Content under 100 characters is rejected |
| Maximum size | Content over 10 MB is rejected |
| Unicode normalization | NFKC + invisible character removal before pattern matching — prevents evasion via lookalike chars |

23 automated tests cover all patterns: `python3 harness/test_validador_saida.py`

---

## Changelog

### v1.0-rc1 — M7: v1.0 preparation complete
- **OpenAPI spec completed** — all 15 endpoints documented with full schemas, securitySchemes and reusable responses.
- **README fully corrected** — setup instructions, env vars table (incl. LLM vars), API endpoint table, Go version, ranges.
- **CONTRIBUTING.md** — dev setup, architecture constraints, commit conventions and PR scope boundaries.
- **GHCR release pipeline** — `release.yml` builds and pushes `ghcr.io/boccato85/sentinel` on semver tags via `GITHUB_TOKEN`.
- **i18n** — all incident narrative strings translated from PT-BR to English in the Go backend.
- **CI fixed** — `go-version` bumped to `1.25` to match `go.mod` directive; `eval/gemini` added to CI triggers.
- **Screenshots updated** — 5 new v1.0-rc1 screenshots replacing all v0.10.x references.
- **SECURITY.md** — supported version and `AUTH_ENABLED` default corrected.

### v0.50.6 — UI refinements and host security hardening
- **Status Ribbon** — replaced context bar with persistent ribbon showing version, namespace and sync state.
- **FinOps correlation chart** — enhanced Budget vs Actual visualization with forecast overlay.
- **Host security** — hardened CSP headers and improved XSS mitigation across dashboard handlers.

### v0.50 — M6: Real Lab / Chaos Lab
- **Milestone 6 (M6) officially closed** — Sentinel validated under 1000 users load using Online Boutique.
- **Chaos Lab Report** — Comprehensive baseline/chaos analysis report generated documenting Throttling, OOMKill risk and Resource Waste escalation.
- **UI Scaling** — Verified visual prioritization logic (CRITICAL/HighCPU) under extreme cluster stress.

### v0.36 — Issue #13 & #18: UX & Incident Polish
- **Issue #13 (HighCPU fallback):** Logic to detect pods without `resources.requests.cpu` using node allocatable percentages.
- **Issue #18 (Prioritization):** `CRITICAL` and `HighCPU` incidents now bypass "System NS" and time filters in drawers.
- **UI Enhancements:** Sortable column headers in Recent Incidents; fixed negative waste messages and "Age" display for ResourceWaste items.
- **Cleanup:** Removal of redundant local namespace selectors; fixed cache-busting system for JS modules.

### v0.35 — M5 code review fixes
- **Security (JS):** Copy button in Alerts drawer now uses `data-runbook` + `addEventListener` — previously the `onclick` attribute was silently stripped by DOMPurify, rendering the button non-functional.
- **Runbooks:** `ErrImagePull` and `CreateContainerConfigError` now produce `kubectl describe pod` instead of `kubectl logs` (container never started; logs return nothing).
- **LLM skeleton:** Fixed latent nil-pointer panic when `LLM_PROVIDER=gemini` — now correctly returns `Enabled: false` like other unimplemented providers.
- **Tests:** Added 4 unit tests for `pkg/llm` covering all `NewClient()` branches (Go: 14 tests; harness: 23 tests; total: 37).
- **Roadmap:** Swapped M6/M7 — Real lab/QA before docs/polish; rationale in ROADMAP.md.

### v0.34
- **Auto-scaling Honeycomb Map** — Datadog-inspired visual density map for cluster health.
- **Node Detail Drawer** — Individual node analysis with CPU/Memory saturation bars and pod list.
- **Improved UX** — Back buttons for seamless navigation between node details and global lists.
- **Event Delegation** — Robust UI interactions that survive dynamic re-renders and DOM sanitization.

### v0.12 — Security hardening + M5 foundation + JS modularization
- **Security (M4 gap closure):** `AUTH_TOKEN` fail-fast, `/health` disclosure fix, XSS hardening, Helm `required` guard.
- **M5 foundation:** `Narrative` field on `Incident` struct, Harness M5 remediation guard (23 automated tests).
- **Infrastructure:** JS modularization (7 modules), `embed.FS` + `http.FileServer`.

### v0.11 — Dashboard v2: no-scroll layout
- **Dashboard v2 layout** — scroll-free overview optimized for single-screen monitoring.
- **FinOps/Efficiency toggle** — line chart + donut breakdown.
- **Recent Events tile** — full drawer with search and filters.

### v0.10.15 — M2: Waste by Deployment
- **By Deployment view** in Waste Intelligence drawer — aggregates by `app` label.
- **By Pod | By Deployment toggle** with tab-style UI.

### v0.10.14 — Namespace Efficiency Score + UX Polish
- **Namespace Efficiency Score** — full-width panel with A→F grades.
- **"ⓘ What these metrics mean" card** — inline glossary.

### v0.10.1 — M1 closed
- `/health` endpoint with DB and collector status.
- **22 automated tests**.

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full milestone breakdown (M1→M7, deliverables, done criteria and version history).

---

## License

Distributed under the [Apache 2.0](LICENSE) license.
