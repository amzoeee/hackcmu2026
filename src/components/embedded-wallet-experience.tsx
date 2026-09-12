"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  type ConnectedStandardSolanaWallet,
  useWallets as usePrivyWallets,
} from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
  type AnchorWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useMemo, type ReactNode } from "react";
import { SOLANA_NETWORK, SOLANA_RPC_URL, SOLANA_WS_URL } from "@/lib/solana";
import { FinanceYourResponsibilitiesApp } from "./finance-your-responsibilities-app";

export function PrivyWalletProvider({
  appId,
  children,
}: {
  appId: string;
  children: ReactNode;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "light",
          accentColor: "#135edb",
          landingHeader: "Continue to Finance your Responsibilities",
          loginMessage: "Your wallet is created automatically.",
          showWalletLoginFirst: false,
          walletChainType: "solana-only",
        },
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: { solana: { createOnLogin: "all-users" } },
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc(SOLANA_RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_WS_URL),
              blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

function embeddedAnchorWallet(
  wallet: ConnectedStandardSolanaWallet,
): AnchorWallet {
  const signTransaction = async <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T> => {
    if (SOLANA_NETWORK !== "devnet") {
      throw new Error("Embedded wallets are available on devnet only.");
    }
    const serialized =
      transaction instanceof Transaction
        ? transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          })
        : transaction.serialize();
    const { signedTransaction } = await wallet.signTransaction({
      transaction: serialized,
      chain: "solana:devnet",
    });
    return (
      transaction instanceof Transaction
        ? Transaction.from(signedTransaction)
        : VersionedTransaction.deserialize(signedTransaction)
    ) as T;
  };

  return {
    publicKey: new PublicKey(wallet.address),
    signTransaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      transactions: T[],
    ) =>
      Promise.all(
        transactions.map((transaction) => signTransaction(transaction)),
      ),
  };
}

export function PrivyWalletExperience({
  requestDemoFunds,
}: {
  requestDemoFunds: (address: string) => Promise<string>;
}) {
  const { connection } = useConnection();
  const { authenticated, login, logout, connectOrCreateWallet } = usePrivy();
  const { wallets } = usePrivyWallets();
  const adapterWallet = useWallet();
  const adapterAnchorWallet = useAnchorWallet();
  const embeddedWallet = wallets.find(
    (wallet) => wallet.standardWallet.name === "Privy",
  );
  const anchorWallet = useMemo(
    () =>
      embeddedWallet
        ? embeddedAnchorWallet(embeddedWallet)
        : adapterAnchorWallet,
    [adapterAnchorWallet, embeddedWallet],
  );
  const address =
    embeddedWallet?.address || adapterWallet.publicKey?.toBase58();

  return (
    <FinanceYourResponsibilitiesApp
      connection={connection}
      wallet={anchorWallet}
      address={address}
      connectLabel="Continue with email or Google"
      walletLabel={
        embeddedWallet
          ? "embedded Finance your Responsibilities wallet"
          : adapterWallet.wallet?.adapter.name || "browser wallet"
      }
      onConnect={() => {
        if (authenticated) connectOrCreateWallet();
        else login();
      }}
      onDisconnect={authenticated ? logout : adapterWallet.disconnect}
      onRequestFunds={address ? () => requestDemoFunds(address) : undefined}
    />
  );
}
