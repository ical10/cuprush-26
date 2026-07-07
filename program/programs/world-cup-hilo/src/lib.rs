//! World Cup Hi-Lo on-chain program.
//!
//! Two accounts (Question, Prediction), three instructions (create_question,
//! submit_prediction, settle_question) — see the research doc "On-chain
//! scope". PDA seeds enforce one Question per canonical rule hash and one
//! immutable Prediction per (question, player wallet). `submit_prediction`
//! enforces `opens_at`/`locks_at` on-chain so a custom client can never
//! predict early or late; `settle_question` refuses double settlement.
//!
//! Build and devnet deploy are HITL (issue 13). The declared id is a
//! placeholder replaced by `anchor keys sync` at deploy time. For an
//! inter-fixture question the authority proves the benchmark through
//! TxOracle (Equal predicate) before calling `create_question` and stores
//! the proven value in `benchmark`; `settle_question` then settles the new
//! fixture against that stored benchmark.

use anchor_lang::prelude::*;

declare_id!("9u7uuj7S8kMon564b4TA8Gc7RaYXSC5QgjDz8fFgmGCU");

pub const QUESTION_SEED: &[u8] = b"question";
pub const PREDICTION_SEED: &[u8] = b"prediction";

pub const MAX_FIXTURE_ID_LEN: usize = 32;
pub const MAX_STAT_KEY_LEN: usize = 32;

#[program]
pub mod world_cup_hilo {
    use super::*;

    /// Creates the one immutable Question account for a canonical rule.
    /// PDA seeds `[b"question", rule_hash]` make re-creation of the same
    /// rule fail at the runtime level (account already in use).
    pub fn create_question(ctx: Context<CreateQuestion>, args: CreateQuestionArgs) -> Result<()> {
        require!(args.locks_at > args.opens_at, HiLoError::InvalidWindow);
        require!(
            args.fixture_id.len() <= MAX_FIXTURE_ID_LEN,
            HiLoError::FieldTooLong
        );
        require!(
            args.stat_key_1.len() <= MAX_STAT_KEY_LEN
                && args.stat_key_2.len() <= MAX_STAT_KEY_LEN,
            HiLoError::FieldTooLong
        );
        if let Some(benchmark_fixture_id) = &args.benchmark_fixture_id {
            require!(
                benchmark_fixture_id.len() <= MAX_FIXTURE_ID_LEN,
                HiLoError::FieldTooLong
            );
            // An inter-fixture question is only creatable with its proven
            // benchmark; an unprovable benchmark must fall back to an
            // intra-fixture template off-chain instead.
            require!(args.benchmark.is_some(), HiLoError::MissingBenchmark);
        }

        let question = &mut ctx.accounts.question;
        question.authority = ctx.accounts.authority.key();
        question.rule_hash = args.rule_hash;
        question.fixture_id = args.fixture_id;
        question.benchmark_fixture_id = args.benchmark_fixture_id;
        question.stat_key_1 = args.stat_key_1;
        question.stat_key_2 = args.stat_key_2;
        question.operator = args.operator;
        question.comparison = args.comparison;
        question.threshold = args.threshold;
        question.benchmark = args.benchmark;
        question.opens_at = args.opens_at;
        question.locks_at = args.locks_at;
        question.status = QuestionStatus::Open;
        question.result = None;
        question.bump = ctx.bumps.question;
        Ok(())
    }

    /// Records one immutable prediction for (question, player). PDA seeds
    /// `[b"prediction", question, player]` mean a second submission for the
    /// same pair fails at `init` — the choice can never change. The open
    /// window is enforced on-chain against the cluster clock.
    pub fn submit_prediction(ctx: Context<SubmitPrediction>, outcome: Outcome) -> Result<()> {
        let question = &ctx.accounts.question;
        require!(
            question.status == QuestionStatus::Open,
            HiLoError::QuestionNotOpen
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now >= question.opens_at, HiLoError::BeforeOpen);
        require!(now < question.locks_at, HiLoError::AfterLock);

        let prediction = &mut ctx.accounts.prediction;
        prediction.question = question.key();
        prediction.player = ctx.accounts.player.key();
        prediction.outcome = outcome;
        prediction.submitted_at = now;
        prediction.resolved = false;
        prediction.correct = false;
        prediction.bump = ctx.bumps.prediction;
        Ok(())
    }

