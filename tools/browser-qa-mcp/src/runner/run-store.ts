import { existsSync } from "node:fs";
import path from "node:path";
import type { RunResult } from "../types/test-plan.js";
import { readReport } from "../reports/json-reporter.js";

/**
 * Looks up a run's report by ID, in memory first, then falling back to the
 * on-disk report.json this process (or an earlier CLI invocation) wrote.
 * Shared by the CLI and the MCP server so both read the same source of truth.
 */
export class RunStore {
  private readonly cache = new Map<string, RunResult>();

  constructor(private readonly baseDir: string) {}

  save(result: RunResult): void {
    this.cache.set(result.runId, result);
  }

  get(runId: string): RunResult | undefined {
    const cached = this.cache.get(runId);
    if (cached) return cached;

    const reportPath = path.join(this.baseDir, runId, "report.json");
    if (!existsSync(reportPath)) return undefined;

    const result = readReport(reportPath);
    this.cache.set(runId, result);
    return result;
  }
}
