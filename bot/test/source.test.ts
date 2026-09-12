import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPotSource } from "../src/source";
import { fixtures } from "./fixtures";

describe("createPotSource", () => {
  it("serves fresh reads from the cache and shares in-flight reads", async () => {
    let clock = 0;
    let reads = 0;
    let release: (() => void) | undefined;
    const source = createPotSource(
      async () => {
        reads += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [fixtures.active()];
      },
      10_000,
      () => clock,
    );
    assert.equal(source.latest(), null);

    const first = source.get();
    const second = source.get();
    assert.equal(reads, 1);
    release?.();
    assert.equal((await first).length, 1);
    assert.equal((await second).length, 1);
    assert.equal(source.latest()?.length, 1);

    clock = 5_000;
    await source.get();
    assert.equal(reads, 1);

    clock = 10_000;
    const stale = source.get();
    assert.equal(reads, 2);
    release?.();
    await stale;

    const forced = source.refresh();
    assert.equal(reads, 3);
    release?.();
    await forced;
  });
});
