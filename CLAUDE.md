# CLAUDE.md — setmaster

## Canonical repository
**`wolfpackdata/setmaster`** — always target this `owner/repo` for issues, PRs,
and labels. Resolve it from git (`gh repo view --json nameWithOwner`), never from the
selected subfolder name.

## GitHub workflow
This repo follows the Wolfpack GitHub SOP (the `github-gitflow` and `create-github-issue`
skills + the [`wolfpackdata/wp-github-sop`](https://github.com/wolfpackdata/wp-github-sop)
repo). Nothing here overrides it — see those for branching, commits, PRs, labels,
versioning, and releases. Risk-tiered changes — auth, data migration, security, release
tooling, CI/rulesets, or the SOP and skills other agents obey — and every release PR take
the **AI-review stage** (Codex as the AI Reviewer) before merge; see
`docs/sop/10-ai-review.md` in that repo. Sessions that can't load the skills (e.g. the
mobile app) read the SOP from that repo's `docs/sop/`.

## Notion workspace
Work that touches the Notion team space follows the Wolfpack Notion SOP (the
`notion-create-project` / `-task` / `-product` / `-client` and `notion-link-task-github`
skills + the `wolfpackdata/wp-notion-team` repo's `docs/notion-sop/`). Nothing here
overrides it — the live Notion team space is authoritative for icons, templates, and schema.
Full SOP page (readable from any session, mobile included):
[Wolfpack Notion SOP](https://app.notion.com/p/39dc70e5c7b481078ab8e2f2de4603b8). If that
link doesn't resolve, warn the Requester it's dead, then search the Notion teamspace for
the *Wolfpack Notion SOP* page (Wolfpack Document Hub) to recover the current URL.

## What this repo is
Offline DJ set-preparation and Traktor/Spotify catalog-analysis tool — a local web app that reads your Traktor collection read-only.
