"use client";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { SOLANA_NETWORK, SOLANA_RPC_URL, SOLANA_WS_URL } from "@/lib/solana";

// Wallet Standard discovers installed wallets (including Phantom and Solflare).
const wallets: [] = [];
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PrivyWalletProvider = dynamic(() =>
  import("./embedded-wallet-experience").then(
    (module) => module.PrivyWalletProvider,
  ),
);

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const walletProviders = (
    <ConnectionProvider
      endpoint={SOLANA_RPC_URL}
      config={{ commitment: "confirmed", wsEndpoint: SOLANA_WS_URL }}
    >
      <WalletProvider
        wallets={wallets}
        autoConnect={SOLANA_NETWORK === "devnet"}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );

  if (!privyAppId || SOLANA_NETWORK !== "devnet") return walletProviders;

  return (
    <PrivyWalletProvider appId={privyAppId}>
      {walletProviders}
    </PrivyWalletProvider>
  );
}
