import type { DomElement } from '@/lib/types/dom';
import type { ResponsiveTestResult } from '@/lib/types/tests';
import { buildResponsiveTest, layoutViewportWidth, parentOf, px, round, type ResponsiveContext } from './context';

const MAX_REPORTED = 6;

/**
 * Image behaviour at this viewport: overflow, container escape, distortion and
 * broken sources.
 *
 * `object-fit: cover`/`contain` exist precisely so images can be cropped to fit,
 * so aspect-ratio differences are only reported when the fit mode means the
 * image is genuinely being stretched.
 */
export function detectImageProblems(ctx: ResponsiveContext): ResponsiveTestResult[] {
  const images = ctx.snapshot.elements.filter((el) => el.tag === 'img' || el.tag === 'picture' || el.tag === 'video');
  const findings: ResponsiveTestResult[] = [];
  const viewportWidth = layoutViewportWidth(ctx);

  for (const img of images) {
    if (findings.length >= MAX_REPORTED) break;

    // `complete === false` means the fetch was still in flight when we
    // measured, which is a timing artefact rather than a broken source.
    const stillLoading = img.imageComplete === false;
    if (img.tag === 'img' && !stillLoading && img.naturalWidth === 0 && img.naturalHeight === 0) {
      findings.push(
        buildResponsiveTest(ctx, {
          category: 'Image',
          check: 'image.broken',
          title: 'Image failed to load',
          element: img.label,
          selector: img.selector,
          expected: 'Image loads successfully',
          actual: `No intrinsic size — the source did not load`,
          difference: 'broken source',
          status: 'FAIL',
          severity: 'critical',
          message: `${img.src || 'The image source'} did not load. The element still occupies ${px(
            img.rect.width,
          )}×${px(img.rect.height)} in the layout.`,
          highlight: img,
        }),
      );
      continue;
    }

    const overhang = img.rect.right - viewportWidth;
    if (overhang > ctx.tolerances.OVERFLOW_TOLERANCE && !img.clippedByAncestor) {
      findings.push(
        buildResponsiveTest(ctx, {
          category: 'Image',
          check: 'image.viewportOverflow',
          title: 'Image extends outside the viewport',
          element: img.label,
          selector: img.selector,
          expected: `Width at most ${px(viewportWidth)}`,
          actual: `${px(img.rect.width)} wide, right edge at ${px(img.rect.right)}`,
          difference: `${px(overhang)} outside`,
          delta: round(overhang),
          status: 'FAIL',
          severity: overhang > 40 ? 'major' : 'minor',
          message: `Add \`max-width: 100%\` (and \`height: auto\`) so this image scales down with the viewport.`,
          highlight: img,
        }),
      );
      continue;
    }

    const container = parentOf(img, ctx);
    if (container && !container.clipsOverflow && container.rect.width > 0) {
      const spill = img.rect.right - (container.rect.right - container.styles.paddingRight);
      if (spill > 6) {
        findings.push(
          buildResponsiveTest(ctx, {
            category: 'Image',
            check: 'image.containerOverflow',
            title: 'Image overflows its container',
            element: img.label,
            selector: img.selector,
            expected: `Fits inside ${container.label}`,
            actual: `Extends ${px(spill)} past the container`,
            difference: `${px(spill)} outside`,
            delta: round(spill),
            status: 'FAIL',
            severity: spill > 32 ? 'major' : 'minor',
            highlight: img,
          }),
        );
        continue;
      }
    }

    const distortion = measureDistortion(img);
    if (distortion !== null && distortion > ctx.tolerances.IMAGE_DISTORTION_RATIO) {
      findings.push(
        buildResponsiveTest(ctx, {
          category: 'Image',
          check: 'image.distortion',
          title: 'Image is distorted',
          element: img.label,
          selector: img.selector,
          expected: `Aspect ratio ${formatRatio(img.naturalWidth!, img.naturalHeight!)} preserved`,
          actual: `Rendered at ${formatRatio(img.rect.width, img.rect.height)} with \`object-fit: ${
            img.styles.objectFit || 'fill'
          }\``,
          difference: `${Math.round(distortion * 100)}% aspect distortion`,
          delta: round(distortion, 3),
          status: 'FAIL',
          severity: distortion > 0.5 ? 'major' : 'minor',
          message: `The image is being stretched. Use \`object-fit: cover\` or set only one of width/height to preserve the ratio.`,
          highlight: img,
        }),
      );
    }
  }

  if (images.length === 0) {
    return [
      buildResponsiveTest(ctx, {
        category: 'Image',
        check: 'image.none',
        title: 'No images to test',
        element: 'document',
        expected: 'Images scale within their container',
        actual: 'The page renders no image elements at this viewport',
        difference: 'n/a',
        status: 'PASS',
        severity: 'none',
      }),
    ];
  }

  // At most one finding is recorded per image, so the remainder are clean.
  const clean = images.length - findings.length;
  if (clean > 0) {
    findings.unshift(
      buildResponsiveTest(ctx, {
        category: 'Image',
        check: 'image.responsive',
        title: 'Images are responsive',
        element:
          findings.length === 0
            ? `${images.length} image${images.length === 1 ? '' : 's'}`
            : `${clean} of ${images.length} images`,
        expected: 'Images fit their container and keep their aspect ratio',
        actual: `${clean} image${clean === 1 ? '' : 's'} scale correctly at this viewport`,
        difference: 'none',
        status: 'PASS',
        severity: 'none',
      }),
    );
  }

  return findings;
}

/**
 * Relative aspect-ratio error, or null when distortion is impossible to judge
 * (no intrinsic size) or explicitly handled by the fit mode.
 */
function measureDistortion(img: DomElement): number | null {
  if (img.imageComplete === false) return null;
  if (!img.naturalWidth || !img.naturalHeight) return null;
  if (img.rect.width < 8 || img.rect.height < 8) return null;

  const fit = img.styles.objectFit;
  // cover/contain/scale-down all preserve the ratio by cropping or letterboxing.
  if (fit === 'cover' || fit === 'contain' || fit === 'scale-down') return null;

  const natural = img.naturalWidth / img.naturalHeight;
  const rendered = img.rect.width / img.rect.height;
  return Math.abs(rendered - natural) / natural;
}

function formatRatio(width: number, height: number): string {
  if (!height) return '—';
  return `${(width / height).toFixed(2)}:1`;
}
