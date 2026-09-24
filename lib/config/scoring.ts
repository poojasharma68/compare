import type { BrowserCategory, ResponsiveCategory, UiCategory } from '@/lib/types/tests';

/** UI score weights — must sum to 1. */
export const UI_WEIGHTS: Record<UiCategory, number> = {
  Layout: 0.3,
  Typography: 0.2,
  Spacing: 0.15,
  Color: 0.1,
  Styling: 0.1,
  Structure: 0.15,
};

/** Responsive score weights — must sum to 1. */
export const RESPONSIVE_WEIGHTS: Record<ResponsiveCategory, number> = {
  Overflow: 0.26,
  Overlap: 0.18,
  Clipping: 0.14,
  Layout: 0.16,
  Visibility: 0.12,
  Image: 0.08,
  Wrapping: 0.06,
};

/** Cross-browser score weights — must sum to 1. */
export const BROWSER_WEIGHTS: Record<BrowserCategory, number> = {
  Page: 0.3,
  Presence: 0.25,
  Size: 0.2,
  Position: 0.15,
  Text: 0.1,
};

/**
 * Penalty applied per failing test, by severity. A category's score is
 * `100 - (sum of penalties / number of tests in that category) * 100`,
 * so one critical failure in a 10-test category costs 10 points.
 */
export const SEVERITY_PENALTY: Record<string, number> = {
  none: 0,
  minor: 0.34,
  major: 0.7,
  critical: 1,
};

export const UI_METHODOLOGY =
  'Each category scores 100 minus the average severity penalty of its tests ' +
  '(minor 34%, major 70%, critical 100%). Categories are then combined with ' +
  'fixed weights: Layout 30%, Typography 20%, Spacing 15%, Structure 15%, ' +
  'Color 10%, Styling 10%. Categories with no testable elements are dropped ' +
  'and the remaining weights are renormalized, so an untestable category never ' +
  'silently inflates or deflates the score.';

export const RESPONSIVE_METHODOLOGY =
  'Every viewport is scored independently: each detector category scores 100 ' +
  'minus the average severity penalty of its tests, then categories are ' +
  'weighted — Overflow 26%, Overlap 18%, Layout 16%, Clipping 14%, ' +
  'Visibility 12%, Image 8%, Wrapping 6%. The headline responsive score is the ' +
  'mean of the per-viewport scores, so one broken breakpoint cannot be hidden ' +
  'by several healthy ones.';

export const BROWSER_METHODOLOGY =
  'Each browser is compared against the reference browser at every viewport. ' +
  'A comparison scores each category 100 minus the average severity penalty of ' +
  'its tests, weighted Page 30% (overflow, height), Presence 25%, Size 20%, ' +
  'Position 15%, Text 10%. The headline score is the mean over every ' +
  'browser × viewport comparison, so one engine breaking at one width cannot ' +
  'be hidden by the rest.';
