# Sentinel Roadmap — 0.x → 1.0

> Last updated: 2026-04-13 | Current version: `v0.10.15`

## Product vision

**Sentinel is an SRE/FinOps tool for small engineering teams** — teams that need cost management and reliability without a dedicated specialist. Startups, scale-ups and platform squads that don't have the budget for Datadog/New Relic but need fast answers about cluster health and cost.

> **Guiding principle:** Observability-first, intelligence-second. Didactic, lean, actionable.

## Product principles

- **Standalone first** — no Prometheus, Grafana or AlertManager required
- **LLM second** — if the LLM goes down, Sentinel keeps working through deterministic rules
- **Collection doesn't decide** — collection, calculation and presentation are separate layers
- **UI doesn't calculate** — business logic stays in the backend
- **Deterministic rules before generative intelligence**
- **Didactic by default** — every metric must be self-explanatory; tooltips and legends are part of the product, not separate documentation
- **No system noise** — k8s infra namespaces (`kube-system`, `kubernetes-dashboard`, etc.) are excluded by default from governance panels; users don't control them
- **UNMANAGED is its own category** — pods without `resources.requests` are not "inefficient" (grade F), they are a scheduler blind spot and FinOps risk; they deserve their own badge and alert
- **Sort on every tile with columns** — any table in the dashboard must be sortable; standard via `attachPanelSortHandlers()`

---

## Milestone status

| Milestone | Status | Target version |
|---|---|---|
| M1 — Stable core | ✅ Done | `v0.10.1` |
| M2 — Actionable FinOps | ✅ Done | `v0.10.15` |
| M3 — Deterministic incident intelligence | In progress (~20%) | `v0.11` |
| M4 — Real lab with Online Boutique | Not started | `v0.11` |
| M5 — Sentinel self-observability | ✅ Done (integrated into M1) | `v0.10.1` |
| M6 — Optional intelligence | Partial (~20%) | `v0.12` |
| M7 — v1.0 preparation | Not started | `v1.0` |

---

## Detailed milestones

### M1 — Stable core ✅ (`v0.10.1`)

**Goal:** Sentinel sees the cluster without manual intervention and the data makes sense.

**Deliverables:**

| Item | Status |
|---|---|
| Continuous collection via Metrics API | ✅ Done |
| PostgreSQL persistence (raw + hourly + daily) | ✅ Done |
| Configurable 3-tier retention | ✅ Done |
| Waste calculation per pod (`potentialSavingMCpu`) | ✅ Done |
| Base dashboard (HTML + API) | ✅ Done |
| Stable API (`/api/summary`, `/api/metrics`, `/api/history`) | ✅ Done |
| Helm chart with Kubernetes deploy | ✅ Done |
| Harness (output validator) | ✅ Done |
| Waste threshold per pod (`config/thresholds.yaml` mounted via ConfigMap) | ✅ Done |
| `/health` endpoint in Go agent | ✅ Done |
| Structured logging with consistent fields (`slog`) | ✅ Done |
| Automated tests in Go agent (collection + waste) | ✅ Done (22 tests) |
| Dynamic version badge in dashboard (via `/health`) | ✅ Done |
| Data fallback for long ranges (30d/90d/1y) | ✅ Done |

**Done criterion:** ✅ Sentinel collects, persists, calculates waste and reports its own health without manual intervention.

---

### M2 — Actionable FinOps ✅ (`v0.10.15`)

**Goal:** You can identify where the waste is and prioritize fixes.

**Deliverables:**

| Item | Status |
|---|---|
| Pod waste ranking (top N) | ✅ Done (`/api/waste` + sortable drawer) |
| Waste analysis by namespace | ✅ Done (`/api/waste` with breakdown) |
| Waste analysis by deployment | ✅ Done (`appLabel` in `WasteEntry`, "By Deployment" view in drawer) |
| Request vs usage comparison per pod (explicit) | ✅ Done (pod detail drawer: CPU/Mem bars + rightsizing) |
| Overprovisioning detection (request >> real usage) | ✅ Done (via `applyWasteAnalysis`) |
| Namespace efficiency score | ✅ Done (`/api/efficiency`, grades A→F + UNMANAGED, full-width panel) |
| Cost forecast with linear regression | ✅ Done (`/api/forecast`) |
| Cost history (30m/1h/6h/24h/7d/30d/90d/1y) | ✅ Done |

**Done criterion:** ✅ Can answer "which namespace / deployment is wasting the most?" with data from the dashboard or API.

**Dependencies:** M1 ✅

---

### M3 — Deterministic incident intelligence (`v0.11`)

**Goal:** Sentinel generates useful diagnosis even without AI, with APIs documented and individually monitored.

**Deliverables:**

