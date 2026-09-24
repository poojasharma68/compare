import type { Browser, Page } from 'playwright';
import type { EvidenceShot, PageSnapshot, ViewportSpec } from '@/lib/types/dom';
import { AuditError } from '@/lib/utils/errors';
import { createShotId } from '@/lib/utils/id';
import { saveEvidence } from '@/lib/report/evidenceStore';
import { createContext } from './browserManager';
import { domExtractor, type ExtractionConfig } from './extractionScript';

export interface AnalyzeOptions {
  /** Hard cap for the initial navigation. */
  navigationTimeoutMs?: number;
  /** Extra budget spent waiting for network/fonts/images to settle. */
  settleTimeoutMs?: number;
  extraction?: Partial<ExtractionConfig>;
  /** Capture a context screenshot of the top of the page. */
  captureScreenshot?: boolean;
  runId?: string;
  /**
   * Runs while the page is still open, once measurement is complete.
   *
   * Evidence is captured here rather than afterwards because only the caller
   * knows which elements actually failed, and a crop can only be taken while
   * the page still exists.
   */
  onMeasured?: (snapshot: PageSnapshot, capture: EvidenceCapturer) => Promise<void>;
  /** Scroll through the page to trigger lazy-loaded content before measuring. */
  lazyLoadPass?: boolean;
}

const DEFAULT_EXTRACTION: ExtractionConfig = {
  // Enough to cover a long marketing page end to end rather than only the
  // sections above the fold.
  maxElements: 2000,
  minArea: 400,
  maxTextLength: 300,
};

/**
 * Captures a viewport-sized window of the page, positioned around a region of
 * interest. Handed to `onMeasured` so findings anywhere in the document get
 * evidence showing them in context.
 */
export interface EvidenceCapturer {
  captureAround(rect: { x: number; y: number; width: number; height: number }): Promise<CapturedShot | null>;
}

export interface CapturedShot extends EvidenceShot {
  /** Document Y the captured window starts at, for rebasing highlights. */
  offsetY: number;
}

/**
 * Loads a page at one viewport and captures everything the engines need:
 * element geometry, computed styles, page metrics and optional evidence.
 * Loading problems degrade into warnings wherever the page is still usable.
 */
export async function analyzePage(
  browser: Browser,
  url: string,
  viewport: ViewportSpec,
  options: AnalyzeOptions = {},
): Promise<PageSnapshot> {
  const navigationTimeout = options.navigationTimeoutMs ?? 35_000;
  const settleBudget = options.settleTimeoutMs ?? 9_000;
  const extraction: ExtractionConfig = { ...DEFAULT_EXTRACTION, ...options.extraction };

  const warnings: string[] = [];
  const consoleErrors: string[] = [];
  const started = Date.now();

  const context = await createContext(browser, viewport);
  let page: Page | null = null;

  try {
    page = await context.newPage();
    page.setDefaultTimeout(navigationTimeout);

    // Page-level JS failures are reported, never fatal: a site that throws can
    // still be measured, and the error explains odd-looking results.
    page.on('pageerror', (err) => {
      if (consoleErrors.length < 12) consoleErrors.push(`Uncaught: ${err.message}`.slice(0, 240));
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error' && consoleErrors.length < 12) {
        consoleErrors.push(msg.text().slice(0, 240));
      }
    });

    const response = await gotoWithDiagnostics(page, url, navigationTimeout);
    if (response && response.status() >= 400) {
      warnings.push(`The site responded with HTTP ${response.status()} — results reflect the error page.`);
    }

    await settle(page, settleBudget, warnings);

    if (options.lazyLoadPass !== false) {
      await runLazyLoadPass(page).catch(() => {
        warnings.push('Lazy-load scroll pass did not complete; below-the-fold content may be missing.');
      });
    }

    // Freeze animations and transitions so geometry is measured at rest.
    await page
      .addStyleTag({
        content:
          '*,*::before,*::after{animation-duration:0s !important;animation-delay:0s !important;' +
          'transition-duration:0s !important;transition-delay:0s !important;' +
          'animation-iteration-count:1 !important;caret-color:transparent !important;}',
      })
      .catch(() => undefined);
    await page.waitForTimeout(250);

    const { elements, metrics } = await page.evaluate(domExtractor, extraction);

    if (elements.length === 0) {
      warnings.push('No visible elements were extracted — the page may render entirely inside a frame or canvas.');
    }

    let screenshot: EvidenceShot | undefined;
    if (options.captureScreenshot && options.runId) {
      screenshot = await captureWindow(page, options.runId, viewport, 0).catch(() => undefined);
      if (!screenshot) warnings.push('Context screenshot could not be captured for this viewport.');
    }

    const snapshot: PageSnapshot = {
      viewport,
      url,
      finalUrl: page.url(),
      elements,
      metrics,
      warnings,
      consoleErrors,
      loadMs: Date.now() - started,
      screenshot,
    };

    if (options.onMeasured && options.runId) {
      const runId = options.runId;
      const activePage = page;
      await options
        .onMeasured(snapshot, {
          captureAround: (rect) => captureAround(activePage, runId, viewport, rect, metrics.scrollHeight),
        })
        .catch(() => {
          warnings.push('Evidence capture did not complete for this viewport.');
        });
    }

    return snapshot;
  } finally {
    await page?.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

/** Unreachable, retained only so the original return shape stays documented. */
async function gotoWithDiagnostics(page: Page, url: string, timeout: number) {
  try {
    return await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Timeout|timeout/.test(message)) {
      throw new AuditError('SITE_TIMEOUT', `"${url}" did not respond within ${Math.round(timeout / 1000)}s.`, {
        hint: 'The site may be slow, behind a login wall, or blocking automated browsers.',
        cause: err,
      });
    }
    if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_ADDRESS|ERR_INTERNET|ENOTFOUND|ECONNREFUSED/.test(message)) {
      throw new AuditError('SITE_UNREACHABLE', `Could not reach "${url}".`, {
        hint: 'Check the URL, and make sure the site is publicly reachable from this machine.',
        cause: err,
      });
    }
    if (/ERR_CERT|SSL/.test(message)) {
      throw new AuditError('SITE_UNREACHABLE', `TLS handshake with "${url}" failed.`, {
        hint: 'Certificate errors are ignored where possible, but this one blocked the load entirely.',
        cause: err,
      });
    }
    throw new AuditError('SITE_UNREACHABLE', `Navigation to "${url}" failed: ${message}`, { cause: err });
  }
}

