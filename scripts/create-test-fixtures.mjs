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
  // A pot written by the program build that had no proof link or invite hash.
  // Full, so its 599 bytes leave no room for those fields and the current
  // layout cannot read it until `resize_pot` grows the account.
  {
    name: "pre-upgrade",
    yes: participants.slice(0, 5),
    no: participants.slice(5),
    size: 599,
    legacy: true,
    task: "x".repeat(160),
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
    task: fixture.task ?? `Expired ${fixture.name} fixture`,
    stake: new BN(stake),
    deadline: new BN(1),
    created_at: new BN(0),
    yes_participants: fixture.yes,
    no_participants: fixture.no,
    settled: false,
    outcome: null,
    proof_uri: "",
    access_hash: null,
  });
  // The older layout ended at `outcome`: with an empty proof link and no invite
  // hash, the current encoding is that layout plus five trailing zero bytes.
  const bytes = fixture.legacy
    ? encoded.subarray(0, encoded.length - 5)
    : encoded;
  // A pre-upgrade pot is only stranded when its account cannot hold the five
  // bytes the two added fields need: a length prefix and an option tag.
  assert.ok(
    fixture.legacy
      ? data.length - bytes.length < 5
      : bytes.length <= data.length,
    `The ${fixture.name} fixture is ${bytes.length} bytes in ${data.length}.`,
  );
  bytes.copy(data);
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
    yes: fixture.yes.map((key) => key.toBase58()),
    no: fixture.no.map((key) => key.toBase58()),
  };
}

await writeFile(
  "target/test-fixtures/manifest.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Prepared ${fixtures.length} expired local-validator pots for recovery tests.`,
);
