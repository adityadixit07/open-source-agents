import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface TestSession {
  context: BrowserContext;
  page: Page;
}

/**
 * Owns one Chromium process for an entire run and hands out a fresh,
 * isolated BrowserContext per test - so one test's cookies, storage, or
 * crashed state can never leak into the next, without paying the cost of a
 * full browser relaunch for every test in the plan.
 */
export class BrowserManager {
  private browser: Browser | undefined;

  async launch(): Promise<void> {
    // Optional override for environments (CI images, sandboxes) that ship a
    // pre-installed Chromium instead of letting `playwright install` download one.
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    this.browser = await chromium.launch({ headless: true, executablePath });
  }

  async openTestSession(): Promise<TestSession> {
    if (!this.browser) {
      throw new Error("BrowserManager.launch() must be called before openTestSession()");
    }
    const context = await this.browser.newContext();
    const page = await context.newPage();
    return { context, page };
  }

  async closeTestSession(session: TestSession): Promise<void> {
    await session.context.close().catch(() => {});
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}
