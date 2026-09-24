import type { Browser } from 'playwright';
import type { DesignTree } from '@/lib/types/figma';
import type { PageSnapshot, ViewportSpec } from '@/lib/types/dom';
import type { CrossBrowserTestResult, MatchingSummary, ResponsiveTestResult, UiTestResult } from '@/lib/types/tests';
import type { AuditStepId } from '@/lib/types/run';
import { resolveScale, resolveTolerances, type Tolerances } from '@/lib/config/tolerances';
import { passSpec, pickReferenceViewport, viewportsForGroups, type CustomViewport } from '@/lib/config/viewports';
import { browserLabel, orderBrowsers, type BrowserName } from '@/lib/config/browsers';
import { loadDesignTree } from '@/lib/figma/designSource';
import { envFigmaToken } from '@/lib/figma/figmaClient';
import { acquireBrowser, releaseBrowser } from '@/lib/browser/browserManager';
import { analyzePage } from '@/lib/browser/pageAnalyzer';
import { matchElements } from '@/lib/matching/elementMatcher';
import { runUiComparison } from '@/lib/comparison';
import { createResponsiveIdFactory, runResponsiveTests } from '@/lib/responsive';
import { createCrossBrowserIdFactory, runCrossBrowserTests } from '@/lib/crossbrowser';
import { buildReport } from '@/lib/report/reportGenerator';
import { captureFindingEvidence } from '@/lib/report/captureEvidence';
import { pruneEvidence } from '@/lib/report/evidenceStore';
import { setStep, setStepDetail, updateRun } from '@/lib/store/runStore';
import { AuditError, describeError, toAuditError } from '@/lib/utils/errors';
import { normalizeWebsiteUrl } from '@/lib/utils/url';

export interface AuditParams {
  runId: string;
  figmaUrl: string | null;
  websiteUrl: string;
  viewportGroups: string[];
  /** Engines to run in; the first that launches is the cross-browser reference. */
  browsers?: BrowserName[];
  /** User-entered dimensions, run alongside the selected groups. */
  customViewports?: CustomViewport[];
  figmaToken?: string | null;
  tolerances?: Partial<Tolerances>;
}

/**
 * Orchestrates one audit end to end.
 *
 * The two modules are deliberately independent: a Figma failure downgrades
 * module 1 to "skipped" and the responsive suite still produces a full report.
 * Only a browser failure is fatal, because without it there is nothing to test.
 */
