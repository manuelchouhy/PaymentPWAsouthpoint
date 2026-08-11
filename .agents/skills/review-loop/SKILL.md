---
name: review-loop
description: Use when a small, finished vertical slice or PR is ready for review and you want to iterate review→fix→re-review until it is clean. Runs /code-review on the diff, fixes only real findings, re-reviews, and repeats until no medium/high-severity findings remain or a 5-turn cap is hit. Trigger when the user says "pasá el review-loop", "revisá y arreglá este diff hasta que quede limpio", "loop de code-review sobre el PR", "dejá el PR sin findings", or wants an iterative review→fix cycle on a finished slice. Adapts the Greptile "greploop" / GP-loop to Claude Code's native reviewer (no external paid service, no PR/remote required).
---

# Review Loop

Iterate review → fix → re-review on a small change until it is clean: zero medium/high-severity findings, or a hard cap of 5 turns.

## When to use

- A vertical slice / PR is finished and ready for review.
- The diff is small enough to review reliably (see pre-flight).
- Findings are specific enough to act on, and tests/typechecks can confirm fixes.

Do not use on huge diffs (thousands of lines) or for unclear product decisions.

## Pre-flight: is the diff small enough?

Before looping, check the diff size:

```powershell
git --no-pager diff --stat
```

If the change approaches or exceeds ~400 lines of diff, stop and split it into smaller slices / stacked PRs first (matching the project's PR-size rule). The loop loses accuracy on large diffs — both the reviewer and the coding agent.

## Modo PR (cuando lo dispara el hook)

Si llegaste acá porque el hook `review-loop-trigger` te lo pidió tras un `gh pr create` / `git push`, revisá el **diff del branch** (lo que el PR introduce sobre su base), no el working-tree:

```powershell
git diff <base>...HEAD --stat   # <base> es la rama base del PR (main/develop/etc., la que indicó el hook)
```

Usá ese mismo rango (`git diff <base>...HEAD`) como entrada de cada `/code-review` del loop. El modo working-tree (`git diff` sin rango) sigue siendo el default para invocación manual sobre cambios sin commitear.

## Modo commit / local (cuando lo dispara un `git commit`)

Si llegaste acá tras un `git commit` (típico en repos locales sin remote), revisá el diff del slice recién cerrado. Si el branch tiene una base resoluble, usá el rango del branch; si no, revisá el último commit:

```powershell
git --no-pager diff <base>...HEAD --stat   # si hay base (sirve también con base local, sin remote)
git --no-pager show --stat HEAD            # fallback: solo el último commit
```

Si el commit es solo un test que falla a propósito (RED de TDD) y todavía no hay código de implementación que revisar, cerrá el loop sin acción: no hay nada que arreglar aún.

## The loop

One turn = one complete pass through these three steps:

1. Run `/code-review` on the current diff.
2. Read the findings. Fix ONLY findings that are real and relevant to this change. Do not rewrite unrelated code.
3. For each bug fix, add or update a test when practical. Run the relevant tests/typechecks.

After step 3, begin the next turn back at step 1 (which re-reviews the updated diff). Stop when ANY of:

- The latest `/code-review` surfaced no findings of medium or high severity.
- 5 turns have run.
- You are blocked by a decision that needs a human → stop and report.

Note: `/code-review` reports findings by severity, not a numeric score — "clean" means the latest review surfaced no medium/high-severity findings (the Greptile 5/5 score does not exist here).

## Guardrails

- Reviewers produce false positives — don't blindly accept every finding.
- Agents over-fix — touch only what the finding is about.
- A clean review means this diff looks clean, not that the product is valuable.
- Tests are the objective signal; "looks fine" is not a pass.

## Final report

- List the findings resolved this run.
- State the tests/typechecks run and their result.
- Note any finding deliberately not fixed (with reason) and any blocker that needs a human.
