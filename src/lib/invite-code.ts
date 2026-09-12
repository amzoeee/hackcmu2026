import type { PublicKey } from "@solana/web3.js";

/** Mirrors MAX_ACCESS_CODE_LENGTH in the program. */
export const MAX_INVITE_CODE_BYTES = 64;
/**
 * A gated pot stores only a hash, but that hash is public, so a code short
 * enough to guess offline gates nothing. Codes are generated, not chosen.
 */
export const MIN_INVITE_CODE_BYTES = 8;

// Digits and letters that do not read as one another when typed by hand.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * A random invite code. Sixteen characters of this alphabet carry 80 bits, so
 * the published hash cannot be reversed by guessing.
 *
 * The code travels as plain instruction data, so the first join publishes it on
 * the ledger permanently. It keeps a pot out of sight of people browsing the
 * list; it is not a secret, and settlement never depends on it.
 */
export function createInviteCode(length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 is a whole multiple of the alphabet, so every character is equally likely.
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/**
 * Hashes an invite code for `create_pot` and matches what `join_pot` recomputes.
 * The pot address is hashed with the code, so a hash cannot be replayed against
 * another pot and one precomputed table cannot cover every pot.
 */
export async function inviteCodeHash(pot: PublicKey, code: string) {
  const encoded = new TextEncoder().encode(code);
  if (encoded.length < MIN_INVITE_CODE_BYTES) {
    throw new Error(
      `An invite code must be at least ${MIN_INVITE_CODE_BYTES} bytes.`,
    );
  }
  if (encoded.length > MAX_INVITE_CODE_BYTES) {
    throw new Error(
      `An invite code may be at most ${MAX_INVITE_CODE_BYTES} bytes.`,
    );
  }
  const input = new Uint8Array(32 + encoded.length);
  input.set(pot.toBytes(), 0);
  input.set(encoded, 32);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
  );
}
