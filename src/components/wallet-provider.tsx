"use client";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import type { ReactNode } from "react";
import { SOLANA_NETWORK, SOLANA_RPC_URL, SOLANA_WS_URL } from "@/lib/solana";

// Wallet Standard discovers installed wallets (including Phantom and Solflare).
const wallets: [] = [];
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const walletProviders = (
    <ConnectionProvider
      endpoint={SOLANA_RPC_URL}
      config={{ commitment: "confirmed", wsEndpoint: SOLANA_WS_URL }}
    >
      <WalletProvider wallets={wallets} autoConnect={SOLANA_NETWORK === "devnet"}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );

  if (!privyAppId || SOLANA_NETWORK !== "devnet") return walletProviders;

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: "light",
          accentColor: "#135edb",
          landingHeader: "Continue to Solara",
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
      {walletProviders}
    </PrivyProvider>
  );
}
