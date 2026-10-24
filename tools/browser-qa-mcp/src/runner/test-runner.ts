import { randomUUID } from "node:crypto";
import type { ValidatedTestPlan } from "../planner/schema.js";
import type {
  ConsoleEvidenceEntry,
  NetworkEvidenceEntry,
  RunResult,
  StepResult,
  TestResult,
  TestStatus,
} from "../types/test-plan.js";
import { TargetPolicy } from "../security/target-policy.js";
import { ArtifactManager } from "../evidence/artifact-manager.js";
import { ConsoleCollector } from "../evidence/console-collector.js";
import { NetworkCollector } from "../evidence/network-collector.js";
import { writeReport } from "../reports/json-reporter.js";
import { BrowserManager, type BrowserSession } from "./browser-manager.js";
import { ActionBlockedError, executeAction } from "./action-executor.js";
import { AssertionFailedError, executeAssertion, isAssertionAction } from "../assertions/assertion-engine.js";
import { PlaywrightAssertablePage } from "./playwright-page-adapter.js";

export interface RunPlanOptions {
  /** Explicit opt-in required to navigate to loopback/private-network targets. */
  allowLocalDev?: boolean;
  /** Restrict navigation to this exact set of origins, in addition to the base policy. */
  allowedOrigins?: string[];
  /** Directory runs are written under, one subdirectory per runId. Defaults to ./artifacts. */
  artifactsBaseDir?: string;
}

type TestCase = ValidatedTestPlan["tests"][number];

export async function runTestPlan(plan: ValidatedTestPlan, options: RunPlanOptions = {}): Promise<RunResult> {
  const runId = randomUUID();
  const artifactManager = new ArtifactManager(options.artifactsBaseDir ?? "./artifacts", runId);

  const targetPolicy = new TargetPolicy({
    allowLocalDev: options.allowLocalDev,
    allowedOrigins: options.allowedOrigins,
  });

  const startedAt = new Date().toISOString();
  const baseUrlVerdict = targetPolicy.evaluate(plan.baseUrl);

  let result: RunResult;

  if (!baseUrlVerdict.allowed) {
    const finishedAt = new Date().toISOString();
    result = {
      runId,
      planName: plan.name,
      baseUrl: plan.baseUrl,
      startedAt,
      finishedAt,
      status: "BLOCKED",
      tests: plan.tests.map((test) => ({
        id: test.id,
        name: test.name,
        status: "BLOCKED" as TestStatus,
        steps: [],
        error: baseUrlVerdict.reason,
        startedAt,
        finishedAt,
        durationMs: 0,
        screenshotPaths: [],
        consoleErrors: [],
        networkFailures: [],
      })),
    };
  } else {
    const browserManager = new BrowserManager();
    const tests: TestResult[] = [];
    for (const test of plan.tests) {
      tests.push(await runSingleTest(test, plan.baseUrl, browserManager, targetPolicy, artifactManager));
    }

    const finishedAt = new Date().toISOString();
    const status: TestStatus = tests.some((t) => t.status === "FAIL")
      ? "FAIL"
      : tests.some((t) => t.status === "BLOCKED")
        ? "BLOCKED"
        : "PASS";

    result = { runId, planName: plan.name, baseUrl: plan.baseUrl, startedAt, finishedAt, status, tests };
  }

  writeReport(result, artifactManager.reportPath());
  return result;
}

async function runSingleTest(
  test: TestCase,
  baseUrl: string,
  browserManager: BrowserManager,
  targetPolicy: TargetPolicy,
  artifactManager: ArtifactManager,
): Promise<TestResult> {
  const startedAt = new Date().toISOString();
  const steps: StepResult[] = [];
  const screenshotPaths: string[] = [];
  let status: TestStatus = "PASS";
  let error: string | undefined;

  let session: BrowserSession;
  try {
    session = await browserManager.open();
  } catch (err) {
    const finishedAt = new Date().toISOString();
    return {
      id: test.id,
      name: test.name,
      status: "BLOCKED",
      steps: [],
      error: `Failed to launch an isolated browser context: ${(err as Error).message}`,
      startedAt,
      finishedAt,
      durationMs: 0,
      screenshotPaths: [],
      consoleErrors: [],
      networkFailures: [],
    };
  }

  const assertablePage = new PlaywrightAssertablePage(session.page);
  const consoleCollector = new ConsoleCollector(session.page);
  const networkCollector = new NetworkCollector(session.page);
  await session.context.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});

  let consoleErrors: ConsoleEvidenceEntry[] = [];
  let networkFailures: NetworkEvidenceEntry[] = [];
  let tracePath: string | undefined;

  try {
    for (const step of test.steps) {
      const stepStart = Date.now();
      try {
        if (isAssertionAction(step.action)) {
          const message = await executeAssertion(step, assertablePage, baseUrl);
          steps.push({ action: step.action, selector: step.selector, status: "ok", message, durationMs: Date.now() - stepStart });
        } else {
          const outcome = await executeAction(step, {
            page: session.page,
            baseUrl,
            targetPolicy,
            screenshotDir: artifactManager.runDir,
            testId: test.id,
          });
          if (outcome.screenshotPath) screenshotPaths.push(outcome.screenshotPath);
          steps.push({
            action: step.action,
            selector: step.selector,
            status: "ok",
            message: outcome.message,
            durationMs: Date.now() - stepStart,
          });
        }
      } catch (err) {
        const durationMs = Date.now() - stepStart;
        if (err instanceof AssertionFailedError) {
          steps.push({ action: step.action, selector: step.selector, status: "failed", message: err.message, durationMs });
          status = "FAIL";
          error = err.message;
          await captureFailureScreenshot(session, artifactManager, test.id, screenshotPaths);
        } else if (err instanceof ActionBlockedError) {
          steps.push({ action: step.action, selector: step.selector, status: "blocked", message: err.message, durationMs });
          status = "BLOCKED";
          error = err.message;
        } else {
          // Environmental/infrastructure failure (timeout, crashed page, etc.) -
          // kept distinct from an application assertion failure.
          steps.push({ action: step.action, selector: step.selector, status: "blocked", message: (err as Error).message, durationMs });
          status = "BLOCKED";
          error = (err as Error).message;
        }
        break;
      }
    }
  } finally {
    consoleErrors = consoleCollector.getEntries();
    networkFailures = networkCollector.getEntries();
    consoleCollector.dispose();
    networkCollector.dispose();

    if (status === "FAIL" || status === "BLOCKED") {
      const candidate = artifactManager.tracePath(test.id);
      try {
        await session.context.tracing.stop({ path: candidate });
        tracePath = candidate;
      } catch {
        // Tracing may not have started successfully; trace capture is best-effort.
      }
    } else {
      await session.context.tracing.stop().catch(() => {});
    }

    await browserManager.close(session);
  }

  const finishedAt = new Date().toISOString();
  return {
    id: test.id,
    name: test.name,
    status,
    steps,
    error,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    screenshotPaths,
    consoleErrors,
    networkFailures,
    tracePath,
  };
}

async function captureFailureScreenshot(
  session: BrowserSession,
  artifactManager: ArtifactManager,
  testId: string,
  screenshotPaths: string[],
): Promise<void> {
  const path = artifactManager.screenshotPath(testId, "failure");
  try {
    await session.page.screenshot({ path });
    screenshotPaths.push(path);
  } catch {
    // Page may already be closed/crashed - evidence capture is best-effort.
  }
}
