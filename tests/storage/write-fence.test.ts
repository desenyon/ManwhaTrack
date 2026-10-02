import { expect, it, vi } from "vitest";
import { closeDb, openDb, read, revokeDisallowedWrites, useDatabase, write, WriteRevokedError } from "../../src/storage/db";

it("aborts a guarded write revoked after its final mutation fence and before commit", async () => {
  useDatabase(`fence-${crypto.randomUUID()}`);
  let allowed = true;
  let checks = 0;
  const pending = write(["meta"], async t => {
    await t.put("meta", { key: "private", value: "evidence" });
  }, () => {
    if (++checks === 2) queueMicrotask(() => { allowed = false; revokeDisallowedWrites(); });
    return allowed;
  });
  await expect(pending).rejects.toBeInstanceOf(WriteRevokedError);
  expect(await read(["meta"], t => t.get("meta", "private"))).toBeUndefined();
});

it("can retry a synchronous IndexedDB opening failure without resetting data", async () => {
  useDatabase(`open-retry-${crypto.randomUUID()}`);
  await write(["meta"], t => t.put("meta", { key: "preserved", value: 42 }));
  await closeDb();
  const open = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => { throw new DOMException("Local storage unavailable", "SecurityError"); });
  await expect(openDb()).rejects.toThrow("Local storage unavailable");
  open.mockRestore();
  expect(await read(["meta"], t => t.get("meta", "preserved"))).toEqual({ key: "preserved", value: 42 });
});
