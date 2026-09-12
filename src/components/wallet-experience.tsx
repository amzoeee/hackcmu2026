"use client";

import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Keypair } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  getOrCreateDemoKeypair,
  keypairAnchorWallet,
  loadDemoKeypair,
} from "@/lib/demo-wallet";
import { IS_LOCALNET, SOLANA_NETWORK } from "@/lib/solana";
import { FinanceYourResponsibilitiesApp } from "./finance-your-responsibilities-app";

const PrivyWalletExperience = dynamic(() =>
  import("./embedded-wallet-experience").then(
    (module) => module.PrivyWalletExperience,
  ),
);

async function requestDemoFunds(address: string) {
  const abortSignal = AbortSignal.timeout(40_000);
  try {
    const response = await fetch("/api/demo-funds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
      signal: abortSignal,
    });
    const result = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    abortSignal.throwIfAborted();
    if (!response.ok || !result)
      throw new Error(
        result?.error ||
          "Could not add test SOL. Please try again in a moment.",
      );
    return result.message || "The demo wallet is funded.";
  } catch (error) {
    if (abortSignal.aborted) {
      throw new Error(
        "Funding is taking too long. Check your balance before requesting more test SOL in a minute.",
      );
    }
    throw error;
  }
}

export function EmbeddedWalletExperience() {
  return <PrivyWalletExperience requestDemoFunds={requestDemoFunds} />;
}

type DemoMode = "demo" | "external" | null;
// Preserve existing wallet selection and sign-out preferences across the rename.
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

  useEffect(() => {
    // Only remember the extension once it actually connected. Closing the
    // chooser without picking one must still fall back to the demo wallet.
    if (mode !== "external" || !adapterAnchorWallet) return;
    try {
      window.localStorage.setItem(DEMO_MODE_KEY, "external");
    } catch {
      // An extension manages its own storage and can still connect.
    }
  }, [adapterAnchorWallet, mode]);

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
    try {
      await requestDemoFunds(keypair.publicKey.toBase58());
    } finally {
      // The first balance read should follow funding, including failed attempts.
      setDemoKeypair(keypair);
      setMode("demo");
    }
  }

  function connectExternalWallet() {
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
    <FinanceYourResponsibilitiesApp
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
