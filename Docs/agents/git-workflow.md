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
- **The auto-close keyword must be English**: `Closes #N` / `Fixes #N`, even in an otherwise-French body. GitHub does **not** recognize the French `Ferme #N`.
- **But even a correct `Closes #N` will not fire from a PR into `develop`.** GitHub only applies auto-close to PRs targeting the **default branch** (`main`). So after every merge into `develop`, **close the issues by hand**: `gh issue close <n> --comment "..."`. Verified 2026-08-03 — issues #91–#96 all carried a well-formed `Closes #N` and all six stayed open. This is the normal case here, not an accident; budget for it on every PR.

## Releasing: `develop` → `main`

**`main` only moves when the user explicitly asks for a release, by name, in that specific
moment.** Work accumulates on `develop` indefinitely between releases — there is no
default cadence, and "continue" / "wrap this up" / "merge everything" do **not** authorize
touching `main`. Only an explicit release request does (e.g. "merge develop to main",
"let's release v1.2.0"). If in doubt, ask before opening or merging anything against `main`.

A release is versioned. The project ships `0.x` pre-releases (`v0.0.1` onwards); `1.0.0`
is reserved for the first version declared stable. When the user does ask for one:

1. **Bump `backend/Cargo.toml`, then `backend/Cargo.lock` with it** (`cargo update -p
   typeracer-discord-backend`, or edit the one `version =` under that package name — a
   stale lockfile is silently rewritten today, but breaks the moment anyone adds
   `--locked` to the release build). That version is the single source of truth — the
   Rust binary is the deliverable (it serves the frontend's `dist/`), and Cargo bakes the
   number into it. `frontend/package.json`'s version is inert: the package is `private`
   and never published, so leave it alone.
2. **Write the `CHANGELOG.md` section**, `## vX.Y.Z — short title`, aimed at a player
   rather than a developer. This is not optional: the pipeline fails loudly when the
   section is missing or empty.
3. Open and merge the PR:

```
gh pr create --base main --head develop --title "release: vX.Y.Z — ..."
gh pr merge <n> --merge
```

Merge as a **regular merge, not a squash** — the individual features are already squashed
commits on `develop`; squashing again would collapse that history into one opaque commit.

**Do not tag by hand.** The `release` job in `.github/workflows/ci.yml` (issue #117) takes
over on push to `main`: it creates the tag on that commit, builds a static
`x86_64-unknown-linux-musl` binary plus the frontend `dist/`, attaches them as a
`.tar.gz`, and publishes the release — as a **pre-release** whenever the version starts
with `0.`.

The job's guard is the version itself: if a release already exists for the version in
`Cargo.toml`, it **skips silently** and CI stays green. That is what makes the section
merges below safe — they move `main` without publishing anything.

**The release build needs the `VITE_DISCORD_CLIENT_ID` repository variable.** Vite freezes
`import.meta.env.VITE_*` at build time, and `.env` is gitignored, so without it the
published bundle silently falls into dev mode — no Embedded App SDK handshake, every
player becomes `dev-player-1`, and the deployer cannot fix it because the value is
compiled in. The job refuses to build rather than ship that. The client id is public (it
sits in cleartext in `frontend/.env.example`); only `DISCORD_CLIENT_SECRET` is a secret,
and it stays backend-side. Set it once:

```
gh variable set VITE_DISCORD_CLIENT_ID --body <client id>
```

### Standing exception: the parameter-issues batch (#59–71)

For the Settings-menu PRD (#59) and its children (#60–71) specifically, the user has
pre-approved section merges to `main` — no fresh ask needed each time. A "section" is one
themed group of issues:

- **Scaffold**: #60 (done).
- **Room settings**: #61, #62 (done), #63.
- **Difficulty & Failed**: #64, #71.
- **Preferences**: #65, #66, #67, #68, #69, #70.

When every issue in a group is closed, merge `develop` → `main` for that group: **regular
merge, no squash, no version tag** — this is not a release, just keeping `main` reasonably
current between real releases. Everything else in "Never" below still holds (no
force-push, no skipped CI) — only the "ask first" part of the `main` rule is waived, and
only for this named batch.

## Never

- Merge or push to `main` without the user explicitly requesting that release, in the moment.
- Push directly to `main` or `develop` (bypassing a PR).
- Force-push either.
- Skip CI or hooks (`--no-verify`) to force a merge through.
