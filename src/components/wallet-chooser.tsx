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
      setConnectionError(
        `Could not connect to ${adapter.name}. Approve the connection in your wallet, then try again.`,
      );
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
          <h2 id={titleId}>Connect a wallet</h2>
          <button
            type="button"
            className="wallet-dialog-close"
            onClick={() => setVisible(false)}
          >
            Close
          </button>
        </div>
        <p id={descriptionId}>
          {availableWallets.length
            ? "Choose a wallet and approve the connection. Use devnet for this prototype."
            : "No Solana wallet extension was detected in this browser."}
        </p>
        {connectionError && (
          <p role="alert" style={{ color: "var(--danger)" }}>
            {connectionError}
          </p>
        )}
        {connecting && <p role="status">Waiting for wallet approval…</p>}
        {availableWallets.length ? (
          <ul className="wallet-dialog-options">
            {availableWallets.map(({ adapter }) => (
              <li key={adapter.name}>
                <button
                  type="button"
                  className="wallet-dialog-option"
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
                          `Could not connect to ${adapter.name}. Approve the connection in your wallet, then try again.`,
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
        ) : (
          <>
            <p>Enable a Solana wallet extension, then refresh this page.</p>
            {demoAvailable && (
              <p>
                You can also select <strong>Start demo</strong> on this page to
                use a browser wallet with test SOL.
              </p>
            )}
          </>
        )}
        <button
          type="button"
          className="wallet-dialog-back"
          onClick={() => setVisible(false)}
        >
          {demoAvailable ? "Back to demo" : "Back to Solara"}
        </button>
      </dialog>
    </WalletModalContext.Provider>
  );
}
