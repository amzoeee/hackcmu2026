/**
 * Network identities shared by the app, the funding route, the readiness check,
 * and the tests. A single definition keeps a misconfigured cluster from passing
 * one check while the app itself refuses it.
 */
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEFAULT_SOLANA_NETWORK = "devnet";
export const DEFAULT_SOLANA_RPC_URL = "https://api.devnet.solana.com";
