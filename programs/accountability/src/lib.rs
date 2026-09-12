#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("EE5h4kXh8Pk2ECthCABpK7bLQ934n4TZjkRsuDgskYBb");

#[program]
pub mod accountability {
    use super::*;

    /// Smoke-test instruction. Replace with create, join, and settle as implemented.
    /// No accounts are created and no SOL is transferred.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!(
            "Accountability scaffold ready: {}",
            ctx.accounts.signer.key()
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    pub signer: Signer<'info>,
}
