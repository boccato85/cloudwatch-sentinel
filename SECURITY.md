# Security Policy

## Reporting a vulnerability

If you find a security vulnerability in Sentinel, please **do not open a public issue**.

Report it privately by emailing the maintainer or opening a [GitHub Security Advisory](https://github.com/boccato85/Sentinel/security/advisories/new).

We aim to acknowledge reports within 48 hours and release a fix within 14 days depending on severity.

---

## Supported versions

| Version | Supported |
|---|---|
| `v0.10.x` (current) | ✅ Yes |
| `< v0.10` | ❌ No |

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
- [ ] Sentinel has **no built-in authentication** in `v0.x` — planned for M7 (`v1.0`)
- [ ] Until auth is implemented: restrict network access at the infrastructure level (VPN, private subnet, ingress auth)

### Secrets
- [ ] Never log the `connStr` variable — it contains the DB password in plaintext
- [ ] Use Kubernetes Secrets (provisioned by the Helm chart) for all credentials
- [ ] The `.env` file is in `.gitignore` — never commit it

### Pricing / cost configuration
- [ ] `USD_PER_VCPU_HOUR` and `USD_PER_GB_HOUR` default to `0.04` and `0.005` — adjust via env vars to match your actual cloud pricing

---

## Known limitations (`v0.x`)

| Area | Status |
|---|---|
| Authentication | Not implemented — planned M7/v1.0 |
| TLS between agent and DB | Disabled by default (`DB_SSLMODE=disable`) |
| CSRF protection | N/A — no state-changing endpoints currently |
| Audit logging | Not implemented |

---

## Security-relevant environment variables

| Variable | Default | Notes |
|---|---|---|
| `DB_SSLMODE` | `disable` | Set to `require` in production |
| `DB_PASSWORD` | (required) | Use a strong, unique password |
| `RATE_LIMIT_RPS` | `100` | Per-IP rate limit |
| `LOG_LEVEL` | `info` | Never use `debug` in production (may log sensitive data) |
