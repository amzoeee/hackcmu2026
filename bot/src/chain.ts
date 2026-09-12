import { readFileSync } from "node:fs";
import { AnchorProvider, Program, type BN, type Idl } from "@coral-xyz/anchor";
import { Connection, SystemProgram, type PublicKey } from "@solana/web3.js";
import { describeError, type Logger } from "./logger";
import { sortNewestFirst, type Pot } from "./pots";

/** Bound public reads with the same 15s timeout as the frontend's read-only connection. */
export const READ_TIMEOUT_MS = 15_000;

const IDL_URL = new URL(
  "../../src/lib/anchor/generated/accountability.json",
  import.meta.url,
);

export type AccountabilityIdl = Idl & { address: string };

/** The app's generated IDL is read at runtime, not copied, so program changes flow through. */
export function loadIdl(): AccountabilityIdl {
  const idl = JSON.parse(readFileSync(IDL_URL, "utf8")) as AccountabilityIdl;
  if (typeof idl.address !== "string" || !idl.address) {
    throw new Error(`The IDL at ${IDL_URL.pathname} has no program address.`);
  }
  return idl;
}

export function getReadOnlyConnection(endpoint: string) {
  return new Connection(endpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.timeout(READ_TIMEOUT_MS) }),
  });
}

/** The account shape Anchor's coder returns for the camelCased IDL. */
type RawPot = {
  creator: PublicKey;
  judge: PublicKey;
  identifier: BN;
  task: string;
  stake: BN;
  deadline: BN;
  createdAt: BN;
  yesParticipants: PublicKey[];
  noParticipants: PublicKey[];
  settled: boolean;
  outcome: boolean | null;
};

function toBigInt(value: BN) {
  return BigInt(value.toString());
}

function toPot(address: PublicKey, raw: RawPot): Pot {
  return {
    address: address.toBase58(),
    creator: raw.creator.toBase58(),
    judge: raw.judge.toBase58(),
    identifier: toBigInt(raw.identifier),
    task: raw.task,
    stake: toBigInt(raw.stake),
    deadline: Number(toBigInt(raw.deadline)),
    createdAt: Number(toBigInt(raw.createdAt)),
    yesParticipants: raw.yesParticipants.map((key) => key.toBase58()),
    noParticipants: raw.noParticipants.map((key) => key.toBase58()),
    settled: raw.settled,
    outcome: raw.outcome,
  };
}

export type ChainReader = {
  programId: string;
  /** Every decodable pot, newest first. Throws only when the RPC read itself fails. */
  readPots: () => Promise<Pot[]>;
};

export function createChainReader(
  rpcUrl: string,
  log: Logger,
  idl: AccountabilityIdl = loadIdl(),
): ChainReader {
  const connection = getReadOnlyConnection(rpcUrl);
  // A wallet that cannot sign keeps the bot strictly read-only.
  const readOnlyWallet: ConstructorParameters<typeof AnchorProvider>[1] = {
    publicKey: SystemProgram.programId,
    signTransaction: async () => {
      throw new Error("The Discord bot is read-only and cannot sign.");
    },
    signAllTransactions: async () => {
      throw new Error("The Discord bot is read-only and cannot sign.");
    },
  };
  const program = new Program(
    idl,
    new AnchorProvider(connection, readOnlyWallet, { commitment: "confirmed" }),
  );
  const potFilter = program.coder.accounts.memcmp("pot") as {
    offset: number;
    bytes: string;
  };

  return {
    programId: program.programId.toBase58(),
    async readPots() {
      const accounts = await connection.getProgramAccounts(program.programId, {
        commitment: "confirmed",
        filters: [
          { memcmp: { offset: potFilter.offset, bytes: potFilter.bytes } },
        ],
      });
      const pots: Pot[] = [];
      for (const { pubkey, account } of accounts) {
        try {
          pots.push(
            toPot(
              pubkey,
              program.coder.accounts.decode<RawPot>("pot", account.data),
            ),
          );
        } catch (error) {
          log.warn(
            `Skipping undecodable pot account ${pubkey.toBase58()}: ${describeError(error)}`,
          );
        }
      }
      return sortNewestFirst(pots);
    },
  };
}
