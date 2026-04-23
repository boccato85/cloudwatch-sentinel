# Security Policy

## Reporting a vulnerability

If you find a security vulnerability in Sentinel, please **do not open a public issue**.

Report it privately by emailing the maintainer or opening a [GitHub Security Advisory](https://github.com/boccato85/Sentinel/security/advisories/new).

We aim to acknowledge reports within 48 hours and release a fix within 14 days depending on severity.

---

## Supported versions

| Version | Supported |
|---|---|
| `v1.0-rc1` (current) | ✅ Yes |
| `v0.50.x` | ❌ No — upgrade to v1.0 |
| `< v0.50` | ❌ No |

---

## Secure deployment checklist

### Database
- [ ] Set `DB_SSLMODE=require` (or `verify-full`) in production — default `disable` is for local dev only
- [ ] Use a dedicated database user with minimal privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE` on `sentinel_db` only)
- [ ] Rotate `DB_PASSWORD` regularly; never commit it to version control

### Kubernetes RBAC
- [ ] The Helm chart provisions a `ClusterRole` — review `helm/sentinel/templates/rbac.yaml` before deploying to shared clusters
- [ ] `pods/log` access is cluster-wide — limit to the namespaces you actually monitor if possible
- [ ] Do not run the Sentinel pod as root; the Dockerfile sets a non-root user

### Network
- [ ] Expose port 8080 only within the cluster (NodePort 30080 is for dev/local use)
- [ ] In production, place Sentinel behind an ingress with TLS and restrict access by IP or network policy
- [ ] Rate limiting is enabled by default (100 RPS per IP) — adjust `RATE_LIMIT_RPS` if needed

### Authentication
- [ ] `AUTH_ENABLED=true` by default — do not disable in production
- [ ] Provide a strong hex token via `AUTH_TOKEN` (generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`)
- [ ] The agent will refuse to start if `AUTH_ENABLED=true` and `AUTH_TOKEN` is empty
- [ ] Dashboard reads the token from `localStorage` — clear it when decommissioning a browser session

### Secrets
- [ ] Never log the `connStr` variable — it contains the DB password in plaintext
- [ ] Use Kubernetes Secrets (provisioned by the Helm chart) for all credentials
- [ ] The `.env` file is in `.gitignore` — never commit it

### Intelligence features (M8 — cloud LLM)
- [ ] `SENTINEL_LLM_API_KEY` must be stored as a Kubernetes Secret — never in env vars committed to version control
- [ ] Restrict the LLM API key to the minimum required scopes in your cloud provider
- [ ] All LLM-generated output passes through `harness/output_validator.py` before being written or rendered
- [ ] Agentic actions are scoped to read-only kubectl operations in MVP — review RBAC before enabling write-path actions

### Pricing / cost configuration
- [ ] `USD_PER_VCPU_HOUR` and `USD_PER_GB_HOUR` default to `0.04` and `0.005` — adjust via env vars to match your actual cloud pricing

---

## Known limitations

| Area | Status |
|---|---|
| TLS between agent and DB | Disabled by default (`DB_SSLMODE=disable`) — enable in production |
| CSRF protection | N/A — no state-changing browser-initiated endpoints |
| Audit logging | Not implemented |
| LLM API key rotation | Manual — no automatic rotation support in MVP |

---

## Security-relevant environment variables

| Variable | Default | Notes |
|---|---|---|
| `AUTH_ENABLED` | `true` | Do not disable in production |
| `AUTH_TOKEN` | (none) | Required when `AUTH_ENABLED=true`; agent exits on startup if missing |
| `DB_SSLMODE` | `disable` | Set to `require` in production |
| `DB_PASSWORD` | (required) | Use a strong, unique password |
| `RATE_LIMIT_RPS` | `100` | Per-IP rate limit |
| `LOG_LEVEL` | `info` | Never use `debug` in production — may log sensitive data |
| `SENTINEL_LLM_API_KEY` | (none) | M8 — cloud LLM API key; store as Kubernetes Secret |
| `SENTINEL_LLM_PROVIDER` | (none) | M8 — `gemini` or `openai` |
| `SENTINEL_LLM_MODEL` | (none) | M8 — model identifier (e.g. `gemini-2.0-flash`) |
