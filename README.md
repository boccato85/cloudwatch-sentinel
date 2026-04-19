# Sentinel

<p align="center">
  <img src="cw_sentinel_logo.png" alt="Sentinel Logo" width="180"/>
</p>

> **Kubernetes SRE intelligence for teams that can't afford a dedicated specialist.**
> Incident detection, waste analysis, cost forecasting and AI-powered explanations — no Prometheus required.

<p align="center">
  <img src="docs/screenshots/sentinel_ss_0.10.20(1).png" alt="Sentinel Dashboard v0.11" width="900"/>
</p>

![Status](https://img.shields.io/badge/status-v0.33-brightgreen)
![Kubernetes](https://img.shields.io/badge/Kubernetes-v1.35.1-blue)
![Go](https://img.shields.io/badge/Go-1.23-00ADD8)
![Standalone](https://img.shields.io/badge/standalone-no%20Prometheus-green)
![Tests](https://img.shields.io/badge/tests-56%20passing-brightgreen)
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

| Dashboard Overview (v0.11) | Recent Events Drawer |
|---|---|
| ![Overview](docs/screenshots/sentinel_ss_0.10.20(1).png) | ![Events](docs/screenshots/sentinel_ss_0.10.20(2).png) |

| Efficiency Tab | Waste Intelligence |
|---|---|
| ![Efficiency](docs/screenshots/sentinel_ss_0.10.20(3).png) | ![Waste](docs/screenshots/sentinel_ss_0.10.20(4).png) |

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
| Agent | Go 1.23 (client-go, net/http, slog, embed) |
| Persistence | PostgreSQL (`sentinel_db`) — runs as a pod in the cluster |
| Dashboard | HTML + CSS + Chart.js (embedded in binary) |
| LLM Agent | Optional — any LLM agent (Claude, Gemini, Minimax…) |

---

## Prerequisites

- Minikube running with Metrics Server enabled
- Go 1.23+ (only for local development without Helm)

> **Note:** PostgreSQL is **not a local prerequisite**. It is provisioned automatically as a pod in the `sentinel` namespace by the Helm chart.

---

## Setup

### 1. Clone and MCP Server

```bash
git clone https://github.com/boccato85/Sentinel
cd Sentinel
cd Sentinel
```

### 2. Go Agent

**Option A: deploy on Kubernetes via Helm (recommended)**

```bash
# Build the image
podman build -t localhost/sentinel:0.12 agent/
podman save localhost/sentinel:0.12 | minikube image load -

# Deploy (PostgreSQL spins up automatically as a pod)
helm install sentinel helm/sentinel -n sentinel-gemini --create-namespace \
  --set image.tag=0.12 \
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
| `GET /api/history?range=X` | Cost history (30m/1h/6h/24h/7d/30d/90d/1y/custom) |
| `GET /api/forecast?range=X` | Linear forecast with ±1.5σ confidence band |
| `GET /api/waste` | Per-pod waste: cpuUsage, cpuRequest, potentialSavingMCpu, appLabel, isSystem |
| `GET /api/efficiency` | Namespace efficiency score (grade A→F + UNMANAGED) |
| `GET /api/incidents` | Deterministic incidents: Pending, CrashLoop, OOMKilled, HighCPU, HighMemory, ResourceWaste |
| `GET /docs` | Swagger UI (CDN unpkg.com — no external build dependency) |
| `GET /openapi.yaml` | OpenAPI spec embedded in binary, covers all endpoints |

**Supported ranges:** `30m` `1h` `6h` `24h` `7d` `30d` `90d` `1y` `custom`

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
Standalone page with 4 health cards: Sentinel Agent, Database, Metrics Collector, Kubernetes API. Dynamic green/orange/red banner from `/health`. Auto-refresh every 10s.

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
│   └── test_validador_saida.py      # Unit tests (16 tests)
└── docs/
    └── screenshots/                 # Dashboard screenshots
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

### v0.12 — Security hardening + M5 foundation + JS modularization

**Security (M4 gap closure):**
- **AUTH_TOKEN fail-fast** — agent refuses to start if `AUTH_ENABLED=true` and `AUTH_TOKEN` is empty; no default provided (`main.go`, Helm `required` guard)
- **`/health` disclosure fix** — raw internal error strings (containing IPs/ports) replaced with static `"database unreachable"` etc.; raw errors logged server-side only
- **XSS hardening** — DOMPurify restored in `drawerHTML()` as safety net; `entry.opportunity`, `n.namespace` and `n.grade` now escaped with `esc()` before `innerHTML`
- **Helm `required` guard** — `agent.auth.token` must be set at install time; chart renders fail if empty

**M5 foundation:**
- **`Narrative` field** on `Incident` struct (`omitempty`, backward-compatible) — wired for LLM enrichment; Alerts drawer renders it as a collapsible "Why?" block when present
- **Harness M5 remediation guard** — harness blocks `kubectl exec`, `kubectl apply -f -`, `kubectl scale --replicas=0`, `helm uninstall/delete`, `kubectl patch replicas:0`; 23 automated tests cover all patterns

**Infrastructure:**
- **JS modularization** — `dashboard.js` (2,786 lines) split into 7 ordered modules under `static/js/`; `//go:embed static` replaces 5 individual embed directives; `embed.FS` + `http.FileServer` replace byte-slice handlers

### v0.11 — Dashboard v2: no-scroll layout + FinOps/Efficiency toggle
- **Dashboard v2 layout** — scroll-free overview optimized for single-screen monitoring
- **Tab bar removed** — replaced by thin context bar (Overview | NS | pods | warnings | status dot)
- **Workloads/Pods tabs eliminated** — data accessible via KPI expand + drawers
- **Compact layout** — main gap 14→10px, panel padding 14→10px, KPI padding 14→10px, donuts 88→72px
- **Recent Events tile** — full drawer with search debounce, NS selector, sortable columns, 220px height
- **FinOps/Efficiency toggle** — CSP-safe (addEventListener), fixed height 270px, line chart 140px
- **Efficiency tab** — donut 130px no text below, "How grades work" tooltip (A→F/UNMANAGED), NS breakdown table with sortable columns
- **FinOps drawer** — "What these metrics mean" glossary tooltip (Budget, Actual, Waste, Waste%, Proj., ±1.5σ)
- **Node Health legend removed** — badge OK/Issue already explains
- **Footer credits** — "Built with OpenCode + Go + JS • Kubernetes Dashboard"

### v0.10.18 — Multi-instance sync + UI parity + `/api/incidents` in dashboard
- **Sync from gemini instance** — `AuthMiddleware` + `AuthEnabled`/`AuthToken`, types extracted to `types.go`, `BuildPodSpecMap()` in `pkg/k8s`, `SystemNamespaces` exported
- **Dashboard parity with gemini** — all new UI elements added to opencode: global "Show system NS" toggle in header, "Critical / Warnings" KPI, per-tile namespace filters + system toggles in FinOps, Efficiency and Top Workloads panels
- **Metrics API card in `/status`** — 5th service card (Sentinel Agent, Database, Metrics Collector, Kubernetes API, Metrics API)
- **Native select/checkbox CSS** — `appearance: none`, custom dropdown arrows for `ns-select` and `tile-ns-select`
- **`/api/incidents` consumed by dashboard** — `updateOverview()` now fetches `/api/incidents`, distinguishes CRITICAL from WARNING, renders health incidents instead of failed/pending pod list
- **`tileNs` expanded** — 6 keys: `pods`, `cpu`, `mem`, `finops`, `eff`, `workloads` (was 3)
- **`loadNamespaces()` + `renderDropdowns()`** — system namespace filtering on all dropdowns; `sysNsList` array for consistent filtering
- **`fetchChart()` passes `system=` param** — backend respects include/exclude system NS in FinOps queries

### v0.10.17 — Packages + `/api/incidents` + Swagger UI
- **Refactored monolith → 4 packages** — `pkg/api`, `pkg/k8s`, `pkg/store`, `pkg/incidents`; `main.go` reduced from 2,282 to ~220 lines
- **`/api/incidents`** — deterministic incident detection: Pending pods, CrashLoop, OOMKilled, HighCPU, HighMemory, ResourceWaste (with severity and remediation hints)
- **Swagger UI at `/docs`** — served via CDN unpkg.com, no external build dependency
- **`/openapi.yaml`** — OpenAPI spec embedded in binary covering all endpoints
- **Per-package tests** — `go test ./...` covers all 5 packages (25 tests total)
- **Security hardening preserved** — all 21 items from commit `f6e6b1d` intact after refactoring

## Changelog

### v0.33
- **Auto-scaling Honeycomb Map** — Datadog-inspired visual density map for cluster health.
- **Node Detail Drawer** — Individual node analysis with CPU/Memory saturation bars and pod list.
- **Improved UX** — Back buttons for seamless navigation between node details and global lists.
- **Event Delegation** — Robust UI interactions that survive dynamic re-renders and DOM sanitization.

### v0.12
- **Security Hardening** — `AUTH_TOKEN` required when `AUTH_ENABLED=true`; no hardcoded defaults.
- **Harness Remediation Guard** — 23 automated tests blocking high-risk operations (exec, replicas=0).
- **JS Modularization** — Dashboard JS split into 7 maintainable modules.

### v0.11.3
- **Busting Cache System** — Asset synchronization for UI scripts across builds.

### v0.11.0 — M3 closed
- **Deterministic Incident Intelligence** — `/api/incidents` without LLM.
- **OpenAPI / Swagger UI** — embedded documentation at `/docs`.

### v0.10.15 — M2: Waste by Deployment
- **By Deployment view** in Waste Intelligence drawer — aggregates by `app` label.
- **By Pod | By Deployment toggle** with tab-style UI.

### v0.10.14 — Namespace Efficiency Score + UX Polish
- **Namespace Efficiency Score** — full-width panel with A→F grades.
- **"ⓘ What these metrics mean" card** — inline glossary.

### v0.10.13 — Status Page
- **`/status` page** — animated health cards for 4 components.

### v0.10.11
- **Connected badge tooltip** — cluster details on hover.

### v0.10.1 — M1 closed
- `/health` endpoint with DB and collector status.
- **22 automated tests**.

### v0.1 — v0.3
- Initial release: orchestrator + sub-agents.

---

## Roadmap

| Milestone | Status | Version |
|---|---|---|
| M1 — Stable core | ✅ Done | v0.10.1 |
| M2 — Actionable FinOps | ✅ Done | v0.10.15 |
| M3 — Deterministic incident intelligence | ✅ Done | v0.11 |
| M4 — Critical Resilience & Security | ✅ Done | v0.12 |
| M5 — Optional intelligence (LLM as a layer) | Partial (~65%) | v0.33 |
| M6 — v1.0 preparation | Not started | v0.99 |
| M7 — Real lab / QA / Prod-like | Not started | v1.0-rc |

See [ROADMAP.md](ROADMAP.md) for full details.

---

## License

Distributed under the [Apache 2.0](LICENSE) license.
