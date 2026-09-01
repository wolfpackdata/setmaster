# AGENTS.md — setmaster

Codex reads this file automatically at the repo root. It is the **repo-level** contract. The
**global** contract — the one that binds Codex in *every* Wolfpack repo — lives at
`~/.codex/AGENTS.md` and is maintained in
[`wolfpackdata/wp-codex-sop`](https://github.com/wolfpackdata/wp-codex-sop). Where the two
disagree, **this file wins** (it is nearer the work).

Keep this file thin. It carries **pointers, not copies**: Codex truncates instruction files
past `project_doc_max_bytes` with no warning, and a stale copy of an SOP silently overrides
the good one.

## Canonical repository
**`wolfpackdata/setmaster`** — always target this `owner/repo` for issues, PRs, and labels.
Resolve it from git (`gh repo view --json nameWithOwner`), never from the selected subfolder
name.

## GitHub workflow
This repo follows the Wolfpack GitHub SOP —
[`wolfpackdata/wp-github-sop`](https://github.com/wolfpackdata/wp-github-sop), authoritative
text in that repo's `docs/sop/`. **Read it before the first git or GitHub action of a
session**; nothing here overrides it. Risk-tiered changes — auth, data migration, security,
release tooling, CI/rulesets, or the SOP and skills other agents obey — and **every** release
PR take the **AI-review stage** before merge, with Codex as the AI Reviewer: see
`docs/sop/10-ai-review.md` and `docs/sop/runbooks/ai-review.md` in that repo, and
`docs/sop/09-roles-and-permissions.md` for what the AI Reviewer may and may not do (it
reviews; its approval never satisfies the `main` gate).

## Notion workspace
Work that touches the Notion team space follows the Wolfpack Notion SOP —
[Wolfpack Notion SOP](https://app.notion.com/p/39dc70e5c7b481078ab8e2f2de4603b8) (mirror:
`wolfpackdata/wp-notion-team` → `docs/notion-sop/`). **Read it before the first Notion write
of a session**, and before that write confirm via `self` that the identity is **Main**
(`main@wolfstrategyllc.com`, `39cd872b-594c-817a-8412-00023f0d7dc8`) — any other identity is
a hard stop. Codex and Claude both act as Main, so **Codex suffixes every Notion comment it
writes with ` [codex]`**; Claude's are unmarked. If the SOP link doesn't resolve, warn the
Requester it's dead, then search the Notion teamspace for the *Wolfpack Notion SOP* page
(Wolfpack Document Hub) to recover the current URL.

## What this repo is
Offline DJ set-preparation and Traktor/Spotify catalog-analysis tool — a local web app that reads your Traktor collection read-only.
