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
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import {
  getOrCreateDemoKeypair,
  keypairAnchorWallet,
  loadDemoKeypair,
} from "@/lib/demo-wallet";
import { DEMO_WALLETS_ENABLED, IS_LOCALNET, SOLANA_NETWORK } from "@/lib/solana";
import { SolaraApp } from "./solara-app";

async function requestDemoFunds(address: string) {
  const response = await fetch("/api/demo-funds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!response.ok)
    throw new Error(
      result.error || "Could not add test SOL. Please try again in a moment.",
    );
  return result.message || "The demo wallet is funded.";
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
      connectLabel="Connect wallet"
      walletLabel={wallet.wallet?.adapter.name || "browser wallet"}
      onConnect={() => setVisible(true)}
      onDisconnect={wallet.disconnect}
      onRequestFunds={
        DEMO_WALLETS_ENABLED && wallet.publicKey
          ? () => requestDemoFunds(wallet.publicKey!.toBase58())
          : undefined
      }
    />
  );
}

export function EmbeddedWalletExperience() {
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
    <SolaraApp
      connection={connection}
      wallet={anchorWallet}
      address={address}
      connectLabel="Continue with email or Google"
      walletLabel={
        embeddedWallet
          ? "embedded Solara wallet"
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

type DemoMode = "demo" | "external" | null;
const DEMO_MODE_KEY = `solara.${SOLANA_NETWORK}.wallet-mode`;

export function DemoWalletExperience() {
  const { connection } = useConnection();
  const adapterWallet = useWallet();
  const adapterAnchorWallet = useAnchorWallet();
  const { setVisible } = useWalletModal();
  const [demoKeypair, setDemoKeypair] = useState<Keypair | null>(null);
  const [mode, setMode] = useState<DemoMode>(null);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      let savedMode: string | null = null;
      try {
        savedMode = window.localStorage.getItem(DEMO_MODE_KEY);
      } catch {
        // The connect action explains unavailable storage if a demo is started.
      }
      if (savedMode === "disconnected") return;
      if (savedMode === "external" && SOLANA_NETWORK === "devnet") {
        setMode("external");
        return;
      }
      const saved = loadDemoKeypair();
      if (saved) {
        setDemoKeypair(saved);
        setMode("demo");
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  const demoWallet = useMemo(
    () => (demoKeypair ? keypairAnchorWallet(demoKeypair) : undefined),
    [demoKeypair],
  );
  const wallet = mode === "external" ? adapterAnchorWallet : demoWallet;
  const address = wallet?.publicKey.toBase58();

  async function startDemo() {
    const keypair = getOrCreateDemoKeypair();
    try {
      window.localStorage.setItem(DEMO_MODE_KEY, "demo");
    } catch {
      // The key is already safely stored; this preference is optional.
    }
    setDemoKeypair(keypair);
    setMode("demo");
    await requestDemoFunds(keypair.publicKey.toBase58());
  }

  function connectExternalWallet() {
    try {
      window.localStorage.setItem(DEMO_MODE_KEY, "external");
    } catch {
      // An extension manages its own storage and can still connect.
    }
    setMode("external");
    setVisible(true);
  }

  async function disconnect() {
    if (mode === "external") await adapterWallet.disconnect();
    try {
      window.localStorage.setItem(DEMO_MODE_KEY, "disconnected");
    } catch {
      // Keep sign-out available when browser storage is disabled.
    }
    setDemoKeypair(null);
    setMode(null);
  }

  return (
    <SolaraApp
      connection={connection}
      wallet={wallet}
      address={address}
      connectLabel="Start demo"
      walletLabel={
        mode === "external"
          ? adapterWallet.wallet?.adapter.name || "browser wallet"
          : IS_LOCALNET
            ? "this browser's local rehearsal wallet"
            : "this browser's demo wallet"
      }
      onConnect={startDemo}
      onDisconnect={disconnect}
      onRequestFunds={
        mode === "demo" && address ? () => requestDemoFunds(address) : undefined
      }
      secondaryConnect={
        SOLANA_NETWORK === "devnet"
          ? { label: "Use wallet extension", onClick: connectExternalWallet }
          : undefined
      }
    />
  );
}
