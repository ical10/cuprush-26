# Hermes AI Player Cohort — Implementation Plan

**Status:** Ready to implement after the Hi-Lo PoC.

## Delivery ownership

- **`[HERMES-BUILD]`** The implementation Hermes writes the schema, MCP tools, cron scripts, seed and provisioning commands, UI changes, tests, and setup documentation.
- **`[HITL]`** A human supplies Privy and Hermes credentials, approves auth or user-data changes, installs the cohort token, deploys the gateway, and runs the live mainnet check.
- Runtime cohort parents and subagents are product actors, not build owners.

## Goal

Run ten independent simulated players from one Hermes instance. Each player has its own participant record, strategy, prediction history, Privy server wallet, on-chain submissions, and leaderboard position.

The Hermes parent is only the trusted relay. A submission belongs to the player selected by `agent_key`, whose unique wallet signs the transaction. Ten decisions therefore become ten distinct player submissions, not one parent's submission.

These players are independent in identity and decision context, but not in custody: the application controls every wallet and the cohort credential. The UI must label them as AI players.

## Fixed design

- One Hermes gateway and one cron job, running every three minutes.
- Ten stable AI player identities stored by the application.
- Two sequential delegation batches of five players each.
- Subagents reason only; they receive no credentials, wallets, MCP tools, or web access.
- The parent validates results and sends one batched MCP submission.
- The backend binds every `agent_key` to one participant and one wallet.
- The existing submission, sponsorship, settlement, and scoring paths remain shared with humans.
- Agents stop submitting two minutes before `locks_at` to avoid deadline races.

## Runtime flow

1. Hermes runs a cheap pre-check against `GET /internal/agent-work-count`.
2. If no unanswered questions exist, the script returns `{"wakeAgent":false}`.
3. Otherwise, the cron session calls `get_pending_work` through the cohort MCP server.
4. The parent creates ten tasks from the returned roster and unanswered questions.
5. It runs two `delegate_task` batches of five. Results map to players by task index.
6. The parent validates each result. It ignores any identity claimed by a subagent.
7. It calls `submit_decisions` once with all valid decisions.
8. The backend resolves each `agent_key`, submits through that player's wallet, and returns per-decision results.
9. A later tick retries only unanswered or failed decisions.

Use a 60-second timeout and at most three model iterations per child. A timeout or malformed answer must never block the other players.

## Data model

### `participants`

Shared identity for humans and agents:

```text
id              uuid primary key
kind            'human' | 'agent'
display_name    varchar(32)
wallet_address  varchar(44) unique null until provisioned
points          integer default 0
current_streak  integer default 0
best_streak     integer default 0
created_at      timestamptz
```

Human `users` reference `participant_id`. Predictions reference `participant_id` and retain a unique constraint on `(participant_id, question_id)`.

### `agent_cohorts`

```text
id              uuid primary key
owner_user_id   uuid foreign key users.id
name            varchar(64)
token_hash      text unique
status          'active' | 'paused' | 'revoked'
created_at      timestamptz
rotated_at      timestamptz null
```

### `agents`

```text
participant_id  uuid primary key foreign key participants.id
cohort_id       uuid foreign key agent_cohorts.id
agent_key       varchar(32) unique
persona         text
strategy        text
model           varchar(64)
privy_wallet_id varchar(64) unique null until provisioned
status          'seeded' | 'active' | 'paused' | 'revoked'
created_at      timestamptz
```

### `agent_decisions`

```text
participant_id  uuid foreign key participants.id
question_id     uuid foreign key questions.id
outcome         varchar(16)
confidence      numeric check between 0 and 1
rationale       varchar(280)
created_at      timestamptz
unique (participant_id, question_id)
```

Store validated decisions only. Never store raw model output.

## MCP boundary

Expose one authenticated HTTP MCP server named `cohort`, with only these tools:

### `get_pending_work`

Returns:

- active players in the authenticated cohort;
- each player's persona, strategy, and short prediction history;
- only open questions that player has not answered;
- each question's facts, `allowed_outcomes`, and `locks_at`.

### `submit_decisions`

Accepts one array of:

```json
{
  "agent_key": "form-hawk",
  "question_id": "uuid",
  "outcome": "Higher",
  "confidence": 0.72,
  "rationale": "Recent form favors the reference team."
}
```

For every item, the backend must validate:

- the cohort token is active;
- the player belongs to that cohort and is active;
- the question is open and more than two minutes from `locks_at`;
- `outcome` appears in that question's `allowed_outcomes`;
- no prediction exists for that participant and question;
- confidence and rationale satisfy their schema limits.

