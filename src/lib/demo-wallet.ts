import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { DEMO_WALLETS_ENABLED, SOLANA_NETWORK } from "./solana";

const STORAGE_KEY = `solara.${SOLANA_NETWORK}.demo-wallet`;

export function loadDemoKeypair() {
  if (!DEMO_WALLETS_ENABLED) return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const secret = JSON.parse(stored) as number[];
    if (
      !Array.isArray(secret) ||
      secret.length !== 64 ||
      secret.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    )
      return null;
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch {
    return null;
  }
}

export function getOrCreateDemoKeypair() {
  if (!DEMO_WALLETS_ENABLED) {
    throw new Error(
      "Browser demo wallets require devnet or an explicit localnet with a loopback RPC.",
    );
  }
  const existing = loadDemoKeypair();
  if (existing) return existing;

  const keypair = Keypair.generate();
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(keypair.secretKey)),
    );
  } catch {
    throw new Error(
      "Allow browser storage to keep your demo wallet, or connect a wallet extension.",
    );
  }
  return keypair;
}

export function keypairAnchorWallet(keypair: Keypair): AnchorWallet {
  const signTransaction = async <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> => {
    if (!DEMO_WALLETS_ENABLED) {
      throw new Error("Browser demo wallets cannot sign on this network.");
    }
    if (transaction instanceof Transaction) transaction.partialSign(keypair);
    else transaction.sign([keypair]);
    return transaction;
  };

  return {
    publicKey: keypair.publicKey,
    signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      transactions: T[],
    ) => Promise.all(transactions.map(signTransaction)),
  };
}
