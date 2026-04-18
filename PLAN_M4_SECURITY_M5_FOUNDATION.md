# Plan: Security Debt (M4 gaps) + M5 Foundation

## Context

The security review identified three validated findings that directly contradict M4's done criterion ("API requires auth outside of local environments"). These must be fixed before any real deployment or M5 testing begins. Simultaneously, the "what to watch" section for M5 identified four foundational concerns; this plan starts on two that are additive and low-risk (narrative hook + harness evolution), defers the JS modularization to its own PR (too large to bundle safely), and documents the /incident wiring as the next M5 sprint after this one.

---

## Phase 1 — Security Fixes

### Fix 1: AUTH_TOKEN hardcoded default

**Problem:** Three simultaneous locations ship the known-public default `sentinel-secure-token`.

**`agent/main.go:213-214`**
- Replace `getEnv("AUTH_TOKEN", "sentinel-secure-token")` with a conditional:
  ```go
  authToken := getEnv("AUTH_TOKEN", "")
  if authEnabled && authToken == "" {
      slog.Error("AUTH_TOKEN must be set when AUTH_ENABLED=true", "component", "app")
      os.Exit(1)
  }
  ```
- Existing helpers: `getEnv` (line 59), `requireEnv` (line 66) — note: `requireEnv` always exits; the new logic only exits when auth is enabled, so write it inline.

**`agent/static/dashboard.js:5`**
- Remove the `|| 'sentinel-secure-token'` last-resort fallback.
- When AUTH_TOKEN is absent from both URL params and localStorage, redirect to `/status` or render an inline banner ("Authentication required — please configure your token") instead of silently using the known default.

**`helm/sentinel/values.yaml:54`**
- Remove the `"sentinel-secure-token"` value; replace with an empty string and add a comment requiring the operator to supply it.
- In `helm/sentinel/templates/secret.yaml:15`, add a `required` guard:
  ```yaml
  AUTH_TOKEN: {{ required "agent.auth.token must be set to a secret value" .Values.agent.auth.token | quote }}
  ```

---

### Fix 2: `/health` leaks internal error strings

**Problem:** `api_handlers.go:72-97` returns raw `dbErr.Error()`, `k8sErr.Error()`, and `metricsErr.Error()` verbatim on the unauthenticated `/health` endpoint. These strings contain internal IPs and ports.

**`agent/pkg/api/api_handlers.go:72-97`**
- Replace each `.Error()` call in the JSON response with a static string; log the raw error server-side only:
  ```go
  // Before:
  resp.Checks["database"] = HealthStatus{Status: "unhealthy", Message: dbErr.Error()}
  
  // After:
  slog.Error("database ping failed", "component", "health", "err", dbErr)
  resp.Checks["database"] = HealthStatus{Status: "unhealthy", Message: "database unreachable"}
  ```
- Apply the same pattern for `k8s_api` (line 85) and `metrics_api` (line 97).
- The `HealthStatus` struct at `types.go:124-128` already has `Message string` — no struct change needed.

---

### Fix 3: DOMPurify removal + unescaped `entry.opportunity`

**Problem A:** `drawerHTML()` at `dashboard.js:1688-1690` sets `innerHTML` directly with no sanitization safety net after DOMPurify was removed.

**`agent/static/dashboard.html`**
- Re-add the DOMPurify script tag before the dashboard.js include (line 405):
  ```html
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.9/dist/purify.min.js"></script>
  ```
- Restore the defensive check in `drawerHTML()` at `dashboard.js:1688`:
  ```js
  function drawerHTML(html) {
    var clean = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : html;
    document.getElementById('drawer-body').innerHTML = clean;
  }
  ```

**Problem B:** `entry.opportunity` is concatenated into innerHTML raw at `dashboard.js:2391`:
```js
// Before:
'<span ...>' + entry.potentialSavingMCpu + 'm (' + entry.opportunity + ')</span>'

// After:
'<span ...>' + entry.potentialSavingMCpu + 'm (' + esc(entry.opportunity) + ')</span>'
```

**Problem C:** `n.namespace` inserted raw at `dashboard.js:1510` and `1521` (efficiency worst-list):
- Wrap each `n.namespace` and `n.grade` occurrence with `esc()`.

---

### Fix 4: Remove debug printf

**`agent/pkg/api/api_handlers.go:1092`**
- Delete: `fmt.Printf("DEBUG: Incidents count: %d\n", len(incs))`
- Replace with a structured debug log if desired: `slog.Debug("incidents computed", "component", "http", "count", len(incs))`

---

## Phase 2 — M5 Foundation

### M5-A: Add `Narrative` field to `Incident` struct

**Why first:** The UI and harness both need this hook before LLM integration can land in any form.

