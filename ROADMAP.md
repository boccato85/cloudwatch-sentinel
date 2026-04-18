# Sentinel-Gemini Roadmap — 0.x → 1.0

> Last updated: 2026-04-18 | Current version: `v0.12`

## Product vision

**Sentinel-Gemini is an SRE/FinOps tool for small engineering teams** — teams that need cost management and reliability without a dedicated specialist. Startups, scale-ups and platform squads that don't have the budget for Datadog/New Relic but need fast answers about cluster health and cost.

> **Guiding principle:** Observability-first, intelligence-second. Didactic, lean, actionable.

## Product principles

- **Standalone first** — no Prometheus, Grafana or AlertManager required
- **Intelligence second** — if the analysis layer goes down, Sentinel-Gemini keeps working through deterministic rules
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
| M1 — Stable core (+ M5 self-observability) | ✅ Done | `v0.10.1` |
| M2 — Actionable FinOps | ✅ Done | `v0.10.15` |
| M3 — Deterministic incident intelligence | ✅ Done | `v0.11` |
| M4 — Critical Resilience & Security | ✅ Done | `v0.11.3` |
| M5 — Optional intelligence | Partial (~40%) | `v0.12` |
| M6 — v1.0 preparation | Not started | `v0.99` |
| M7 — Real lab / QA / Prod-like | Not started | `v1.0-rc` |

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

### M3 — Deterministic incident intelligence ✅ Done (`v0.11`)

**Goal:** Sentinel generates useful diagnosis even without AI, with APIs documented and individually monitored.

**Deliverables:**

| Item | Status |
|---|---|
| Thresholds read from `config/thresholds.yaml` in Go agent | ✅ Done |
| Automatic violation detection (CPU, memory, pod health) | ✅ Done |
| `severity` field in API endpoints | ✅ Done |
| Simple correlation (pod in CrashLoop + high CPU usage) | ✅ Done |
| Deterministic operational summary at `/api/incidents` | ✅ Done |
| Consumption of `/api/incidents` by the Dashboard UI | ✅ Done |
| Per-endpoint health check in `/health` (`checks.apis`) with individual latency | ✅ Done |
| `/status` page displays per-component status (APIM-style) | ✅ Done |
| `openapi.yaml` embedded in binary covering all endpoints | ✅ Done |
| Swagger UI at `/docs` (via CDN, no external build dependency) | ✅ Done |

**Done criterion:** Sentinel detects and classifies incidents via thresholds without needing the LLM, each endpoint has individually monitorable status, and any dev can explore the API via `/docs`.

**Dependencies:** M1 ✅

---

### M4 — Critical Resilience & Security ✅ Done (`v0.11.3` → `v0.12`)

**Goal:** Secure the agent for public release and ensure data resilience before pushing to production-like environments.

**Deliverables:**

| Item | Status |
|---|---|
| PostgreSQL PersistentVolumeClaim by default | ✅ Done |
| API Authentication (AuthMiddleware) enabled by default | ✅ Done |
| GitHub Actions CI pipeline (go test + helm lint) | ✅ Done |
| Circuit breaker for PostgreSQL (staleness flag on /health) | ✅ Done |
| Exponential backoff in collector goroutine | ✅ Done |
| Document environment variables and defaults | ✅ Done |
| Configurable FinOps pricing (price per mCPU/MiB) | ✅ Done |
| **Busting Cache System** for UI scripts | ✅ Done |
| **Security gap — AUTH_TOKEN**: fail-fast on boot if `AUTH_ENABLED=true` and token empty | ✅ Done (`v0.12`) |
| **Security gap — /health**: strip raw internal error strings from unauthenticated response | ✅ Done (`v0.12`) |
| **Security gap — XSS**: restore DOMPurify in `drawerHTML()`; escape `opportunity`, `namespace`, `grade` in innerHTML | ✅ Done (`v0.12`) |
| **Security gap — Helm**: `required` guard on `agent.auth.token`; remove hardcoded default | ✅ Done (`v0.12`) |
| **JS modularization**: split 2,786-line `dashboard.js` into 7 modules under `static/js/`; switch to `embed.FS` | ✅ Done (`v0.12`) |

