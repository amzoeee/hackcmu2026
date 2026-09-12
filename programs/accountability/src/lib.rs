#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("EE5h4kXh8Pk2ECthCABpK7bLQ934n4TZjkRsuDgskYBb");

const MAX_TASK_LENGTH: usize = 160;
const MAX_PARTICIPANTS: usize = 10;

#[constant]
pub const SETTLEMENT_GRACE_SECONDS: i64 = 300;

#[program]
pub mod accountability {
    use super::*;

    pub fn create_pot(
        ctx: Context<CreatePot>,
        identifier: u64,
        task: String,
        stake: u64,
        deadline: i64,
        judge: Pubkey,
    ) -> Result<()> {
        require!(!task.trim().is_empty(), AccountabilityError::TaskRequired);
        require!(
            task.len() <= MAX_TASK_LENGTH,
            AccountabilityError::TaskTooLong
        );
        require!(stake > 0, AccountabilityError::InvalidStake);

        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, AccountabilityError::DeadlineMustBeFuture);
        require!(
            deadline.checked_add(SETTLEMENT_GRACE_SECONDS).is_some(),
            AccountabilityError::InvalidDeadline
        );
        require_keys_neq!(
            judge,
            ctx.accounts.pot.key(),
            AccountabilityError::InvalidJudge
        );

        let pot = &mut ctx.accounts.pot;
        pot.creator = ctx.accounts.creator.key();
        pot.judge = judge;
        pot.identifier = identifier;
        pot.task = task;
        pot.stake = stake;
        pot.deadline = deadline;
        pot.created_at = now;
        pot.yes_participants = Vec::new();
        pot.no_participants = Vec::new();
        pot.settled = false;
        pot.outcome = None;
        Ok(())
    }

    pub fn join_pot(ctx: Context<JoinPot>, side: Side) -> Result<()> {
        let pot = &mut ctx.accounts.pot;
        let now = Clock::get()?.unix_timestamp;
        require!(!pot.settled, AccountabilityError::PotSettled);
        require!(now < pot.deadline, AccountabilityError::DeadlinePassed);
        require!(
            pot.yes_participants.len() + pot.no_participants.len() < MAX_PARTICIPANTS,
            AccountabilityError::PotFull
        );
        require!(
            !pot.yes_participants
                .contains(&ctx.accounts.participant.key())
                && !pot
                    .no_participants
                    .contains(&ctx.accounts.participant.key()),
            AccountabilityError::AlreadyParticipating
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.participant.to_account_info(),
                    to: pot.to_account_info(),
                },
            ),
            pot.stake,
        )?;

        match side {
            Side::Yes => pot.yes_participants.push(ctx.accounts.participant.key()),
            Side::No => pot.no_participants.push(ctx.accounts.participant.key()),
        }
        Ok(())
    }

    pub fn settle_pot(ctx: Context<SettlePot>, completed: bool) -> Result<()> {
        let pot = &mut ctx.accounts.pot;
        let now = Clock::get()?.unix_timestamp;
        require_keys_eq!(
            pot.judge,
            ctx.accounts.judge.key(),
            AccountabilityError::UnauthorizedJudge
        );
        require!(!pot.settled, AccountabilityError::PotSettled);
        require_settlement_window(pot.deadline, now)?;

        let everyone = [&pot.yes_participants[..], &pot.no_participants[..]].concat();
        let unopposed = pot.yes_participants.is_empty() || pot.no_participants.is_empty();
        let (recipients, payout) = if everyone.is_empty() {
            (Vec::new(), 0)
        } else if unopposed && completed {
            (everyone, pot.stake)
        } else if unopposed {
            // An unopposed failed task forfeits the recorded stakes to the named judge.
            let staked_pool = pot
                .stake
                .checked_mul(everyone.len() as u64)
                .ok_or(error!(AccountabilityError::InsufficientPotBalance))?;
            (vec![pot.judge], staked_pool)
        } else {
            let winners = if completed {
                &pot.yes_participants
            } else {
                &pot.no_participants
            };
            let rent_reserve = Rent::get()?.minimum_balance(pot.to_account_info().data_len());
            let available = pot
                .to_account_info()
                .lamports()
                .saturating_sub(rent_reserve);
            (winners.clone(), available / winners.len() as u64)
        };
        pay_recipients(pot, ctx.remaining_accounts, &recipients, payout)?;

        pot.settled = true;
        pot.outcome = Some(completed);
        Ok(())
    }

    pub fn refund_pot(ctx: Context<RefundPot>) -> Result<()> {
        let pot = &mut ctx.accounts.pot;
        require!(!pot.settled, AccountabilityError::PotSettled);
        require_refund_window(pot.deadline, Clock::get()?.unix_timestamp)?;

        // Exact original stakes are returned; donations and any dust stay with the rent reserve.
        let recipients = [&pot.yes_participants[..], &pot.no_participants[..]].concat();
        pay_recipients(pot, ctx.remaining_accounts, &recipients, pot.stake)?;
        pot.settled = true;
        pot.outcome = None;
        Ok(())
    }
}

