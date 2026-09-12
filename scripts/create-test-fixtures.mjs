import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { BN, BorshAccountsCoder } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

// These public, deterministic keys belong only to the isolated test validator.
const creator = Keypair.fromSeed(Buffer.alloc(32, 71)).publicKey;
const judge = Keypair.fromSeed(Buffer.alloc(32, 72)).publicKey;
const participants = [
  judge,
  ...Array.from(
    { length: 9 },
    (_, i) => Keypair.fromSeed(Buffer.alloc(32, 73 + i)).publicKey,
  ),
];
const idl = JSON.parse(
  await readFile("target/idl/accountability.json", "utf8"),
);
const coder = new BorshAccountsCoder(idl);
const programId = new PublicKey(idl.address);
const config = await readFile("Anchor.toml", "utf8");
const fixtures = [
  {
    name: "mixed",
    yes: participants.slice(0, 7),
    no: participants.slice(7),
    size: 919,
  },
  { name: "yes", yes: participants.slice(0, 2), no: [], size: 599 },
  { name: "no", yes: [], no: participants.slice(0, 2), size: 599 },
  { name: "empty", yes: [], no: [], size: 599 },
  {
    name: "invalid-recipients",
    yes: participants.slice(0, 2),
    no: participants.slice(2, 4),
    size: 599,
  },
  {
    name: "underfunded",
    yes: participants.slice(0, 1),
    no: participants.slice(1, 2),
    size: 599,
  },
];
const manifest = {};
await mkdir("target/test-fixtures", { recursive: true });

for (const [index, fixture] of fixtures.entries()) {
  const identifier = new BN(8000 + index);
  const [pot] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pot"),
      creator.toBuffer(),
      identifier.toArrayLike(Buffer, "le", 8),
    ],
    programId,
  );
  assert.ok(
    config.includes(`address = "${pot.toBase58()}"`),
    `Update the ${fixture.name} fixture address in Anchor.toml to ${pot.toBase58()} after changing program identity.`,
  );
  const stake = 100_000_000;
  // Default validator rent: 3,480 lamports/byte/year, two years, 128-byte overhead.
  // The integration tests verify this reserve against the validator's rent RPC.
  const rentReserve = (fixture.size + 128) * 3_480 * 2;
  const donation = fixture.name === "underfunded" ? -1 : 12_345;
  const lamports =
    rentReserve + stake * (fixture.yes.length + fixture.no.length) + donation;
  const data = Buffer.alloc(fixture.size);
  const encoded = await coder.encode("Pot", {
    creator,
    judge,
    identifier,
    task: `Expired ${fixture.name} fixture`,
    stake: new BN(stake),
    deadline: new BN(1),
    created_at: new BN(0),
    yes_participants: fixture.yes,
    no_participants: fixture.no,
    settled: false,
    outcome: null,
    proof_uri: "",
  });
  assert.ok(encoded.length <= data.length);
  encoded.copy(data);
  await writeFile(
    `target/test-fixtures/${fixture.name}.json`,
    JSON.stringify(
      {
        pubkey: pot.toBase58(),
        account: {
          lamports,
          data: [data.toString("base64"), "base64"],
          owner: programId.toBase58(),
          executable: false,
          rentEpoch: 0,
          space: data.length,
        },
      },
      null,
      2,
    ) + "\n",
  );
  manifest[fixture.name] = {
    pot: pot.toBase58(),
    rentReserve,
    donation,
    size: fixture.size,
  };
}

await writeFile(
  "target/test-fixtures/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Prepared ${fixtures.length} expired local-validator pots for timeout refund tests.`,
);
