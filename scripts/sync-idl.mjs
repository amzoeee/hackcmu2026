import { copyFile, mkdir } from "node:fs/promises";

const destination = new URL("../src/lib/anchor/generated/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
  new URL("../target/idl/accountability.json", import.meta.url),
  new URL("accountability.json", destination),
);
await copyFile(
  new URL("../target/types/accountability.ts", import.meta.url),
  new URL("accountability.ts", destination),
);
console.log(
  "Synced Anchor IDL and TypeScript types into src/lib/anchor/generated.",
);