**Done criterion:** ✅ Sentinel can survive a pod restart without data loss, the API requires auth outside of local environments, CI runs on every PR, and no hardcoded credentials exist in the codebase.

**Dependencies:** M3 ✅

---

### M5 — Optional intelligence (`v0.12`)

**Goal:** The intelligence layer improves the experience but is not required for the core.

**Deliverables:**

| Item | Status |
|---|---|
| `/incident` consumes deterministic `/api/incidents` first | Pending |
| `Narrative string` field in `Incident` struct (`omitempty`, backward-compatible) | ✅ Done (`v0.12`) |
| Narrative rendered in Alerts drawer when populated (collapsible "Why?" block) | ✅ Done (`v0.12`) |
| Degraded mode: if intelligence layer unavailable, returns deterministic analysis | Pending |
| Harness M5 remediation guard: block `kubectl exec`, `kubectl scale --replicas=0`, `helm uninstall`, `kubectl apply -f -`, `kubectl patch replicas:0` | ✅ Done (`v0.12`) |
| Possible local model support (Ollama) | Future |
| Automatic runbooks based on templates + variables | Pending |
| **Datadog-style UI Alignment** (Node Health pods) | Partial |

**Done criterion:** `/incident` works without external models and produces usable diagnosis.

**Dependencies:** M4 ✅

---

### M6 — v1.0 preparation (`v0.99`)

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
| Integration tests for API contracts | Pending |

**Done criterion:** Another developer can clone, configure and run Sentinel without help.

**Dependencies:** M5

---

### M7 — Real lab / QA / Prod-Like (`v1.0-rc`)

**Goal:** Final QA validation. Shows a clear difference between a normal and a degraded cluster before 1.0 launch.

**Deliverables:**

| Item | Status |
|---|---|
| Documented Online Boutique baseline (namespace `google-demo`) | Pending |
| Controlled load (e.g. hey, k6) on microservices | Pending |
| Burst and fault injection documented | Pending |
| Before/after comparison in dashboard | Pending |
| Lab incident report with generated runbook | Pending |

**Done criterion:** Report comparing normal vs degraded state produced by Sentinel, serving as proof-of-concept for the community.

**Dependencies:** M6

---

## Version → milestone mapping

| Version | Milestone(s) | Main focus |
|---|---|---|
| `v0.10.1` | M1 + M5 | ✅ Core closed: `/health`, logs, thresholds, tests, forecast, dynamic badge |
| `v0.10.13` | M3 partial | ✅ `/status` page with animated health cards per component |
| `v0.10.14` | M2 partial | ✅ Namespace Efficiency Score (grades A→F), UX polish, inline glossaries |
| `v0.10.15` | M2 | ✅ Waste by Deployment — M2 closed |
| `v0.10.18` | M3 partial | ✅ `/api/incidents` consumed by dashboard, multi-instance sync |
| `v0.11` | M3 + Dashboard UX | ✅ Dashboard v2: no-scroll layout, FinOps/Efficiency toggle, context bar, events drawer |
| `v0.11.3` | M4 | ✅ Resilience, PVC, Auth, CI, Cache Busting |
| `v0.12` | M4 gaps + M5 foundation | ✅ Security fixes, Narrative hook, harness M5 guard, JS modularization |
| `v0.12.x` | M5 | LLM as optional layer, degraded mode, UI alignment |
| `v0.99` | M6 | Polish, docs, stable contracts |
| `v1.0-rc` | M7 | Online Boutique lab (QA/Prod-like) |

---

## Backlog by priority

### High priority (v0.12)
- M5: `/incident` consumindo dados determinísticos da `/api/incidents`
- M5: UI: Align node health pods (honeycomb) with Datadog style
- M5: UI: Add "Memory Requested" bar to global node list drawer
- M7: Online Boutique lab: baseline + load + comparison

### Medium priority (v0.1.x)
- CrashLoop pod + CPU correlation (refinamento)
- M6: API stability & full OpenAPI coverage

### Low priority / future
- Multi-cluster (post-1.0)
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
