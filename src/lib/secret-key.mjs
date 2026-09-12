/**
 * Solana keypair files and browser demo keys both store the 64-byte secret key
 * as a JSON array of bytes. Keep one definition of what counts as valid so the
 * app, the API route, and the setup scripts cannot drift apart.
 */
export function isSecretKeyBytes(value) {
  return (
    Array.isArray(value) &&
    value.length === 64 &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  );
}
