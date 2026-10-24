import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunStore } from "../../src/runner/run-store.js";
import { writeReport } from "../../src/reports/json-reporter.js";
import { mkdirSync } from "node:fs";
import type { RunResult } from "../../src/types/test-plan.js";

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "browser-qa-mcp-run-store-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

function makeResult(runId: string): RunResult {
  return {
    runId,
    planName: "demo",
    baseUrl: "http://127.0.0.1:4000",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    status: "PASS",
    tests: [],
  };
}

describe("RunStore", () => {
  it("returns a run saved in memory", () => {
    const store = new RunStore(baseDir);
    const result = makeResult("run-mem");
    store.save(result);
    expect(store.get("run-mem")).toEqual(result);
  });

  it("falls back to reading report.json from disk for an uncached run", () => {
    const result = makeResult("run-disk");
    const runDir = path.join(baseDir, "run-disk");
    mkdirSync(runDir, { recursive: true });
    writeReport(result, path.join(runDir, "report.json"));

    const store = new RunStore(baseDir);
    expect(store.get("run-disk")).toEqual(result);
  });

  it("returns undefined for an unknown runId", () => {
    const store = new RunStore(baseDir);
    expect(store.get("does-not-exist")).toBeUndefined();
  });
});
