# TypeRacerDiscord

## Agent skills

### Issue tracker

Issues tracked as GitHub Issues on `DireDoch/TypeRacerDiscord`, via the `gh` CLI. See `Docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `Docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root + ADRs in `Docs/adr/`. See `Docs/agents/domain.md`.

### Git workflow

`develop` is the integration branch: feature branches squash-merge into it. `main` only moves on an explicit, user-requested versioned release — never merge/push to `main` on your own initiative, "continue" doesn't count as that request. Releasing means bumping `backend/Cargo.toml` and writing the `CHANGELOG.md` section; the tag and the GitHub release are then produced by CI, never by hand. Auto-close never fires from a PR into `develop` — close issues manually after each merge. Read before every commit/PR. See `Docs/agents/git-workflow.md`.
