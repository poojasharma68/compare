import type { UiTestResult } from '@/lib/types/tests';
import { canonicalText, normalizeText, textSimilarity, truncate } from '@/lib/utils/text';
import { buildTest, type ComparisonContext, type MatchedPair } from './context';

/**
 * Compares the copy itself — the other half of what Figma's Dev Mode hands a
 * developer, alongside the style values.
 *
 * Text similarity is what pairs a layer with an element in the first place, so
 * without this check a near-miss ("Get started" vs "Get Started now") matches
 * happily and is then never reported. This is the check that closes that gap.
 *
 * Case is ignored whenever either side applies a case transform, because
 * `text-transform: uppercase` on an otherwise correct string is a styling
 * decision, not a copy error.
 */
export function compareContent(pair: MatchedPair, ctx: ComparisonContext): UiTestResult[] {
  const { node, el } = pair;
  if (node.type !== 'TEXT') return [];

  const expected = node.text?.trim();
  if (!expected) return [];

  // Prefer the element's own text; fall back to its subtree when the layer
  // matched a wrapper rather than the leaf that renders the string.
  const actualRaw = el.ownText?.trim() || el.text?.trim() || '';

  if (!actualRaw) {
    return [
      buildTest(ctx, {
        category: 'Structure',
        check: 'structure.textContent',
        title: 'Text content',
        pair,
        expected: truncate(expected, 80),
        actual: 'no text rendered',
        difference: 'missing copy',
        status: 'FAIL',
        severity: 'major',
        message: 'The matched element renders no text at all.',
      }),
    ];
  }

  const caseInsensitive = appliesCaseTransform(node.typography?.textTransform) || appliesCaseTransform(el.styles.textTransform);

  const left = caseInsensitive ? normalizeText(expected) : expected.replace(/\s+/g, ' ').trim();
  const right = caseInsensitive ? normalizeText(actualRaw) : actualRaw.replace(/\s+/g, ' ').trim();

  if (left === right) {
    return [
      buildTest(ctx, {
        category: 'Structure',
        check: 'structure.textContent',
        title: 'Text content',
        pair,
        expected: truncate(expected, 80),
        actual: truncate(actualRaw, 80),
        difference: 'exact',
        status: 'PASS',
        severity: 'none',
        message: caseInsensitive ? 'Compared case-insensitively because a case transform is applied.' : undefined,
      }),
    ];
  }

  // Identical words, different punctuation or spacing: worth surfacing, but a
  // curly apostrophe is not a build defect.
  const punctuationOnly = canonicalText(left) === canonicalText(right);
  const similarity = textSimilarity(left, right);
  const severity = punctuationOnly ? 'minor' : similarity >= 0.85 ? 'minor' : 'major';

  return [
    buildTest(ctx, {
      category: 'Structure',
      check: 'structure.textContent',
      title: 'Text content',
      pair,
      expected: truncate(expected, 80),
      actual: truncate(actualRaw, 80),
      difference: punctuationOnly ? 'punctuation differs' : `${Math.round(similarity * 100)}% match`,
      delta: Number((1 - similarity).toFixed(3)),
      status: severity === 'minor' ? 'WARNING' : 'FAIL',
      severity,
      message: punctuationOnly
        ? 'The words match but the punctuation or spacing differs from the design.'
        : `The design specifies "${truncate(expected, 60)}" but the page renders "${truncate(actualRaw, 60)}".`,
    }),
  ];
}

function appliesCaseTransform(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toUpperCase();
  return (
    normalized === 'UPPER' ||
    normalized === 'LOWER' ||
    normalized === 'TITLE' ||
    normalized === 'UPPERCASE' ||
    normalized === 'LOWERCASE' ||
    normalized === 'CAPITALIZE'
  );
}