Return independent success or error results. Duplicate submissions return the existing prediction instead of creating another one.

The cohort token authorizes the parent to relay for all ten players. It does not decide attribution. The backend-selected participant and that participant's wallet determine attribution.

## Subagent contract

Each task contains one player's persona, strategy, history, and all pending questions. The child returns only:

```json
{
  "decisions": [
    {
      "question_id": "uuid",
      "outcome": "Higher",
      "confidence": 0.72,
      "rationale": "One sentence, at most 280 characters."
    }
  ]
}
```

The parent binds result index to the assigned `agent_key`. Children never return or choose an identity. Parse with a strict schema and discard unknown questions, invalid outcomes, extra fields, or malformed output.

If a child fails, retry it once with a deterministic fallback prompt that requires one allowed outcome per question. If it fails again, skip that player until the next cron tick.

## Hermes configuration

- Run one gateway instance for this cohort.
- Pin the parent and child models.
- Set delegation concurrency to five.
- Give the cron session only `delegation` and the `cohort` MCP toolset.
- Give delegated children no toolsets.
- Load `HILO_COHORT_TOKEN` from Hermes environment configuration.
- Keep the token out of prompts, task context, seed data, and logs.
- Configure the pre-check script with a short HTTP timeout and fail closed.

The cron prompt must be self-contained because every run starts a fresh session. Application data is the only persistent memory.

## Seed and provisioning

**`[HERMES-BUILD]`** Implement the seed and provisioning commands described below.

Commit one non-secret seed containing exactly ten entries:

```json
{
  "agent_key": "form-hawk",
  "display_name": "Form Hawk",
  "persona": "Weights recent form heavily.",
  "strategy": "Prefer the outcome supported by the strongest recent form.",
  "model": "pinned-model-id"
}
```

The seed command idempotently creates the cohort, participants, and agents. It contains no tokens, wallet keys, or provider secrets.

The provisioning command:

1. Creates one Privy Solana server wallet per agent.
2. Uses `hilo-<environment>-<agent_key>` for both `external_id` and the idempotency key.
3. Stores only the Privy wallet ID and public address.
4. Generates a random cohort token, stores only its hash, and prints the plaintext once for Hermes setup.
5. Activates an agent only after its wallet mapping is complete.

**`[HITL]`** Provide the Privy authorization key, approve wallet policies, run provisioning in the target environment, and install the printed cohort token in Hermes.

Reuse the PoC paymaster/sponsored fee-payer path. Do not fund agent wallets with SOL.

Pausing or revoking an agent immediately removes it from pending work and blocks submissions. Rotating the cohort token invalidates the old token before Hermes receives the replacement.

## Migration

**`[HERMES-BUILD]`** The PoC already stores humans and predictions through `participants`. Add only `agent_cohorts`, `agents`, and `agent_decisions`; no ownership backfill or scoring migration is needed.

## Leaderboards

Use the shared participant scoring path:

- Overall: all participants.
- Humans: `kind = 'human'`.
- Agents: `kind = 'agent'`.

Return `kind` and cohort name in leaderboard responses. Render an **AI** badge and never present an agent as a human.

## Tests

Use Vitest for unit and integration tests.

Required coverage:

- strict child-output and MCP input validation;
- result-index identity binding and forged identity rejection;
- Higher/Lower and Yes/No outcome sets;
- lock-window and two-minute safety cutoff;
- revoked token, cross-cohort player, and paused agent rejection;
- partial success, timeout, retry, and retrying failed players only;
- idempotent batch submission and wallet provisioning;
- agent-table foreign keys, uniqueness, and status constraints;
- settlement scores an agent exactly once;
- Agent, Human, and Overall leaderboard filters;
- `[HITL]` one manual end-to-end tick through Hermes, Privy, and Solana.

## Acceptance criteria

- One Hermes instance produces decisions for ten stable, visibly distinct AI players.
- Each accepted decision is attributed to the correct participant and signed by that player's wallet.
- One player failing cannot block the other nine.
- Repeated ticks cannot create duplicate predictions or wallets.
- Hermes never receives wallet authority or backend secrets.
- Humans and agents use the same on-chain submission, settlement, scoring, and leaderboard machinery.

## References

- [Hermes delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)
- [Hermes cron](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)
- [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)
- [Privy server wallets](https://docs.privy.io/wallets/wallets/create/create-a-wallet)
- [PoC implementation plan](worldcup-hilo-hackathon-research.md)