    /// Settles the question exactly once. The authority derives `result`
    /// from TxOracle-proven stats (for inter-fixture questions, validating
    /// the new fixture against the stored benchmark) off-chain; a repeated
    /// call is refused so a retry must read the existing on-chain result.
    pub fn settle_question(ctx: Context<SettleQuestion>, result: QuestionResult) -> Result<()> {
        let question = &mut ctx.accounts.question;
        require!(
            question.status != QuestionStatus::Settled,
            HiLoError::AlreadySettled
        );

        question.result = Some(result);
        question.status = QuestionStatus::Settled;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateQuestionArgs {
    /// sha256 of the canonical rule (src/questions/rule-hash.ts).
    pub rule_hash: [u8; 32],
    pub fixture_id: String,
    /// Set only for inter-fixture benchmark questions.
    pub benchmark_fixture_id: Option<String>,
    pub stat_key_1: String,
    pub stat_key_2: String,
    pub operator: Operator,
    pub comparison: Comparison,
    pub threshold: Option<i64>,
    /// Proven benchmark value (required when benchmark_fixture_id is set).
    pub benchmark: Option<i64>,
    pub opens_at: i64,
    pub locks_at: i64,
}

#[derive(Accounts)]
#[instruction(args: CreateQuestionArgs)]
pub struct CreateQuestion<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Question::INIT_SPACE,
        seeds = [QUESTION_SEED, args.rule_hash.as_ref()],
        bump,
    )]
    pub question: Account<'info, Question>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitPrediction<'info> {
    #[account(
        seeds = [QUESTION_SEED, question.rule_hash.as_ref()],
        bump = question.bump,
    )]
    pub question: Account<'info, Question>,
    #[account(
        init,
        payer = payer,
        space = 8 + Prediction::INIT_SPACE,
        seeds = [PREDICTION_SEED, question.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub prediction: Account<'info, Prediction>,
    /// The embedded user wallet: owns the prediction and authorizes it.
    pub player: Signer<'info>,
    /// The sponsored fee payer (Privy sponsorship or app fee-payer wallet);
    /// pays rent + fees so the player never needs SOL.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleQuestion<'info> {
    #[account(
        mut,
        seeds = [QUESTION_SEED, question.rule_hash.as_ref()],
        bump = question.bump,
        has_one = authority @ HiLoError::UnauthorizedSettlement,
    )]
    pub question: Account<'info, Question>,
    pub authority: Signer<'info>,
}

/// One immutable question rule. The database keeps the human-readable copy;
/// this account keeps only what settlement and verification need.
#[account]
#[derive(InitSpace)]
pub struct Question {
    /// Only this key may settle the question.
    pub authority: Pubkey,
    pub rule_hash: [u8; 32],
    #[max_len(MAX_FIXTURE_ID_LEN)]
    pub fixture_id: String,
    #[max_len(MAX_FIXTURE_ID_LEN)]
    pub benchmark_fixture_id: Option<String>,
    #[max_len(MAX_STAT_KEY_LEN)]
    pub stat_key_1: String,
    #[max_len(MAX_STAT_KEY_LEN)]
    pub stat_key_2: String,
    pub operator: Operator,
    pub comparison: Comparison,
    pub threshold: Option<i64>,
    pub benchmark: Option<i64>,
    pub opens_at: i64,
    pub locks_at: i64,
    pub status: QuestionStatus,
    pub result: Option<QuestionResult>,
    pub bump: u8,
}

/// One player's immutable choice on one question.
#[account]
#[derive(InitSpace)]
pub struct Prediction {
    pub question: Pubkey,
    pub player: Pubkey,
    pub outcome: Outcome,
    pub submitted_at: i64,
    pub resolved: bool,
    pub correct: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Operator {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Comparison {
    Equal,
    GreaterThan,
    LessThan,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum QuestionStatus {
    Open,
    Settled,
    Void,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Yes,
    No,
    Higher,
    Lower,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum QuestionResult {
    Yes,
    No,
    Higher,
    Lower,
    Push,
}

#[error_code]
pub enum HiLoError {
    #[msg("locks_at must be after opens_at")]
    InvalidWindow,
    #[msg("a string field exceeds its maximum length")]
    FieldTooLong,
    #[msg("an inter-fixture question requires a proven benchmark")]
    MissingBenchmark,
    #[msg("the question is not open")]
    QuestionNotOpen,
    #[msg("predictions are not accepted before opens_at")]
    BeforeOpen,
    #[msg("predictions are not accepted at or after locks_at")]
    AfterLock,
    #[msg("the question is already settled")]
    AlreadySettled,
    #[msg("only the question authority may settle it")]
    UnauthorizedSettlement,
}
