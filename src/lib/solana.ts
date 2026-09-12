export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

export const SOLANA_WS_URL =
  process.env.NEXT_PUBLIC_SOLANA_WS_URL ||
  SOLANA_RPC_URL.replace(/^http/, "ws");

export const SOLANA_NETWORK =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

function hasLoopbackRpc() {
  try {
    const url = new URL(SOLANA_RPC_URL);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export const IS_LOCALNET = SOLANA_NETWORK === "localnet" && hasLoopbackRpc();
export const DEMO_WALLETS_ENABLED = SOLANA_NETWORK === "devnet" || IS_LOCALNET;
