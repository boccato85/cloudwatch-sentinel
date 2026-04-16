import re

with open('ROADMAP.md', 'r') as f:
    content = f.read()

# Rewrite the milestones section
new_content = re.sub(
    r'\| M4 — Real lab with Online Boutique \| Not started \| `v0\.11` \|.*\| M7 — v1\.0 preparation \| Not started \| `v1\.0` \|',
    '| M4 — Critical Resilience & Security | Not started | `v0.11` |\n| M5 — Optional intelligence | Partial (~20%) | `v0.12` |\n| M6 — v1.0 preparation | Not started | `v0.99` |\n| M7 — Real lab / QA / Prod-like | Not started | `v1.0-rc` |',
    content,
    flags=re.DOTALL
)

# Replace detailed milestones
detailed = """### M4 — Critical Resilience & Security (`v0.11`)

**Goal:** Secure the agent for public release and ensure data resilience before pushing to production-like environments.

**Deliverables:**

| Item | Status |
|---|---|
| PostgreSQL PersistentVolumeClaim by default | Pending |
| API Authentication (AuthMiddleware) enabled by default | Pending |
| GitHub Actions CI pipeline (go test + helm lint) | Pending |
| Circuit breaker for PostgreSQL (staleness flag on /health) | Pending |
| Exponential backoff in collector goroutine | Pending |
| Document environment variables and defaults | Pending |
| Configurable FinOps pricing (price per mCPU/MiB) | Pending |

**Done criterion:** ✅ Sentinel can survive a pod restart without data loss, the API requires auth outside of local environments, and CI runs on every PR.

**Dependencies:** M3 ✅

---

### M5 — Optional intelligence (`v0.12`)

**Goal:** The intelligence layer improves the experience but is not required for the core.

**Deliverables:**

| Item | Status |
|---|---|
| `/incident` consumes deterministic `/api/incidents` first | Pending |
| Narrative enrichment for context, doesn't replace diagnosis | Partial |
| Degraded mode: if intelligence layer unavailable, returns deterministic analysis | Pending |
| Possible local model support (Ollama) | Future |
| Automatic runbooks based on templates + variables | Pending |

**Done criterion:** `/incident` works without external models and produces usable diagnosis.

**Dependencies:** M4

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

**Dependencies:** M6"""

new_content = re.sub(
    r'### M4 — Real lab with Online Boutique.*?Dependencies:.*?\n---',
    detailed,
    new_content,
    flags=re.DOTALL
)

new_content = re.sub(
    r'\| `v0\.11` \| M3 \+ M4 \| Incident intelligence \+ Online Boutique lab \|.*?\| `v1\.0` \| M7 \| Polish, docs, stable contracts, auth \|',
    '| `v0.11` | M4 | Resilience, PVC, Auth, CI |\n| `v0.12` | M5 | LLM as optional layer, degraded mode |\n| `v0.99` | M6 | Polish, docs, stable contracts |\n| `v1.0-rc` | M7 | Online Boutique lab (QA/Prod-like) |',
    new_content,
    flags=re.DOTALL
)

with open('ROADMAP.md', 'w') as f:
    f.write(new_content)