export async function runAudit(params: AuditParams): Promise<void> {
  const { runId } = params;
  const createdAt = Date.now();
  const warnings: string[] = [];
  const tolerances = resolveTolerances(params.tolerances);

  updateRun(runId, (state) => {
    state.status = 'running';
  });

  const leased: BrowserName[] = [];

  try {
    /* ----------------------------- 1. Prepare ----------------------------- */
    setStep(runId, 'preparing', 'active');
    const websiteUrl = normalizeWebsiteUrl(params.websiteUrl);
    const viewports = viewportsForGroups(params.viewportGroups, params.customViewports ?? []);
    if (viewports.length === 0) {
      throw new AuditError('NO_VIEWPORTS', 'No viewports were selected.', {
        hint: 'Select at least one of Mobile, Tablet or Desktop, or add a custom size.',
      });
    }
    const requestedBrowsers = orderBrowsers(params.browsers ?? ['chromium']);
    void pruneEvidence().catch(() => undefined);
    setStep(
      runId,
      'preparing',
      'done',
      `${viewports.length} viewports × ${requestedBrowsers.length} browser${requestedBrowsers.length === 1 ? '' : 's'} queued`,
    );

    /* ------------------------------ 2. Figma ------------------------------ */
    let design: DesignTree | null = null;
    let figmaSkippedReason: string | undefined;

    if (params.figmaUrl) {
      const token = params.figmaToken?.trim() || envFigmaToken();
      try {
        if (!token) {
          throw new AuditError('FIGMA_AUTH', 'No Figma access token is configured.', {
            hint: 'Add FIGMA_TOKEN to .env.local, or paste a personal access token in the audit form.',
            recoverable: true,
          });
        }
        setStep(runId, 'figma-fetch', 'active');
        const result = await loadDesignTree(params.figmaUrl, token, {
          onProgress: (detail) => setStepDetail(runId, 'figma-fetch', detail),
        });
        design = result.tree;
        warnings.push(...result.warnings);
        setStep(runId, 'figma-fetch', 'done', design.fileName);

        setStep(runId, 'figma-parse', 'active');
        setStep(
          runId,
          'figma-parse',
          'done',
          `${design.nodes.length} layers from "${design.rootName}" (${design.rootWidth}×${design.rootHeight})`,
        );
      } catch (err) {
        // Module 1 degrades; module 2 carries on.
        const described = describeError(err);
        figmaSkippedReason = described.hint ? `${described.message} ${described.hint}` : described.message;
        warnings.push(`Figma comparison skipped: ${described.message}`);
        setStep(runId, 'figma-fetch', 'failed', described.message);
        setStep(runId, 'figma-parse', 'skipped');
        setStep(runId, 'matching', 'skipped');
        setStep(runId, 'ui-comparison', 'skipped');
        design = null;
      }
    }

    /* ----------------------------- 3. Browser ----------------------------- */
    // A browser that will not launch costs its own results, not the audit —
    // unless none of them launch.
    setStep(runId, 'browser-launch', 'active');
    const launched: Array<{ name: BrowserName; browser: Browser }> = [];
    let launchError: unknown = null;
    for (const name of requestedBrowsers) {
      try {
        const browser = await acquireBrowser(name);
        leased.push(name);
        launched.push({ name, browser });
      } catch (err) {
        launchError ??= err;
        const described = describeError(err);
        warnings.push(`${browserLabel(name)} was skipped: ${described.message} ${described.hint ?? ''}`.trim());
      }
    }
    if (launched.length === 0) throw launchError;
    setStep(runId, 'browser-launch', 'done', launched.map((b) => browserLabel(b.name)).join(' · '));

    const multiBrowser = launched.length > 1;
    const referenceBrowser = launched[0].name;
    if (!multiBrowser) setStep(runId, 'cross-browser', 'skipped');

    /* ---------------------------- 4. Page passes -------------------------- */
    // Every engine runs inside the page pass, while the browser still has the
    // page open. Evidence can then be captured around each finding wherever it
    // sits in the document, instead of one oversized full-page image that has
    // to be truncated and shows only the top of the page.
    const snapshots: PageSnapshot[] = [];
    const analysisFailures: string[] = [];
    const nextResponsiveId = createResponsiveIdFactory();
    const nextBrowserId = createCrossBrowserIdFactory();
    const testsByViewport = new Map<string, ResponsiveTestResult[]>();
    // Each browser's responsive baseline is its own widest viewport; mixing
    // engines would report rendering differences as visibility changes.
    const baselineByBrowser = new Map<BrowserName, PageSnapshot>();
    const comparisons: Array<{ viewport: ViewportSpec; tests: CrossBrowserTestResult[] }> = [];
    const deadBrowsers = new Set<BrowserName>();

    let matching: MatchingSummary | undefined;
    let uiTests: UiTestResult[] = [];
    let referenceSnapshot: PageSnapshot | undefined;
    let scale: number | undefined;

    // The design is compared against the viewport closest to the frame width;
    // knowing which one that is up front lets it be handled in the same pass.
    const referenceViewport = design ? pickReferenceViewport(viewports, design.rootWidth) : undefined;
    setStep(runId, 'responsive-tests', 'active');
    if (multiBrowser) setStep(runId, 'cross-browser', 'active');

    const runPass = async (
      entry: { name: BrowserName; browser: Browser },
      viewport: ViewportSpec,
      reference: PageSnapshot | null,
    ): Promise<PageSnapshot | null> => {
      const spec = passSpec(viewport, entry.name, multiBrowser);
      try {
        const snapshot = await analyzePage(entry.browser, websiteUrl, spec, {
          runId,
          captureScreenshot: true,
          onMeasured: async (measured, capture) => {
            const responsiveTests = runResponsiveTests(measured, {
              tolerances,
              baseline: baselineByBrowser.get(entry.name) ?? null,
              nextId: nextResponsiveId,
            });
            testsByViewport.set(spec.id, responsiveTests);

            const findings: Array<UiTestResult | ResponsiveTestResult | CrossBrowserTestResult> = [...responsiveTests];

            if (
              entry.name === referenceBrowser &&
              design &&
              referenceViewport &&
              viewport.id === referenceViewport.id
            ) {
              setStep(runId, 'matching', 'active');
              scale = resolveScale(viewport.width, design.rootWidth);
              referenceSnapshot = measured;
              matching = matchElements(design, measured, { tolerances, scale });
              setStep(
                runId,
                'matching',
                'done',
                `${matching.matches.length} matched · ${matching.missing.length} missing · ${matching.extra.length} extra`,
              );

              setStep(runId, 'ui-comparison', 'active');
              const comparison = runUiComparison(design, measured, matching, { tolerances, scale });
              uiTests = comparison.tests;
              setStep(
                runId,
                'ui-comparison',
                'done',
                `${uiTests.length} checks across ${comparison.comparedPairs} elements`,
              );
              findings.push(...uiTests);
            }

            if (reference) {
              const browserTests = runCrossBrowserTests(reference, measured, { tolerances, nextId: nextBrowserId });
              comparisons.push({ viewport: spec, tests: browserTests });
              findings.push(...browserTests);
            }

            await captureFindingEvidence(findings, capture, {
              viewportHeight: spec.height,
              maxShots: reference ? 8 : 6,
            });
          },
        });
        snapshots.push(snapshot);
        if (!baselineByBrowser.has(entry.name)) baselineByBrowser.set(entry.name, snapshot);
        warnings.push(...snapshot.warnings.map((w) => `${spec.label}: ${w}`));
        return snapshot;
      } catch (err) {
        const described = describeError(err);
        analysisFailures.push(`${spec.label}: ${described.message}`);
        warnings.push(`${spec.label} could not be analysed — ${described.message}`);
        // An engine that fails on its very first page will fail on the rest;
        // stop spending timeouts on it.
        if (!baselineByBrowser.has(entry.name)) deadBrowsers.add(entry.name);
        return null;
      }
    };

    for (const viewport of viewports) {
      const stepId = stepForGroup(viewport.group);
      setStep(runId, stepId, 'active', viewport.label);

      const active = launched.filter((b) => !deadBrowsers.has(b.name));
      if (active.length === 0) break;
      const [first, ...rest] = active;

      // The reference goes first so the others have something to be compared
      // against; the others are independent of each other and run together.
      const measuredReference = await runPass(first, viewport, null);
      if (snapshots.length === 0) {
        // The reference could not load the very first page: the site is
        // almost certainly unreachable, so do not grind through the rest.
        throw new AuditError('SITE_UNREACHABLE', `No viewport could be analysed. ${analysisFailures[0] ?? ''}`.trim());
      }
      // Only the designated reference browser is compared against; if it has
      // dropped out, the remaining browsers still get their responsive suite.
      const reference = first.name === referenceBrowser ? measuredReference : null;
      await Promise.all(rest.map((entry) => runPass(entry, viewport, reference)));

      setStepDetail(runId, stepId, `${viewport.label} · ${active.length} browser${active.length === 1 ? '' : 's'}`);
      if (multiBrowser) {
        setStepDetail(runId, 'cross-browser', `${comparisons.length} comparisons against ${browserLabel(referenceBrowser)}`);
      }
      markGroupDone(runId, viewports, snapshots, viewport, launched.length);
    }

    for (const name of deadBrowsers) {
      warnings.push(`${browserLabel(name)} could not load the page and was dropped from the rest of the run.`);
    }

    if (snapshots.length === 0) {
      throw new AuditError('SITE_UNREACHABLE', `No viewport could be analysed. ${analysisFailures[0] ?? ''}`.trim());
    }

    /* ------------------- 5. Diagnostics from what was found --------------- */
    if (design && !matching) {
      figmaSkippedReason = 'No viewport was available to compare the design against.';
      setStep(runId, 'matching', 'skipped');
      setStep(runId, 'ui-comparison', 'skipped');
    }

    if (design && matching && referenceSnapshot && scale !== undefined) {
      const region = matching.registration;
      const pageHeight = referenceSnapshot.metrics.scrollHeight;
      const coversWholePage = region.top <= 80 && region.bottom >= pageHeight * 0.85;

      if (matching.matches.length > 0 && !coversWholePage) {
        warnings.push(
          `The linked frame "${design.rootName}" maps to the page region ${region.top}–${region.bottom}px ` +
            `of a ${Math.round(pageHeight)}px page. Only that band was compared; everything outside it belongs ` +
            `to a different design and was left alone.`,
        );
      }

      if (matching.matches.length === 0) {
        warnings.push(
          'No Figma layer could be matched to an element on the page. The design and the URL may not correspond to the same screen.',
        );
      }

      if (scale !== 1) {
        warnings.push(
          `The design frame is ${design.rootWidth}px wide and the closest viewport is ${referenceSnapshot.viewport.width}px. ` +
            `Geometry was scaled by ${(scale * 100).toFixed(0)}% and tolerances were widened to absorb the error that scaling introduces.`,
        );
      } else if (referenceSnapshot.viewport.width !== design.rootWidth) {
        warnings.push(
          `The design frame is ${design.rootWidth}px wide and was compared at ${referenceSnapshot.viewport.width}px. ` +
            `Values are compared in absolute pixels; full-width elements are compared proportionally instead.`,
        );
      }
    }

    setStep(
      runId,
      'responsive-tests',
      'done',
      `${[...testsByViewport.values()].reduce((n, t) => n + t.length, 0)} checks across ${snapshots.length} page loads`,
    );

    if (multiBrowser) {
      const differences = comparisons.reduce(
        (n, c) => n + c.tests.filter((t) => t.status === 'FAIL' || t.status === 'WARNING').length,
        0,
      );
      setStep(
        runId,
        'cross-browser',
        comparisons.length > 0 ? 'done' : 'failed',
        `${comparisons.length} comparisons · ${differences} difference${differences === 1 ? '' : 's'}`,
      );
    }

    /* ----------------------------- 7. Report ------------------------------ */
    setStep(runId, 'report', 'active');
    const report = buildReport({
      runId,
      createdAt,
      finishedAt: Date.now(),
      input: {
        figmaUrl: params.figmaUrl,
        websiteUrl,
        finalUrl: snapshots[0]?.finalUrl ?? websiteUrl,
        viewportGroups: params.viewportGroups,
        viewportIds: snapshots.map((s) => s.viewport.id),
        browsers: launched.map((b) => b.name),
        customViewports: params.customViewports ?? [],
      },
      tolerances,
      warnings: dedupe(warnings),
      figma: {
        enabled: Boolean(params.figmaUrl),
        skippedReason: figmaSkippedReason,
        design: design ?? undefined,
        referenceSnapshot,
        scale,
        matching,
        tests: uiTests,
      },
      responsive: {
        enabled: true,
        snapshots,
        testsByViewport,
      },
      crossBrowser: {
        enabled: multiBrowser,
        skippedReason:
          requestedBrowsers.length < 2
            ? 'Select more than one browser to compare rendering between engines.'
            : !multiBrowser
              ? 'Only one of the selected browsers could be launched.'
              : undefined,
        browsers: launched.map((b) => b.name).filter((name) => !deadBrowsers.has(name)),
        referenceBrowser: multiBrowser ? referenceBrowser : undefined,
        comparisons,
      },
    });
    setStep(runId, 'report', 'done');

    updateRun(runId, (state) => {
      state.status = 'completed';
      state.report = report;
    });
  } catch (err) {
    const auditError = toAuditError(err);
    updateRun(runId, (state) => {
      state.status = 'failed';
      state.error = { message: auditError.message, code: auditError.code, hint: auditError.hint };
      for (const step of state.steps) {
        if (step.status === 'active') step.status = 'failed';
        else if (step.status === 'pending') step.status = 'skipped';
      }
    });
  } finally {
    for (const name of leased) releaseBrowser(name);
  }
}

function stepForGroup(group: ViewportSpec['group']): AuditStepId {
  switch (group) {
    case 'mobile':
      return 'analyze-mobile';
    case 'tablet':
      return 'analyze-tablet';
    default:
      return 'analyze-desktop';
  }
}

/** Marks a group's step done once its last viewport has been analysed. */
function markGroupDone(
  runId: string,
  viewports: ViewportSpec[],
  snapshots: PageSnapshot[],
  current: ViewportSpec,
  browserCount: number,
): void {
  const inGroup = viewports.filter((v) => v.group === current.group);
  const isLast = inGroup[inGroup.length - 1]?.id === current.id;
  if (!isLast) return;

  const analysed = snapshots.filter((s) => s.viewport.group === current.group).length;
  const expected = inGroup.length * browserCount;
  setStep(
    runId,
    stepForGroup(current.group),
    analysed > 0 ? 'done' : 'failed',
    browserCount > 1
      ? `${analysed}/${expected} page loads (${inGroup.length} viewports × ${browserCount} browsers)`
      : `${analysed}/${inGroup.length} viewports analysed`,
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)].slice(0, 24);
}
