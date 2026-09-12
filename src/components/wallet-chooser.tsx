"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletModalContext } from "@solana/wallet-adapter-react-ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DEMO_WALLETS_ENABLED } from "@/lib/solana";

export function WalletChooserProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { wallets, wallet, select, connect, connecting } = useWallet();
  const availableWallets = wallets.filter(
    ({ readyState }) =>
      readyState === WalletReadyState.Installed ||
      readyState === WalletReadyState.Loadable,
  );
  const demoAvailable =
    DEMO_WALLETS_ENABLED && !process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // A native modal keeps keyboard focus inside and restores it when closed.
    if (visible && !element.open) element.showModal();
    if (!visible && element.open) element.close();
  }, [visible]);

  useEffect(() => {
    if (!visible || !wallet) return;
    const { adapter } = wallet;
    const handleConnect = () => setVisible(false);
    const handleError = () =>
      setConnectionError(`Could not connect to ${adapter.name}.`);
    adapter.on("connect", handleConnect);
    adapter.on("error", handleError);
    return () => {
      adapter.off("connect", handleConnect);
      adapter.off("error", handleError);
    };
  }, [visible, wallet]);

  return (
    <WalletModalContext.Provider
      value={{
        visible,
        setVisible: (open) => {
          setConnectionError(null);
          setVisible(open);
        },
      }}
    >
      {children}
      <dialog
        ref={dialog}
        className="wallet-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={() => setVisible(false)}
        onClose={() => setVisible(false)}
      >
        <div className="wallet-dialog-heading">
          <h2 id={titleId}>Connect wallet</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={() => setVisible(false)}
          >
            ✕
          </button>
        </div>
        <div className="wallet-dialog-body">
          <p id={descriptionId}>
            {availableWallets.length
              ? "Choose a wallet."
              : "No wallet extension found."}
          </p>
          {connectionError && (
            <p role="alert" className="alert-text">
              {connectionError}
            </p>
          )}
          {connecting && (
            <p role="status" className="status-text">
              Waiting for approval…
            </p>
          )}
          {availableWallets.length ? (
            <ul className="wallet-dialog-options">
              {availableWallets.map(({ adapter }) => (
                <li key={adapter.name}>
                  <button
                    type="button"
                    className="button button-block"
                    disabled={connecting}
                    onClick={async () => {
                      setConnectionError(null);
                      if (wallet?.adapter.name === adapter.name) {
                        try {
                          // Selecting the same adapter is a no-op; explicitly retry.
                          await connect();
                          setVisible(false);
                        } catch {
                          setConnectionError(
                            `Could not connect to ${adapter.name}.`,
                          );
                        }
                      } else {
                        // WalletProvider connects a newly selected adapter.
                        select(adapter.name);
                      }
                    }}
                  >
                    {adapter.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : demoAvailable ? (
            <button
              type="button"
              className="button button-yellow button-block"
              onClick={() => setVisible(false)}
            >
              Back to demo
            </button>
          ) : null}
        </div>
      </dialog>
    </WalletModalContext.Provider>
  );
}