fn require_settlement_window(deadline: i64, now: i64) -> Result<()> {
    require!(now >= deadline, AccountabilityError::DeadlineNotReached);
    let refund_at = deadline
        .checked_add(SETTLEMENT_GRACE_SECONDS)
        .ok_or(error!(AccountabilityError::InvalidDeadline))?;
    require!(
        now < refund_at,
        AccountabilityError::SettlementWindowExpired
    );
    Ok(())
}

fn require_refund_window(deadline: i64, now: i64) -> Result<()> {
    let refund_at = deadline
        .checked_add(SETTLEMENT_GRACE_SECONDS)
        .ok_or(error!(AccountabilityError::InvalidDeadline))?;
    require!(now >= refund_at, AccountabilityError::RefundNotAvailable);
    Ok(())
}

fn pay_recipients(
    pot: &Account<'_, Pot>,
    recipient_accounts: &[AccountInfo<'_>],
    recipients: &[Pubkey],
    payout: u64,
) -> Result<()> {
    require_eq!(
        recipient_accounts.len(),
        recipients.len(),
        AccountabilityError::IncorrectRecipientCount
    );
    for (account, recipient) in recipient_accounts.iter().zip(recipients.iter()) {
        require!(
            account.is_writable,
            AccountabilityError::RecipientNotWritable
        );
        require_keys_eq!(
            account.key(),
            *recipient,
            AccountabilityError::InvalidPayoutRecipient
        );
    }

    // Use the actual allocation so older, larger accounts also retain their full rent reserve.
    let rent_reserve = Rent::get()?.minimum_balance(pot.to_account_info().data_len());
    let available = pot
        .to_account_info()
        .lamports()
        .saturating_sub(rent_reserve);
    let total_payout = payout
        .checked_mul(recipients.len() as u64)
        .ok_or(error!(AccountabilityError::InsufficientPotBalance))?;
    require!(
        total_payout <= available,
        AccountabilityError::InsufficientPotBalance
    );
    for account in recipient_accounts {
        **pot.to_account_info().try_borrow_mut_lamports()? -= payout;
        **account.try_borrow_mut_lamports()? += payout;
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(identifier: u64)]
pub struct CreatePot<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = Pot::SPACE,
        seeds = [b"pot", creator.key().as_ref(), &identifier.to_le_bytes()],
        bump
    )]
    pub pot: Account<'info, Pot>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinPot<'info> {
    #[account(mut)]
    pub participant: Signer<'info>,
    #[account(mut)]
    pub pot: Account<'info, Pot>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettlePot<'info> {
    #[account(mut)]
    pub judge: Signer<'info>,
    #[account(mut)]
    pub pot: Account<'info, Pot>,
}

#[derive(Accounts)]
pub struct RefundPot<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut)]
    pub pot: Account<'info, Pot>,
}

#[account]
pub struct Pot {
    pub creator: Pubkey,
    pub judge: Pubkey,
    pub identifier: u64,
    pub task: String,
    pub stake: u64,
    pub deadline: i64,
    pub created_at: i64,
    pub yes_participants: Vec<Pubkey>,
    pub no_participants: Vec<Pubkey>,
    pub settled: bool,
    pub outcome: Option<bool>,
}

