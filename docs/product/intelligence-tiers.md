# Sentinel Intelligence Tiers

This document describes product packaging direction for Sentinel Intelligence. It is intentionally separate from the OSS runtime contract in `README.md` and `ROADMAP.md`.

Provider choice, model version and routing strategy are internal backend concerns. This document describes customer-facing packaging and value, not implementation lock-in to any single model vendor.

## Positioning

Sentinel does not sell "LLM integration".

Sentinel sells:

> MTTR reduction and scalable SRE operations.

The moat is the combination of deterministic signals from the OSS core with an additive investigation layer that helps operators reach a defensible decision faster.

## Product split

### OSS Core

- Metrics collection
- Deterministic incidents and analysis
- Dashboard and API
- FinOps views and forecasting

### Sentinel Intelligence

- Guided RCA
- Investigation workflows
- Evidence correlation
- Action planning with operator approval

## Packaging direction

Packaging should be defined by operational value and buyer needs, not by direct exposure of model names or vendor choices.

### Team

- RCA generation
- Incident explanation
- Suggested next steps
- Human-in-the-loop, read-only investigations
- Monthly usage limits appropriate for small teams

### Ops

- Tool-based investigation
- Multi-signal correlation
- Incident timeline reconstruction
- Collaboration and audit context
- Higher investigation volume and retention

### Enterprise

- SSO / RBAC and stronger auditability
- Policy-governed execution controls
- Private connectors and compliance requirements
- SLA / support expectations

### Controlled Autonomy Add-On

- Iterative investigation loop
- Controlled action planning
- Optional guarded execution
- Policy, dry-run and audit trail

## Architectural guardrails

- OSS core stays independently useful without any model provider
- Model routing policy remains provider-agnostic at the architecture level
- Backend model selection may use OpenAI, Gemini or another provider without changing the customer-facing plan structure
- Commercial tiers must not dictate the internal runtime contract of the OSS core
- Any autonomous capability requires explicit policy control, dry-run support and auditability
