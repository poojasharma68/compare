import type { Browser, BrowserContext } from 'playwright';
import { AuditError } from '@/lib/utils/errors';
import type { ViewportSpec } from '@/lib/types/dom';
import { browserLabel, type BrowserName } from '@/lib/config/browsers';

const IDLE_SHUTDOWN_MS = 90_000;

interface BrowserHandle {
  browser: Browser | null;
  launching: Promise<Browser> | null;
  idleTimer: NodeJS.Timeout | null;
  leases: number;
}

/**
 * One instance per engine is shared across audits — launching costs ~1s, so we
 * keep each warm and close it after a period of inactivity. Stashed on
 * globalThis so Next's dev-mode module reloading does not leak browsers.
 */
const globalScope = globalThis as unknown as { __uixrayBrowsers?: Map<BrowserName, BrowserHandle> };
const handles: Map<BrowserName, BrowserHandle> = globalScope.__uixrayBrowsers ?? (globalScope.__uixrayBrowsers = new Map());

function handleFor(name: BrowserName): BrowserHandle {
  let handle = handles.get(name);
  if (!handle) {
    handle = { browser: null, launching: null, idleTimer: null, leases: 0 };
    handles.set(name, handle);
  }
  return handle;
}

// Chromium-only switches; Firefox and WebKit reject unknown arguments.
const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--font-render-hinting=none',
];

export async function acquireBrowser(name: BrowserName = 'chromium'): Promise<Browser> {
  const handle = handleFor(name);
  if (handle.idleTimer) {
    clearTimeout(handle.idleTimer);
    handle.idleTimer = null;
  }
  handle.leases++;

  if (handle.browser?.isConnected()) return handle.browser;
  if (handle.launching) return handle.launching;

  handle.launching = (async () => {
    try {
      const playwright = await import('playwright');
      const browser = await playwright[name].launch({
        headless: true,
        args: name === 'chromium' ? CHROMIUM_ARGS : [],
      });
      handle.browser = browser;
      browser.on('disconnected', () => {
        if (handle.browser === browser) handle.browser = null;
      });
      return browser;
    } catch (err) {
      // Every caller waiting on this launch receives the same rejection and
      // holds nothing to release, so no lease survives it.
      handle.leases = 0;
      const message = err instanceof Error ? err.message : String(err);
      throw new AuditError('BROWSER_LAUNCH', `Could not launch ${browserLabel(name)}: ${message.split('\n')[0]}`, {
        hint: `Run \`npx playwright install ${name}\` to download the browser binary.`,
        cause: err,
      });
    } finally {
      handle.launching = null;
    }
  })();

  return handle.launching;
}

/** Releases a lease; the browser closes once every audit has finished. */
export function releaseBrowser(name: BrowserName = 'chromium'): void {
  const handle = handleFor(name);
  handle.leases = Math.max(0, handle.leases - 1);
  if (handle.leases > 0) return;
  if (handle.idleTimer) clearTimeout(handle.idleTimer);
  handle.idleTimer = setTimeout(() => {
    handle.idleTimer = null;
    if (handle.leases === 0 && handle.browser) {
      const browser = handle.browser;
      handle.browser = null;
      void browser.close().catch(() => undefined);
    }
  }, IDLE_SHUTDOWN_MS);
  // Do not hold the Node event loop open just to close an idle browser.
  handle.idleTimer.unref?.();
}

export async function createContext(browser: Browser, viewport: ViewportSpec): Promise<BrowserContext> {
  // Firefox has no mobile emulation mode: `isMobile` throws there. It still
  // gets the device size, pixel ratio and touch input.
  const supportsMobile = viewport.browser !== 'firefox';
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    ...(supportsMobile ? { isMobile: viewport.isMobile } : {}),
    hasTouch: viewport.isMobile,
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'UTC',
    // Animations mid-flight produce unstable geometry; freeze them up front.
    reducedMotion: 'reduce',
    colorScheme: 'light',
    serviceWorkers: 'block',
  });
}

/** Test/ops helper: force every shared browser down immediately. */
export async function shutdownBrowser(): Promise<void> {
  for (const handle of handles.values()) {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
      handle.idleTimer = null;
    }
    handle.leases = 0;
    const browser = handle.browser;
    handle.browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }
}