impl Pot {
    // Both vector length prefixes are stored, but their combined capacity is ten wallets.
    pub const SPACE: usize =
        8 + 32 + 32 + 8 + 4 + MAX_TASK_LENGTH + 8 + 8 + 8 + 4 + 4 + (32 * MAX_PARTICIPANTS) + 1 + 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Yes,
    No,
}

#[error_code]
pub enum AccountabilityError {
    #[msg("A task description is required.")]
    TaskRequired,
    #[msg("The task description is too long.")]
    TaskTooLong,
    #[msg("Stake must be greater than zero.")]
    InvalidStake,
    #[msg("The deadline must be in the future.")]
    DeadlineMustBeFuture,
    #[msg("This pot is already settled.")]
    PotSettled,
    #[msg("The deadline has passed.")]
    DeadlinePassed,
    #[msg("This pot already has the maximum number of participants.")]
    PotFull,
    #[msg("This wallet has already joined the pot.")]
    AlreadyParticipating,
    #[msg("Only the named judge may settle this pot.")]
    UnauthorizedJudge,
    #[msg("The pot cannot be settled before its deadline.")]
    DeadlineNotReached,
    #[msg("The payout recipient count does not match the recorded participants.")]
    IncorrectRecipientCount,
    #[msg("A payout recipient must be writable.")]
    RecipientNotWritable,
    #[msg("Payout recipients must exactly match the recorded participants.")]
    InvalidPayoutRecipient,
    #[msg("The judge's settlement window has expired. Anyone may refund this pot.")]
    SettlementWindowExpired,
    #[msg("Refunds are available five minutes after the deadline.")]
    RefundNotAvailable,
    #[msg("The deadline is too large to allow a settlement grace window.")]
    InvalidDeadline,
    #[msg("The pot account cannot be its own judge.")]
    InvalidJudge,
    #[msg("The pot cannot pay the recorded stakes while preserving rent.")]
    InsufficientPotBalance,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_error(result: Result<()>, expected_name: &str) {
        match result.unwrap_err() {
            anchor_lang::error::Error::AnchorError(error) => {
                assert_eq!(error.error_name, expected_name);
            }
            other => panic!("Expected {expected_name}, got {other:?}"),
        }
    }

    #[test]
    fn deadline_and_refund_cutoff_have_no_overlap_or_gap() {
        let deadline = 1_000;
        assert_error(
            require_settlement_window(deadline, 999),
            "DeadlineNotReached",
        );
        assert_error(require_refund_window(deadline, 999), "RefundNotAvailable");

        for now in [deadline, deadline + SETTLEMENT_GRACE_SECONDS - 1] {
            assert!(require_settlement_window(deadline, now).is_ok());
            assert_error(require_refund_window(deadline, now), "RefundNotAvailable");
        }

        // At the exact cutoff, only the permissionless refund path is available.
        for now in [
            deadline + SETTLEMENT_GRACE_SECONDS,
            deadline + SETTLEMENT_GRACE_SECONDS + 1,
        ] {
            assert_error(
                require_settlement_window(deadline, now),
                "SettlementWindowExpired",
            );
            assert!(require_refund_window(deadline, now).is_ok());
        }
    }

    #[test]
    fn grace_window_handles_integer_boundary_without_wrapping() {
        let last_valid_deadline = i64::MAX - SETTLEMENT_GRACE_SECONDS;
        assert!(require_settlement_window(last_valid_deadline, i64::MAX - 1).is_ok());
        assert_error(
            require_refund_window(last_valid_deadline, i64::MAX - 1),
            "RefundNotAvailable",
        );
        assert_error(
            require_settlement_window(last_valid_deadline, i64::MAX),
            "SettlementWindowExpired",
        );
        assert!(require_refund_window(last_valid_deadline, i64::MAX).is_ok());

        for deadline in [last_valid_deadline + 1, i64::MAX] {
            assert_error(
                require_settlement_window(deadline, i64::MAX),
                "InvalidDeadline",
            );
            assert_error(require_refund_window(deadline, i64::MAX), "InvalidDeadline");
        }
    }
}
