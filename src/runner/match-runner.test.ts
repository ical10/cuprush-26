import { describe, expect, it, vi } from "vitest";
import {
  readMatchRunnerChainConfig,
  runMatchRunner,
  type MatchRunnerOptions,
} from "./match-runner";

function dependencies(overrides: Partial<MatchRunnerOptions> = {}) {
  let now = 0;
  const abortController = new AbortController();
  const lock = {
    acquire: vi.fn(async () => true),
    release: vi.fn(async () => {}),
  };
  const scheduler = {
    subscribe: vi.fn(),
    stop: vi.fn(),
    tick: vi.fn(async () => ({
      fixturesGenerated: 0,
      questionsInserted: 0,
      openedCount: 0,
      lockedCount: 0,
      fixtureCatchUpCount: 0,
      overdueSettlingCount: 0,
    })),
  };
  const txLineClient = {
    prepare: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    waitForFailure: vi.fn(() => new Promise<Error>(() => {})),
    stop: vi.fn(async () => {}),
  };
  const options: MatchRunnerOptions = {
    lock,
    scheduler,
    txLineClient,
    reconcile: vi.fn(async () => {}),
    settle: vi.fn(async () => {}),
    hasActiveWork: vi.fn(async () => false),
    clock: () => new Date(now),
    sleep: vi.fn(async (milliseconds) => {
      now += milliseconds;
    }),
    signal: abortController.signal,
    ...overrides,
  };
  return { options, lock, scheduler, txLineClient, abortController };
}

describe("runMatchRunner", () => {
  it("exits after two short consecutive idle checks", async () => {
    const { options, scheduler, txLineClient, lock } = dependencies();

    const result = await runMatchRunner(options);

    expect(result).toEqual({ outcome: "idle", cycles: 1 });
    expect(options.sleep).toHaveBeenCalledOnce();
    expect(options.sleep).toHaveBeenCalledWith(5_000, options.signal);
    expect(options.hasActiveWork).toHaveBeenCalledTimes(2);
    expect(options.reconcile).toHaveBeenCalledOnce();
    expect(options.settle).toHaveBeenCalledOnce();
    expect(scheduler.subscribe).toHaveBeenCalledBefore(txLineClient.prepare);
    expect(txLineClient.start).not.toHaveBeenCalled();
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("uses minute polling while active and hands off at the hard runtime bound", async () => {
    const { options } = dependencies({
      hasActiveWork: vi.fn(async () => true),
      maxRuntimeMs: 120_000,
    });

    const result = await runMatchRunner(options);

    expect(result).toEqual({ outcome: "max_runtime", cycles: 4 });
    expect(options.sleep).toHaveBeenCalledTimes(2);
    expect(options.sleep).toHaveBeenNthCalledWith(1, 60_000, expect.any(AbortSignal));
  });

  it("stops cleanly when its abort signal fires", async () => {
    const { options, abortController, scheduler, txLineClient } = dependencies({
      hasActiveWork: vi.fn(async () => true),
    });
    options.sleep = vi.fn(async () => abortController.abort());

    const result = await runMatchRunner(options);

    expect(result).toEqual({ outcome: "aborted", cycles: 2 });
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
  });

  it("does no work when another runner holds the advisory lock", async () => {
    const lock = {
      acquire: vi.fn(async () => false),
      release: vi.fn(async () => {}),
    };
    const { options, scheduler, txLineClient } = dependencies({ lock });

    const result = await runMatchRunner(options);

    expect(result).toEqual({ outcome: "lock_contended", cycles: 0 });
    expect(scheduler.subscribe).not.toHaveBeenCalled();
    expect(txLineClient.start).not.toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("releases the lock and subscription when initial TxLINE sync fails", async () => {
    const { options, scheduler, txLineClient, lock } = dependencies({
      hasActiveWork: vi.fn(async () => true),
    });
    txLineClient.start.mockRejectedValueOnce(new Error("snapshot failed"));

    await expect(runMatchRunner(options)).rejects.toThrow("snapshot failed");

    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("aborts a pending fixture discovery and releases every resource", async () => {
    const { options, scheduler, txLineClient, lock, abortController } = dependencies();
    txLineClient.prepare.mockImplementationOnce(
      (signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const running = runMatchRunner(options);
    await vi.waitFor(() => expect(txLineClient.prepare).toHaveBeenCalledOnce());
    abortController.abort();

    await expect(running).resolves.toEqual({ outcome: "aborted", cycles: 0 });
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("cleans up after fixture discovery fails", async () => {
    const { options, scheduler, txLineClient, lock } = dependencies();
    txLineClient.prepare.mockRejectedValueOnce(new Error("fixture list failed"));

    await expect(runMatchRunner(options)).rejects.toThrow("fixture list failed");

    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("aborts a pending TxLINE start and releases every resource", async () => {
    const { options, scheduler, txLineClient, lock, abortController } = dependencies({
      hasActiveWork: vi.fn(async () => true),
    });
    txLineClient.start.mockImplementationOnce(
      (signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const running = runMatchRunner(options);
    await vi.waitFor(() => expect(txLineClient.start).toHaveBeenCalledOnce());
    abortController.abort();

    await expect(running).resolves.toEqual({ outcome: "aborted", cycles: 1 });
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("surfaces a terminal stream failure and still releases every resource", async () => {
    const terminal = new Error("stream retries exhausted");
    const { options, scheduler, txLineClient, lock } = dependencies({
      hasActiveWork: vi.fn(async () => true),
      sleep: (_milliseconds, signal) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        }),
    });
    txLineClient.waitForFailure.mockReturnValue(Promise.resolve(terminal));

    await expect(runMatchRunner(options)).rejects.toThrow(terminal.message);

    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("cancels the pending poll delay when terminal stream failure wins", async () => {
    const terminal = new Error("stream failed now");
    let delaySignal: AbortSignal | undefined;
    const sleep = vi.fn(
      (_milliseconds: number, signal?: AbortSignal) =>
        new Promise<void>((resolve) => {
          delaySignal = signal;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        }),
    );
    const { options, scheduler, txLineClient, lock } = dependencies({
      hasActiveWork: vi.fn(async () => true),
      sleep,
    });
    txLineClient.waitForFailure.mockReturnValue(Promise.resolve(terminal));

    await expect(runMatchRunner(options)).rejects.toThrow(terminal.message);

    expect(sleep).toHaveBeenCalledOnce();
    expect(delaySignal?.aborted).toBe(true);
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(txLineClient.stop).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
  });
});

describe("readMatchRunnerChainConfig", () => {
  it("disables chain writes by default", () => {
    expect(readMatchRunnerChainConfig({})).toEqual({ writesEnabled: false });
  });

  it("requires the real Solana adapter before enabling chain writes", () => {
    expect(() =>
      readMatchRunnerChainConfig({ MATCH_RUNNER_CHAIN_WRITES: "enabled" }),
    ).toThrow(/CHAIN_MODE=solana/);
    expect(
      readMatchRunnerChainConfig({
        MATCH_RUNNER_CHAIN_WRITES: "enabled",
        CHAIN_MODE: "solana",
      }),
    ).toEqual({ writesEnabled: true });
  });
});
