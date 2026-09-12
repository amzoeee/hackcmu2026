import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";

const mode = process.argv[2] || "";
const durablePath = ".wallets/accountability-program.json";
const buildPath = "target/deploy/accountability-keypair.json";
const restoreMessage =
  `Restore the existing program key to ${durablePath}, or run ` +
  "npm run tools:setup -- --new-program to intentionally create a separate program address.";

async function readKey(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const bytes = JSON.parse(contents);
    if (
      !Array.isArray(bytes) ||
      bytes.length !== 64 ||
      bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    ) {
      throw new Error();
    }
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw new Error(`Invalid program key file: ${path}. Restore its backup.`);
  }
}

async function saveKey(path, key) {
  await writeFile(path, JSON.stringify(Array.from(key.secretKey)), {
    mode: 0o600,
    flag: "wx",
  });
}

try {
  if (
    process.argv.length > 3 ||
    !["", "--setup", "--new-program", "--check-idl"].includes(mode)
  ) {
    throw new Error("Unsupported program-key option.");
  }

  let durable = await readKey(durablePath);
  let build = await readKey(buildPath);
  if (mode === "--new-program") {
    if (durable || build) {
      throw new Error(
        "An existing program key is present; refusing to replace it.",
      );
    }
    await mkdir(".wallets", { recursive: true });
    await mkdir("target/deploy", { recursive: true });
    durable = Keypair.generate();
    await saveKey(durablePath, durable);
    await saveKey(buildPath, durable);
    build = durable;
    execFileSync("anchor", ["keys", "sync", "--provider.cluster", "localnet"], {
      stdio: "inherit",
    });
    execFileSync("anchor", ["keys", "sync", "--provider.cluster", "devnet"], {
      stdio: "inherit",
    });
    console.log(
      `Created a new program address: ${durable.publicKey.toBase58()}`,
    );
  }

  if (!durable && !build) {
    if (mode === "--setup") {
      console.log(
        `Tools installed. No local program key is available. ${restoreMessage}`,
      );
      process.exit(0);
    }
    throw new Error(`No local program key is available. ${restoreMessage}`);
  }
  if (durable && build && !durable.publicKey.equals(build.publicKey)) {
    throw new Error(
      `The program keys in ${durablePath} and ${buildPath} disagree. Restore the matching key before building or deploying.`,
    );
  }

  const key = durable || build;
  const address = key.publicKey.toBase58();
  const source = await readFile("programs/accountability/src/lib.rs", "utf8");
  const config = await readFile("Anchor.toml", "utf8");
  const declaredAddress = source.match(/declare_id!\("([^"]+)"\)/)?.[1];
  const localnetAddress = config.match(
    /\[programs\.localnet\][^\[]*accountability\s*=\s*"([^"]+)"/,
  )?.[1];
  const devnetAddress = config.match(
    /\[programs\.devnet\][^\[]*accountability\s*=\s*"([^"]+)"/,
  )?.[1];
  if (
    [declaredAddress, localnetAddress, devnetAddress].some(
      (value) => value !== address,
    )
  ) {
    throw new Error(
      `Program key ${address} does not match the Rust declaration and both Anchor networks. Restore the matching key; do not deploy mismatched artifacts.`,
    );
  }

  await mkdir(".wallets", { recursive: true });
  await mkdir("target/deploy", { recursive: true });
  if (!durable) {
    await saveKey(durablePath, key);
    console.log(`Backed up the existing program key to ${durablePath}.`);
  }
  if (!build) {
    await saveKey(buildPath, key);
    console.log(`Restored the existing program key to ${buildPath}.`);
  }
  await chmod(durablePath, 0o600);
  await chmod(buildPath, 0o600);

  if (mode === "--check-idl") {
    const idl = JSON.parse(
      await readFile("src/lib/anchor/generated/accountability.json", "utf8"),
    );
    const types = await readFile(
      "src/lib/anchor/generated/accountability.ts",
      "utf8",
    );
    const typeAddress = types.match(/"address":\s*"([^"]+)"/)?.[1];
    if (idl.address !== address || typeAddress !== address) {
      throw new Error(
        "Generated client program addresses disagree. Run npm run anchor:build before deploying.",
      );
    }
  }
  console.log(`Program key verified: ${address}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Program-key validation failed.",
  );
  process.exitCode = 1;
}
