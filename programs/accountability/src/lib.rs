#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("EE5h4kXh8Pk2ECthCABpK7bLQ934n4TZjkRsuDgskYBb");

const MAX_TASK_LENGTH: usize = 160;
const MAX_PARTICIPANTS: usize = 10;

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
        require!(task.len() <= MAX_TASK_LENGTH, AccountabilityError::TaskTooLong);
        require!(stake > 0, AccountabilityError::InvalidStake);

        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, AccountabilityError::DeadlineMustBeFuture);

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
            !pot.yes_participants.contains(&ctx.accounts.participant.key())
                && !pot.no_participants.contains(&ctx.accounts.participant.key()),
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
        require_keys_eq!(pot.judge, ctx.accounts.judge.key(), AccountabilityError::UnauthorizedJudge);
        require!(!pot.settled, AccountabilityError::PotSettled);
        require!(now >= pot.deadline, AccountabilityError::DeadlineNotReached);

        let winners = if completed {
            &pot.yes_participants
        } else {
            &pot.no_participants
        };
        let everyone = [&pot.yes_participants[..], &pot.no_participants[..]].concat();
        let recipients: &[Pubkey] = if winners.is_empty() { &everyone } else { winners };

        require_eq!(
            ctx.remaining_accounts.len(),
            recipients.len(),
            AccountabilityError::IncorrectRecipientCount
        );
        for (recipient_account, recipient) in ctx.remaining_accounts.iter().zip(recipients.iter()) {
            require!(recipient_account.is_writable, AccountabilityError::RecipientNotWritable);
            require_keys_eq!(recipient_account.key(), *recipient, AccountabilityError::InvalidPayoutRecipient);
        }

        // The program account's rent reserve is never distributed. Any indivisible dust remains too.
        let rent_reserve = Rent::get()?.minimum_balance(Pot::SPACE);
        let available = pot.to_account_info().lamports().saturating_sub(rent_reserve);
        if !recipients.is_empty() && available > 0 {
            let payout = available / recipients.len() as u64;
            if payout > 0 {
                for recipient in ctx.remaining_accounts.iter() {
                    **pot.to_account_info().try_borrow_mut_lamports()? -= payout;
                    **recipient.try_borrow_mut_lamports()? += payout;
                }
            }
        }

        pot.settled = true;
        pot.outcome = Some(completed);
        Ok(())
    }
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
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 4 + MAX_TASK_LENGTH + 8 + 8 + 8
        + 4 + (32 * MAX_PARTICIPANTS) + 4 + (32 * MAX_PARTICIPANTS) + 1 + 2;
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
}