| Item | Status |
|---|---|
| Thresholds read from `config/thresholds.yaml` in Go agent | ✅ Done |
| Automatic violation detection (CPU, memory, pod health) | Pending |
| `severity` field in API endpoints | Pending |
| Simple correlation (pod in CrashLoop + high CPU usage) | Pending |
| Deterministic operational summary at `/api/incidents` | Pending |
| `/incident` integration with new endpoint (not LLM-only) | Pending |
| Per-endpoint health check in `/health` (`checks.apis`) with individual latency | Pending |
| `/status` page displays per-component status (APIM-style) | ✅ Done (v0.10.13 — 4 animated cards, auto-refresh 10s) |
| `openapi.yaml` embedded in binary covering all endpoints | Pending |
| Swagger UI at `/docs` (via CDN, no external build dependency) | Pending |

**Done criterion:** Sentinel detects and classifies incidents via thresholds without needing the LLM, each endpoint has individually monitorable status, and any dev can explore the API via `/docs`.

**Dependencies:** M1 ✅

---

### M4 — Real lab with Online Boutique (`v0.11`)

**Goal:** Shows a clear difference between a normal and a degraded cluster.

**Deliverables:**

| Item | Status |
|---|---|
| Documented Online Boutique baseline (namespace `google-demo`) | Pending |
| Controlled load (e.g. hey, k6) on microservices | Pending |
| Burst and fault injection documented | Pending |
| Before/after comparison in dashboard | Pending |
| Lab incident report with generated runbook | Pending |

**Done criterion:** Report comparing normal vs degraded state produced by Sentinel.

**Dependencies:** M1 ✅, M2 partial, M3 recommended

---

### M5 — Sentinel self-observability ✅

> Integrated into **M1 (`v0.10.1`)**. Done.

| Item | Status |
|---|---|
| `GET /health` — reports DB and collector state | ✅ Done |
| Structured logs with fields: `component`, `level`, `msg`, `err` | ✅ Done |
| Dynamic version badge in dashboard | ✅ Done |

---

### M6 — Optional intelligence (`v0.12`)

**Goal:** The LLM improves the experience but is not required for the core.

**Deliverables:**

| Item | Status |
|---|---|
| `/incident` consumes deterministic `/api/incidents` first | Pending |
| LLM enriches with narrative context, doesn't replace diagnosis | Partial |
| Degraded mode: if LLM unavailable, returns deterministic analysis | Pending |
| Possible local model support (Ollama) | Future |
| Automatic runbooks based on templates + variables | Pending |

**Done criterion:** `/incident` works without Claude and produces usable diagnosis.

**Dependencies:** M3

---

### M7 — v1.0 preparation (`v1.0`)

**Goal:** You'd call it 1.0 without technical embarrassment.

**Deliverables:**

| Item | Status |
|---|---|
| Documentation for all endpoints (OpenAPI or Markdown) | Pending |
| Stable API contracts (no breaking changes) | Pending |
| Revised dashboard UX (visual consistency, responsiveness) | Pending |
| Clean configuration (no undocumented env vars) | Pending |
| README reflecting real project state | Pending |
| Predictable failure behavior (graceful degradation) | Pending |
| Minimal auth (at least BasicAuth or static token) | Pending |

**Done criterion:** Another developer can clone, configure and run Sentinel without help.

**Dependencies:** Previous milestones reasonably complete

---

## Version → milestone mapping

| Version | Milestone(s) | Main focus |
|---|---|---|
| `v0.10.1` | M1 + M5 | ✅ Core closed: `/health`, logs, thresholds, tests, forecast, dynamic badge |
| `v0.10.13` | M3 partial | ✅ `/status` page with animated health cards per component |
| `v0.10.14` | M2 partial | ✅ Namespace Efficiency Score (grades A→F), UX polish, inline glossaries |
| `v0.10.15` | M2 | ✅ Waste by Deployment — M2 closed |
| `v0.11` | M3 + M4 | Incident intelligence + Online Boutique lab |
| `v0.12` | M6 | LLM as optional layer, degraded mode |
| `v1.0` | M7 | Polish, docs, stable contracts, auth |

---

## Backlog by priority

### High priority (v0.11)
- Automatic violation detection with thresholds → `/api/incidents`
- `severity` field in API endpoints
- Per-endpoint health check in `/health` (`checks.apis`) with individual latency
- `openapi.yaml` + Swagger UI at `/docs`
- Online Boutique lab: baseline + load + comparison
- Diary #4 (after M3/M4)

### Medium priority (v0.11/v0.12)
- CrashLoop pod + CPU correlation
- LLM degraded mode

### Low priority / future
- Auth (M7)
- Multi-cluster (post-1.0)
- Cross-cluster comparison (post-1.0)
- Local model / Ollama (post-1.0)

---

## Core vs Support vs Luxury

| Category | Items |
|---|---|
| **Core** | Kubernetes collection, waste calculation, pod/namespace analysis, history, dashboard, stable API, `/health`, behavior without LLM |
| **Support** | Structured logs, health checks, retries, schema validation, internal metrics, degraded mode, Markdown/JSON export |
| **Luxury** | LLM for narrative analysis, automatic runbooks, intelligent executive summary, local model, AI-driven trends, multi-cluster |

---

## Product rules

- If the LLM goes down, Sentinel stays useful
- If the dashboard fails, the API must still be usable
- If the cluster changes, the contracts must hold
- If the project grows, the core must not lose simplicity
