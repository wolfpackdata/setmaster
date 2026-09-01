<!-- Wolfpack GitHub SOP — PR template. Squash-merges into `develop`. See docs/sop/02-commits-and-prs.md. -->

## Summary
<!-- What does this PR change, and why? One or two sentences. -->

## Related issues
<!-- Plain refs only — `#N` / `Refs #N`. NEVER closing keywords (Closes / Fixes / Resolves):
     the issue's Reporter closes it after verifying. See docs/sop/03-issues-and-labels.md. -->
Refs #

## Risk tier
<!-- risk-tiered = auth · data migration · security · release tooling · CI or rulesets · the SOP/skills other agents obey. Anything else is low. docs/sop/10-ai-review.md -->
low   <!-- or: risk-tiered → AI review required -->

## Acceptance criteria met
<!-- Copy the issue's criteria; tick each with the evidence, or write why not. -->
- [ ]

## Local verification results
<!-- CI runs where the repo has something to run; these local results complement it, they
     don't replace it. Paste the commands you actually ran and their results, credentials
     redacted (or "N/A — docs only"). -->

```
# e.g. npm test, npm run build, lint — with their output/summary
```

## Review handoff
<!-- Or the single line: not requested — low risk. See docs/sop/10-ai-review.md. -->
Run id:
Reviewed SHA:
Findings: P0 _ · P1 _ · P2 _ · P3 _
Dispositions:

## Checklist

- [ ] Conventional Commit title with an area scope (e.g. `feat(matrix): …`, `fix(compare): …`).
- [ ] Branch is `prefix/issue-number-kebab-slug`, cut from `develop`.
- [ ] No closing keywords — issues referenced with `#N` / `Refs #N` only.
- [ ] Risk tier stated; AI review done or `not requested — low risk`.
- [ ] Acceptance criteria copied from the issue and each one ticked with evidence.
- [ ] Full local suites run and results pasted above (or explicitly N/A).

<!-- `fixed-on-develop` is no longer a checklist item here. A checklist is read BEFORE the merge
     button, so a post-merge instruction on it could never fire — which is how the 2026-08-31
     misses happened. It is now applied by .github/workflows/fixed-on-develop.yml from the
     `Refs #N` lines above, and owned by the merging Maintainer where that workflow is not
     installed. See docs/sop/03-issues-and-labels.md. -->

