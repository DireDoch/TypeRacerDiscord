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

**`main` only moves when the user explicitly asks for a release, by name, in that specific
moment.** Work accumulates on `develop` indefinitely between releases — there is no
default cadence, and "continue" / "wrap this up" / "merge everything" do **not** authorize
touching `main`. Only an explicit release request does (e.g. "merge develop to main",
"let's release v1.2.0"). If in doubt, ask before opening or merging anything against `main`.

A release is versioned — `1.x.x` at minimum (this project hasn't shipped a `0.x` in the
tag sense; treat the first release to `main` under this workflow as `v1.0.0` or later).
When the user does ask for one:

```
gh pr create --base main --head develop --title "release: vX.Y.Z — ..."
```

Merge as a **regular merge, not a squash** — the individual features are already squashed
commits on `develop`; squashing again would collapse that history into one opaque commit.
Tag it afterwards: `git tag vX.Y.Z && git push origin vX.Y.Z`.

## Never

- Merge or push to `main` without the user explicitly requesting that release, in the moment.
- Push directly to `main` or `develop` (bypassing a PR).
- Force-push either.
- Skip CI or hooks (`--no-verify`) to force a merge through.
