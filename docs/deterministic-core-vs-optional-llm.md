# Sentinel Mode Matrix: Deterministic Core vs Optional LLM Layer

This document clarifies scope for `v1.0.0-rc.2` to avoid confusion between OSS runtime value and future optional intelligence layers.

## Executive summary

- Sentinel OSS runtime is deterministic-first and fully usable without LLM.
- No public runtime contract for LLM-powered investigation exists in this repository for `v1.0.0-rc.2`.
- Any future intelligence layer is optional and must not break deterministic core behavior.

## Feature matrix

| Capability | Deterministic core (OSS, current) | Optional LLM layer (future/non-OSS runtime contract) |
|---|---|---|
| Cluster metric collection | Yes | Not required |
| Waste analysis and efficiency grading | Yes | Optional enrichment only |
| Incident detection and severity | Yes (rules + thresholds) | Optional explanation enhancement |
| `/health` and `/status` operational checks | Yes | Not required |
| Dashboard and API usability during LLM outage | Must remain usable | N/A |
| Additional narrative/investigation depth | Limited to deterministic templates | Candidate scope |
| Commercial connectors/policies/tiering | Out of scope | Candidate scope |

## What works today without LLM

- API endpoints documented in OpenAPI.
- Deterministic incident generation via thresholds and Kubernetes signals.
- FinOps views (waste, history, forecast, efficiency).
- Operational status pages and health checks.

## Current limits and risk boundaries

- Deterministic rules trade breadth for transparency and reproducibility.
- Root-cause narratives are heuristic/template-based, not model-generated.
- No LLM token, provider, or cost runtime contract is exposed in this OSS release.

## Design rule for future optional intelligence

If optional LLM capabilities are introduced later, they must:

1. Fail open to deterministic behavior (no hard dependency for core operations).
2. Keep API/core incident semantics stable.
3. Preserve clear operator visibility on what is deterministic vs model-assisted.