/**
 * Waits for the page to stop moving, spending a bounded budget across network
 * idle, web fonts and images. Each wait degrades to a warning rather than
 * failing the audit — a never-idle analytics socket must not block a report.
 */
async function settle(page: Page, budgetMs: number, warnings: string[]): Promise<void> {
  const deadline = Date.now() + budgetMs;
  const remaining = () => Math.max(500, deadline - Date.now());

  try {
    await page.waitForLoadState('networkidle', { timeout: Math.min(remaining(), 6000) });
  } catch {
    warnings.push('Network never went idle; measured once the load budget expired.');
  }

  try {
    await page.evaluate(
      (timeoutMs) =>
        Promise.race([
          document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true),
          new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
        ]),
      Math.min(remaining(), 3000),
    );
  } catch {
    warnings.push('Web fonts did not finish loading; typography measurements may reflect fallback fonts.');
  }

  try {
    const allLoaded = await page.evaluate(
      (timeoutMs) =>
        new Promise<boolean>((resolve) => {
          var images = Array.prototype.slice.call(document.images) as HTMLImageElement[];
          var pending = images.filter(function (img) {
            return !img.complete;
          });
          if (pending.length === 0) {
            resolve(true);
            return;
          }
          var settled = 0;
          var done = false;
          var finish = function (ok: boolean) {
            if (!done) {
              done = true;
              resolve(ok);
            }
          };
          setTimeout(function () {
            finish(false);
          }, timeoutMs);
          pending.forEach(function (img) {
            var mark = function () {
              settled++;
              if (settled >= pending.length) finish(true);
            };
            img.addEventListener('load', mark, { once: true });
            img.addEventListener('error', mark, { once: true });
          });
        }),
      Math.min(remaining(), 4000),
    );
    if (!allLoaded) warnings.push('Some images were still loading when measurement started.');
  } catch {
    /* image settling is best-effort */
  }
}

/**
 * Many sites reveal content on scroll. Step down the page and back up so
 * lazy content exists before measuring, then restore scroll to the top so
 * geometry is captured from a known position.
 */
async function runLazyLoadPass(page: Page): Promise<void> {
  await page.evaluate(async () => {
    var step = window.innerHeight * 0.85;
    var maxSteps = 12;
    for (var i = 0; i < maxSteps; i++) {
      var before = window.scrollY;
      window.scrollTo(0, before + step);
      await new Promise((r) => setTimeout(r, 120));
      if (window.scrollY <= before) break;
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
  await page.waitForTimeout(300);
}

/**
 * Positions a region of interest inside the viewport and captures it.
 *
 * A single full-page screenshot is the obvious approach and the wrong one: a
 * 22,000px page produces an unusable image, and any cap on its height silently
 * discards evidence for everything below the cut. Scrolling to each finding and
 * capturing one screenful keeps every image small, fast and actually readable,
 * and works just as well at the bottom of a long page as at the top.
 */
async function captureAround(
  page: Page,
  runId: string,
  viewport: ViewportSpec,
  rect: { x: number; y: number; width: number; height: number },
  scrollHeight: number,
): Promise<CapturedShot | null> {
  // Sit the element about a third down the window so its surroundings show.
  const desired = rect.y - viewport.height / 3;
  const maxScroll = Math.max(0, scrollHeight - viewport.height);
  const target = Math.max(0, Math.min(desired, maxScroll));

  try {
    return await captureWindow(page, runId, viewport, target);
  } catch {
    return null;
  }
}

async function captureWindow(
  page: Page,
  runId: string,
  viewport: ViewportSpec,
  scrollTo: number,
): Promise<CapturedShot> {
  await page.evaluate((y) => window.scrollTo(0, y), scrollTo).catch(() => undefined);
  // Let sticky headers and scroll-linked effects settle before capturing.
  await page.waitForTimeout(90);
  const actual = await page.evaluate(() => window.scrollY).catch(() => scrollTo);

  const buffer = await page.screenshot({
    type: 'png',
    scale: 'css',
    animations: 'disabled',
    timeout: 15_000,
  });

  const id = createShotId(viewport.id.replace(/[^A-Za-z0-9_-]/g, ''));
  await saveEvidence(runId, id, buffer);
  return { id, width: viewport.width, height: viewport.height, offsetY: Math.round(actual) };
}
