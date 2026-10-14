import { afterEach, expect, it, vi } from "vitest";
import { createLiveRefreshQueue } from "./live-refresh-queue";
afterEach(() => vi.useRealTimers());
it("coalesces a continuous burst without indefinitely postponing refresh", async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const queue = createLiveRefreshQueue(() => false, refresh);
  for (let i = 0; i < 12; i++) {
    queue.changed();
    await vi.advanceTimersByTimeAsync(10);
  }
  expect(refresh).toHaveBeenCalledTimes(1);
  queue.dispose();
});
it("waits for an optimistic mutation and refreshes once it settles", async () => {
  vi.useFakeTimers();
  let pending = true;
  const refresh = vi.fn().mockResolvedValue(undefined);
  const queue = createLiveRefreshQueue(() => pending, refresh);
  queue.changed();
  await vi.advanceTimersByTimeAsync(120);
  expect(refresh).not.toHaveBeenCalled();
  pending = false;
  await vi.advanceTimersByTimeAsync(250);
  expect(refresh).toHaveBeenCalledTimes(1);
  queue.dispose();
});
it("keeps changes received mid-read for a subsequent read and cancels on unmount", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const refresh = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(undefined);
  const queue = createLiveRefreshQueue(() => false, refresh);
  queue.changed();
  await vi.advanceTimersByTimeAsync(120);
  queue.changed();
  await vi.advanceTimersByTimeAsync(1000);
  expect(refresh).toHaveBeenCalledTimes(1);
  resolve();
  await vi.advanceTimersByTimeAsync(120);
  expect(refresh).toHaveBeenCalledTimes(2);
  queue.changed();
  queue.dispose();
  await vi.advanceTimersByTimeAsync(120);
  expect(refresh).toHaveBeenCalledTimes(2);
});
