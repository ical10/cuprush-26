# Litepaper disclaimer and license plan

## Goal

Patch the litepaper with the confirmed product answers, add a repo-level disclaimer, add a license, commit, and push.

## Scope

- Update `docs/cuprush-26-litepaper.md`:
  - Points and status only.
  - Reward state stays database-only.
  - Sponsor prizes are future plans pending agreements and rules.
  - Solana devnet only.
  - Distribution starts with X posts, Telegram community engagement, and QR codes.
  - Match scope covers every 2026 fixture.
  - English-first.
  - Replace open questions with confirmed scope and future plans.
- Add repo-level disclaimer and license section to `README.md`.
- Add `LICENSE` with MIT terms for the hackathon PoC.
- Add the MIT license field to `package.json`.

## Validation

- Run lint.
- Run typecheck.
- Run unit tests.
- Run web tests.
- Run integration tests if the local database is available.

## Commit

Use a conventional commit after validation passes.
