# Git workflow

Read this before running `git commit`, `git push`, or `gh pr`/`gh issue` in this repo.

## Branches

- **`main`** — always releasable. Never commit or push directly to it; it only moves via a merged PR from `develop`.
- **`develop`** — integration branch. Every feature/fix branches off `develop` and PRs back into it. This is the day-to-day base for new work.
- Feature branches: `feat/<issue>-<slug>`, `fix/<issue>-<slug>`, `docs/<issue>-<slug>` (or `docs/<slug>`), `chore/<slug>`, `ci/<slug>` — matches existing history (`feat/62-taille-salon`, `docs/60-context-inventaire`, `chore/ponytail-debt-ledger`…).

## Working an issue

1. `git checkout develop && git pull && git checkout -b feat/<issue>-<slug>`.
2. Commit messages: **French**, imperative, no `Co-Authored-By` trailer (project convention — see memory `commit-style-typeracer`).
3. `gh pr create --base develop --title "..." --body "..."`.

## Merging a PR into `develop`

- **Squash-merge** (`gh pr merge --squash`). Every PR merged so far is a single squashed commit (`git log --oneline`) — keep that pattern.
- **The auto-close keyword must be English**: `Closes #N` / `Fixes #N`, even in an otherwise-French body. GitHub does **not** recognize the French `Ferme #N` — issues #60 and #62 stayed open after their PRs merged for exactly this reason. If the body uses the French phrasing anyway, close the issue by hand: `gh issue close <n> --comment "..."`.

## Releasing: `develop` → `main`

When the work sitting on `develop` is stable and ready to ship:

```
gh pr create --base main --head develop --title "release: ..."
```

Merge as a **regular merge, not a squash** — the individual features are already squashed commits on `develop`; squashing again would collapse that history into one opaque commit.

## Never

- Push directly to `main` or `develop`.
- Force-push either.
- Skip CI or hooks (`--no-verify`) to force a merge through.
