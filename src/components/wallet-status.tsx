"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (module) => module.WalletMultiButton,
    ),
  { ssr: false },
);

export function WalletStatus() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58();
  const [balance, setBalance] = useState<{
    address: string;
    lamports: number;
  } | null>(null);
  const [error, setError] = useState<{
    address: string;
    message: string;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!publicKey || !address) return;
    let active = true;
    connection.getBalance(publicKey).then(
      (lamports) => {
        if (active) {
          setBalance({ address, lamports });
          setError(null);
        }
      },
      () => {
        if (active)
          setError({
            address,
            message: "Could not load balance. Try refreshing.",
          });
      },
    );
    const subscription = connection.onAccountChange(publicKey, (account) => {
      if (active) {
        setBalance({ address, lamports: account.lamports });
        setError(null);
      }
    });
    return () => {
      active = false;
      void connection.removeAccountChangeListener(subscription);
    };
  }, [connection, publicKey, address, refresh]);

  return (
    <div className="wallet-status">
      <WalletMultiButton />
      {address ? (
        <div className="balance" aria-live="polite">
          <span>
            {error?.address === address
              ? error.message
              : balance?.address === address
                ? `${(balance.lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`
                : "Loading balance…"}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh
          </button>
        </div>
      ) : (
        <p className="muted">Connect a devnet wallet to get started.</p>
      )}
    </div>
  );
}
