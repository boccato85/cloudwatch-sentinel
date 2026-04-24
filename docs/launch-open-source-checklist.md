# Sentinel Open Source Launch Checklist

Owner: `@boccato85`  
Status date: `2026-04-24`

## Goal

Launch Sentinel publicly with a credible technical baseline, clear onboarding, and a repeatable promotion flow.

## How to Use

- Track execution in GitHub Project (Now/Next/Later).
- Keep this file as the launch source of truth.
- Link each task to one GitHub issue/PR when applicable.

## Definition of Done (Launch)

- [ ] Public repo has clear Quick Start + Quick Demo.
- [ ] Release artifacts are coherent (`README`, `CHANGELOG`, `RELEASE`, tags/images).
- [ ] Security/operations docs are explicit enough for first adopters.
- [ ] First promotion wave is published with links to install/demo/evidence.

---

## Week 1 - Release Readiness + Demo Assets

### Day 1 - Freeze scope and baseline

- [ ] Confirm launch scope (what is in/out for first public wave).
- [ ] Confirm branch/tag strategy for launch candidate.
- [ ] Open/refresh launch tracking issues in Project.

Done criteria:
- [ ] No ambiguous scope items remain for launch week.

### Day 2 - Quick demo production

- [ ] Record dashboard flow (overview -> incidents -> waste -> status).
- [ ] Export `MP4` and optimized `GIF`.
- [ ] Add demo assets under `docs/assets/`.
- [ ] Embed Quick Demo section in `README.md`.

Done criteria:
- [ ] New visitor understands product value in under 60 seconds.

### Day 3 - Install path hardening

- [ ] Validate clean install via Helm (production-style path).
- [ ] Validate local/dev path (`docker compose`).
- [ ] Ensure smoke test instructions are accurate.

Done criteria:
- [ ] A new user can run Sentinel end-to-end without implicit tribal knowledge.

### Day 4 - Docs and trust package

- [ ] Recheck consistency across `README.md`, `CHANGELOG.md`, `RELEASE.md`, `ROADMAP.md`.
- [ ] Verify support matrix reflects actual tested/supported boundaries.
- [ ] Verify `SECURITY.md` and `CONTRIBUTING.md` are launch-grade.

Done criteria:
- [ ] No conflicting versioning or support statements.

### Day 5 - Candidate release dry run

- [ ] Dry run tag/release notes workflow.
- [ ] Validate GHCR image publication path.
- [ ] Validate CI checks used as launch gate.

Done criteria:
- [ ] Release flow works without manual improvisation.

---

## Week 2 - Public Release + Promotion

### Day 6 - Publish release candidate / release

- [ ] Create tag and GitHub Release.
- [ ] Publish final release notes.
- [ ] Pin main launch issue/discussion if used.

Done criteria:
- [ ] Public release is reachable with install + demo + docs links.

### Day 7 - Promotion kit

- [ ] Prepare short launch copy (`problem -> solution -> proof -> CTA`).
- [ ] Prepare one technical post and one product-style post.
- [ ] Prepare links package (repo, demo, docs, release).

Done criteria:
- [ ] Launch communications are copy-paste ready.

### Day 8 - Channel execution

- [ ] Publish on selected channels (LinkedIn/X/communities).
- [ ] Publish one deep technical thread/article.
- [ ] Share “how to test in 5 minutes”.

Done criteria:
- [ ] At least one discoverable public launch artifact per channel.

### Day 9 - Feedback triage

- [ ] Triage incoming issues/questions.
- [ ] Label feedback as bug/docs/ux/adoption.
- [ ] Convert top feedback into actionable issues.

Done criteria:
- [ ] First wave feedback is structured into backlog, not lost in chat.

### Day 10 - Week-1 post-launch update

- [ ] Publish short update with adoption signal and fixes.
- [ ] Close solved launch issues and update roadmap pointers.
- [ ] Re-prioritize `P1/P2/P3` with real adopter data.

Done criteria:
- [ ] Post-launch state is transparent and actionable.

---

## Now / Next / Later Mapping

### Now

- [ ] Demo asset capture and README embed.
- [ ] Install path validation (Helm + compose).
- [ ] Release flow dry run.

### Next

- [ ] Public release + first channel wave.
- [ ] Feedback triage cadence.

### Later

- [ ] Continuous content (benchmarks, incident walkthroughs, case-style examples).
- [ ] UX hardening (`priority:P3`) in milestone `v1.1 (M8)`.

