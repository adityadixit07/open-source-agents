import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Launches an isolated browser context per test so one test's cookies,
 * storage, or crashed state can never leak into the next.
 */
export class BrowserManager {
  async open(): Promise<BrowserSession> {
    // Optional override for environments (CI images, sandboxes) that ship a
    // pre-installed Chromium instead of letting `playwright install` download one.
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
    const browser = await chromium.launch({ headless: true, executablePath });
    const context = await browser.newContext();
    const page = await context.newPage();
    return { browser, context, page };
  }

  async close(session: BrowserSession): Promise<void> {
    await session.context.close().catch(() => {});
    await session.browser.close().catch(() => {});
  }
}
