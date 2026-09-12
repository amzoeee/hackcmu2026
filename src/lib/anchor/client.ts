import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import idl from "./generated/accountability.json";
import type { Accountability } from "./generated/accountability";

/** The generated IDL is the source of truth for the program address and API. */
export function getAccountabilityProgram(
  connection: Connection,
  wallet: AnchorWallet,
) {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program<Accountability>(idl as Accountability, provider);
}