**`agent/pkg/api/types.go:147-155`**
- Add one field:
  ```go
  type Incident struct {
      PodName   string `json:"podName"`
      Namespace string `json:"namespace"`
      Type      string `json:"type"`
      Severity  string `json:"severity"`
      Message   string `json:"message"`
      Narrative string `json:"narrative,omitempty"` // ← new: LLM-generated explanation
      Age       string `json:"age"`
      IsWaste   bool   `json:"isWaste"`
  }
  ```
- The field is `omitempty` so the API response is backward-compatible when empty.
- No change to `handleIncidents` logic — field stays empty until the LLM layer populates it.

**`agent/static/dashboard.js` — alerts drawer**
- Find the `alertCard()` function and its callers in the alerts drawer (~lines 1995-2063).
- If `inc.narrative` is present, append a collapsible "Why?" block below the existing message:
  ```js
  var narrativeHtml = inc.narrative
    ? '<div style="font-size:.74em;color:var(--text-dim);margin-top:6px;font-style:italic;border-left:2px solid var(--orange);padding-left:8px">' + esc(inc.narrative) + '</div>'
    : '';
  ```
- Insert `narrativeHtml` after the existing message in the card — no new API calls, no new state.

---

### M5-B: Harness evolution for remediation commands

**Why now:** The harness currently blocks destructive operations (`kubectl delete`, `rm -rf`, etc.) but does not block commands that look safe but can cause harm in a remediation context (e.g. unconstrained `kubectl apply`, `kubectl scale --replicas=0`).

**`harness/validador_saida.py`**
- Extend the string block list and regex patterns to cover:
  - `kubectl apply -f -` (applying untrusted stdin manifests)
  - `kubectl scale --replicas=0` (scaling down to zero)
  - `kubectl patch` with `--patch` containing `replicas: 0`
  - `helm uninstall` / `helm delete`
  - `kubectl exec` (arbitrary command execution inside pods)
- Existing pattern: string literals in lines 21-32, regex in lines 34-45 — add entries to both lists following the established pattern.
- Extend `test_validador_saida.py` with test cases for each new pattern.

---

## Phase 3 — JS Modularization (Deferred)

**Decision: separate PR.** At 2,779 lines, splitting `dashboard.js` requires changing the Go `//go:embed` strategy from individual byte slices to `embed.FS`, adding new HTTP routes for each JS module, and updating `main.go`, `api.go`, and `api_handlers.go`. Bundling this with security fixes makes the security-fix PR impossible to review cleanly.

**Recommended approach for the next PR:**
1. Convert `main.go` to use `//go:embed static/*` with `embed.FS`.
2. Serve all static files via a single FS handler.
3. Split `dashboard.js` into modules by logical section (drawer-engine, drawer-nodes, drawer-finops, etc.) and load them via `<script>` tags in `dashboard.html`.
4. Document the module boundaries in `CLAUDE.md`.

---

## Critical Files Modified

| File | Change |
|---|---|
| `agent/main.go:213-214` | AUTH_TOKEN fail-fast |
| `agent/static/dashboard.js:5,1510,1521,1688-1690,2391` | Token fallback removal, DOMPurify restore in drawerHTML, esc() on opportunity/namespace |
| `agent/static/dashboard.html` | Re-add DOMPurify script tag |
| `helm/sentinel/values.yaml:54` | Remove default token value |
| `helm/sentinel/templates/secret.yaml:15` | Add `required` guard |
| `agent/pkg/api/api_handlers.go:72-97,1092` | Strip raw errors from /health, remove debug printf |
| `agent/pkg/api/types.go:147-155` | Add `Narrative string` to Incident struct |
| `agent/static/dashboard.js` (alerts drawer ~2033-2063) | Render `narrative` field if present |
| `harness/validador_saida.py:21-45` | Add kubectl/helm remediation patterns |
| `harness/test_validador_saida.py` | New test cases for harness additions |

---

## Verification

```bash
# Go tests (all 25 + any new ones)
cd agent && go test -v ./...

# Helm lint
helm lint helm/sentinel

# Manual: helm install without auth token → should fail with required guard
helm template sentinel helm/sentinel --set agent.auth.enabled=true 2>&1 | grep -i required

# Manual: /health with DB down → response must not contain IP addresses
curl http://<minikube-ip>:30080/health | jq '.checks.database.message'
# Expected: "database unreachable" (not a raw error string)

# Manual: dashboard load with no token in localStorage
# → should show error banner, not silently authenticate with default token

# Harness: new block patterns
echo "kubectl apply -f -" | python3 harness/validador_saida.py
# → should exit 1 (blocked)

python3 harness/test_validador_saida.py
# → all tests pass
```
