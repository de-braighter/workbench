---
title: Story tracker
last_updated: 2026-05-24
---

# Story tracker

A coarse `type/story` GitHub issue per stream-of-work. Replaces local handoff files.

## Shape

- One issue per stream, not per PR
- Body = current state (rewrite as the stream evolves)
- Comments = append-only session log
- PRs link to the tracker via `Refs #N` (or `Closes #N` in the merge commit that retires the stream)

## When the stream closes

When the original goal is met, a PR retires the tracker via `Closes #N`. If new related-but-distinct work emerges, spawn a fresh tracker rather than reopening the old one.

## Where issues file

All issues file to ONE repo per project regardless of which code repo holds the change. For de Braighter projects:

- TBD — founder to confirm at the first tracker creation. Likely `de-braighter/exercir` for everything until a meta-tracker repo is set up.

## Story body template

See `templates/story/template.md`.

## Examples

- A coarse story "drill-board-preview rendering completion" had Phase 1 (PR #1332) + Phase 2 (deferred follow-up). When Phase 1 merged, Phase 2 spawned a fresh tracker.
