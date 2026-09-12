"use client";

import { usePrivy } from "@privy-io/react-auth";
import {
  type ConnectedStandardSolanaWallet,
  useWallets as usePrivyWallets,
} from "@privy-io/react-auth/solana";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
  type AnchorWallet,
} from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { useMemo } from "react";
import { SolaraApp } from "./solara-app";

function embeddedAnchorWallet(wallet: ConnectedStandardSolanaWallet): AnchorWallet {
  const signTransaction = async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
    const serialized = transaction instanceof Transaction
      ? transaction.serialize({ requireAllSignatures: false, verifySignatures: false })
      : transaction.serialize();
    const { signedTransaction } = await wallet.signTransaction({
      transaction: serialized,
      chain: "solana:devnet",
    });
    return (transaction instanceof Transaction
      ? Transaction.from(signedTransaction)
      : VersionedTransaction.deserialize(signedTransaction)) as T;
  };

  return {
    publicKey: new PublicKey(wallet.address),
    signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(transactions: T[]) =>
      Promise.all(transactions.map((transaction) => signTransaction(transaction))),
  };
}

export function ExternalWalletExperience() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();

  return (
    <SolaraApp
      connection={connection}
      wallet={anchorWallet}
      address={wallet.publicKey?.toBase58()}
      walletLabel={wallet.wallet?.adapter.name || "browser wallet"}
      onConnect={() => setVisible(true)}
      onDisconnect={wallet.disconnect}
    />
  );
}

export function EmbeddedWalletExperience() {
  const { connection } = useConnection();
  const { authenticated, login, logout, connectOrCreateWallet } = usePrivy();
  const { wallets } = usePrivyWallets();
  const adapterWallet = useWallet();
  const adapterAnchorWallet = useAnchorWallet();
  const embeddedWallet = wallets.find((wallet) => wallet.standardWallet.name === "Privy");
  const anchorWallet = useMemo(
    () => (embeddedWallet ? embeddedAnchorWallet(embeddedWallet) : adapterAnchorWallet),
    [adapterAnchorWallet, embeddedWallet],
  );

  return (
    <SolaraApp
      connection={connection}
      wallet={anchorWallet}
      address={embeddedWallet?.address || adapterWallet.publicKey?.toBase58()}
      walletLabel={embeddedWallet ? "embedded Solara wallet" : adapterWallet.wallet?.adapter.name || "browser wallet"}
      onConnect={() => {
        if (authenticated) connectOrCreateWallet();
        else login();
      }}
      onDisconnect={authenticated ? logout : adapterWallet.disconnect}
    />
  );
}
