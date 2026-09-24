# UIX-Ray

**Frontend UI & Responsive Testing.**

Point UIX-Ray at a Figma frame and a live URL. It reads the design through the
Figma REST API, measures the real page with Playwright, matches design layers to
DOM elements, and reports where the implementation drifts — plus every
responsive break across nine viewports.

The core design decision: **this is not a pixel-diffing tool.** Every verdict
comes from Figma node metadata, DOM structure, computed CSS and element
geometry. Screenshots are captured only as supporting evidence for failures and
never contribute to a score.

---

## Quick start

```bash
npm install          # also downloads the Chromium build Playwright drives
npm run dev          # http://localhost:3000
```

For the Figma module you need a personal access token
(Figma → Settings → Personal access tokens, `file_read` scope):

```bash
# .env.local
FIGMA_TOKEN=figd_your_token_here
```

If no server token is configured the audit form offers a token field instead,
used for that run only and never persisted.

Without any Figma input, UIX-Ray runs the responsive suite on its own.

```bash
npm run build && npm start   # production
npm run typecheck            # tsc --noEmit
```

---

## What it does

### Module 1 — Figma → live website comparison

1. Parses the file key and `node-id` out of the Figma URL.
2. Fetches the file at shallow depth, ranks the top-level frames, and downloads
   the one you linked (or the best web-screen candidate if you linked none).
3. Normalizes the Figma subtree into a frame-relative design tree with
   CSS-flavoured properties — position, size, type styles, fills, strokes,
   radii, auto-layout padding and gap, opacity, visibility.
4. Loads the page in Chromium and extracts meaningful elements with their
   `getBoundingClientRect()` geometry and `getComputedStyle()` values.
5. Matches layers to elements using weighted signals.
6. Runs six comparators and scores the result.

Checks cover **Layout** (position, size, alignment), **Spacing** (padding, gap,
sibling rhythm), **Typography** (family, size, weight, line height, letter
spacing, alignment), **Color** (text, background, border, as CIE76 ΔE),
**Styling** (radius, border width, opacity, image rendering) and **Structure**
(text content, missing, extra, hierarchy).

### What gets asserted, and what does not

UIX-Ray compares what Figma's Dev Mode actually specifies — the values a
developer is handed and expected to implement — rather than every number that
can be measured.

**Dimensions follow Fixed / Hug / Fill.** Figma records, per axis, whether a
size was chosen or merely resulted from the content. A height set to *Hug* is
whatever the copy produced; since real copy is never the same length as the
placeholder copy in a mockup, asserting it reports a difference on nearly every
element while saying nothing actionable. So a height is only checked when the
design *fixes* it. Widths behave the same way: *Fill* is compared as a share of
its container, *Fixed* in absolute pixels, *Hug* not at all.

**Vertical position is only compared against a matched ancestor.** An element's
absolute Y is the sum of every margin, line wrap and image above it, so it
differs from the design by construction — one extra line near the top shifts the
whole document. Measured inside its own container, the same number becomes a
real spacing defect, which is where it is reported.

**Copy is compared directly.** Text similarity is what pairs a layer with an
element, so without an explicit check a near-miss ("Get started" vs "Get Started
now") would match happily and never be mentioned. Case is ignored when either
side applies a case transform, since `text-transform: uppercase` is styling, not
a copy error.

### Module 2 — Multi-viewport responsive testing

Runs independently of Figma across nine viewports (3 mobile, 2 tablet,
4 desktop), selectable by group. Detectors:

| Detector | Catches |
| --- | --- |
| Overflow | Document-level horizontal scroll, plus the outermost element causing it |
| Overlap | Elements in normal flow that collide |
| Clipping | Text cut off by its container, distinguishing silent loss from designed ellipsis |
| Wrapping | Unbreakable tokens, text escaping its container, boxes that do not grow with wrapped lines |
| Visibility | Content that appears or disappears between viewports |
| Layout | Missing viewport meta, fixed-width containers, grid/flex overflow, escaping children, excessive whitespace |
| Image | Viewport and container overflow, aspect distortion, broken sources |

Besides the presets, any exact **custom size** (240–3840 × 240–2400, up to six)
can be added; it is grouped as mobile, tablet or desktop by width.

### Module 3 — Cross-browser comparison

Pick any of **Chromium, Firefox and WebKit**. Every viewport runs in every
selected browser, and each browser gets its own responsive suite. With two or
more, each browser is also diffed against the reference (Chromium, when
selected) at the same viewport, keyed by selector:

| Check | Catches |
| --- | --- |
| Page | Horizontal scroll only one engine has; page height diverging by >12% |
| Presence | Elements rendered in one browser but missing (or only present) in another |
| Size | Elements a different width or height than in the reference |
| Position | Elements shifted inside their parent |
| Text | Text wrapping onto a different number of lines, or clipped only here |

Width differences are attributed to the outermost element (a too-wide wrapper
makes its children too wide), height differences to the innermost (a taller card
makes its grid, section and body taller). Siblings that changed by the same
amount collapse into one finding, and anything shifted only because something
above it grew is not reported. A difference in the layout viewport itself —
e.g. Firefox, which has no mobile emulation, laying out a page without a
viewport meta tag at device width — is reported once and geometry is skipped.

The other browsers run in parallel after the reference, so three browsers cost
roughly twice the time of one, not three times.

---

## The matching engine

Matching is the part that decides whether anything else is meaningful, so it
uses several signals rather than one:

| Signal | Role |
| --- | --- |
| Text | Dominant for TEXT layers — exact, edit-distance, token overlap and containment |
| Type | Figma node type vs. semantic HTML compatibility |
| Geometry | Scaled position, size, and centre alignment |
| Name | Layer name vs. tag, id, class and role tokens |
| Hierarchy | Second pass: does the element sit under the parent's matched element |

Candidates are narrowed by a text-token index and a spatial grid, then assigned
greedily, highest-confidence first, one-to-one. Weights shift with what a node
actually offers: a TEXT layer is identified mostly by its copy, a frame mostly
by its box.

Two thresholds matter:

- `MATCH_THRESHOLD` (0.55) — below this, no pairing at all.
- `STRICT_MATCH_THRESHOLD` (0.72) — below this, a pairing is reported but never
  used to assert anything. A layer whose best candidate falls in between is
  reported as *could not be confidently located* rather than being silently
  compared against the wrong element, or silently declared missing.

---

## Avoiding false positives

A UI test tool that cries wolf is worse than none. The measures that matter
most:

- **Relative positioning.** Positions are compared against the nearest matched
  ancestor. Absolute page coordinates drift legitimately — one extra paragraph
  shifts everything below it.
- **Frame origin registration.** The design frame's true position on the page is
  derived from the median offset across confident matches, so a centred shell is
  not reported as uniformly misplaced.
- **No gratuitous scaling.** Figma px and CSS px are the same unit. When the
  frame and reference viewport are within 20%, values are compared absolutely.
  Beyond that, geometry is scaled *and* tolerances widen by the error scaling
  introduces.
- **Proportional widths.** Elements that fill their container in the design are
  compared as a share of that container, not in absolute pixels.
- **Layout viewport, not device width.** A page without a viewport meta tag lays
  out at ~980px on a 375px phone. All geometry is compared against the width the
  browser actually used, and the discrepancy is reported as its own finding.
- **Section frames are located, not assumed.** A linked frame is often one
  section of a longer page, and its own coordinates start at zero regardless.
  The frame's real page position is fitted from confident matches and reported
  as a page band; only elements inside that band are compared. Without it, every
  header, nav link and hero element above the section is flagged as "not in the
  design" — true, but never what was asked.
- **Whole-page coverage.** Design and page coordinates drift apart cumulatively
  down a long page, so a fixed offset is not enough to find anything past the
  first screenful. Confident text matches are used to fit `pageY = a·designY + b`
  with a Theil–Sen estimator, and the rest of the page is then searched where
  its content actually is. Evidence screenshots cover the full page, and element
  pruning carries no above-the-fold bias.
- **Root-cause collapsing.** When a 1200px shell pushes the page sideways, its
  children are all "outside the viewport" too. Only the outermost offender is
  reported, with a count of what was folded into it.
- **Intent heuristics.** Positioned and z-indexed elements are excluded from
  overlap. `object-fit: cover` is not distortion. A nav that hides while a menu
  toggle appears is the mobile pattern, not a defect. Screen-reader-only text is
  not clipped text. A horizontal scroller is not a flex overflow. An image that
  has not finished loading is not a broken image.

Verified against two fixtures: a deliberately broken page (scores 43%, surfaces
eight distinct root causes) and a correctly built responsive page (scores 100%
with zero findings).

---

## Evidence

Evidence is captured **per finding**, not per page.

A single full-page screenshot is the obvious approach and the wrong one: a
22,000px page produces an unusable image, and any cap on its height silently
discards evidence for everything below the cut — which on a long page is most
of it. Instead, once a viewport's tests are computed the browser scrolls to
each failing element and captures one screenful, with the element sitting about
a third of the way down so its surroundings are visible.

Findings within 240px of each other share a capture, so a section with six
problems costs one screenshot rather than six. Captures are budgeted per
viewport (six by default, worst-severity first); findings beyond the budget keep
every measured value and simply have no picture attached. Each image is
viewport-sized — tens of kilobytes rather than megabytes.

This is why the evidence for a problem 18,000px down a page shows that problem,
rather than the top of the page.

## Scoring

Scores are transparent and shown with their working in the UI, behind the
"How this score is calculated" tooltip and the score breakdown panel.

A category scores `100 − (mean severity penalty × 100)`, where a minor issue
costs 0.34, a major 0.7 and a critical 1.0. Averaging rather than summing keeps
a 5-test category comparable to a 200-test one.

**UI score** weights: Layout 30%, Typography 20%, Spacing 15%, Structure 15%,
Color 10%, Styling 10%.

**Responsive score** weights: Overflow 26%, Overlap 18%, Layout 16%, Clipping
14%, Visibility 12%, Image 8%, Wrapping 6%. Each viewport is scored
independently and the headline figure is their mean, so one broken breakpoint
cannot be hidden by several healthy ones.

Categories with no testable elements are dropped and the remaining weights
renormalized, so an untestable category never silently inflates or deflates a
score.

---

## Architecture

```
app/
  page.tsx                         audit form
  audit/[runId]/                   live progress (SSE)
  report/[runId]/                  dashboard
  api/audit/                       start a run, poll state, stream progress
  api/evidence/[runId]/[shotId]/   evidence screenshots

lib/
  config/       tolerances, viewports, scoring weights
  figma/        figmaUrl · figmaClient · figmaParser · designNormalizer · designSource
  browser/      browserManager · pageAnalyzer · extractionScript
  matching/     similarity · elementMatcher
  comparison/   content · layout · typography · spacing · color · style · structure
  responsive/   overflow · overlap · clipping · wrapping · visibility · layout · image detectors
  report/       reportGenerator · scoring · captureEvidence · evidenceStore
  runner/       auditRunner (orchestration)
  store/        runStore (in-memory run registry)
  types/        figma · dom · tests · report · run

components/
  ui/           shared primitives
  audit/        form and progress timeline
  report/       summary, tables, viewport cards, issue detail, evidence viewer
```

Every engine is independent and communicates only through the types in
`lib/types`. A comparator or detector that throws is caught and logged; the rest
of the audit still produces a report.

### Extension points

The MVP deliberately stops at two modules, but the seams are in place:

- **New test engines** (accessibility, performance, API, security) plug in as a
  new `lib/<engine>/` directory producing results that satisfy `BaseTestResult`,
  plus a section in `buildReport`.
- **AI analysis** would consume `AuditReport` — it is a complete, serializable
  description of the audit with no rendering concerns baked in.
- **Persistence**: `lib/store/runStore.ts` is the only stateful module. Its
  narrow interface (`createRun`, `getRun`, `updateRun`, `subscribeToRun`) is
  what a Redis or Postgres implementation would need to satisfy.
- **Thresholds**: everything lives in `lib/config/tolerances.ts` and can be
  overridden per run via the `tolerances` field on the audit request.

---

## Error handling

Failures degrade rather than abort. A Figma problem — bad URL, rejected token,
missing file, deleted frame, rate limit, empty frame — marks Module 1 skipped
with an actionable reason and the responsive suite still produces a full report.
A viewport that fails to load is recorded and the remaining viewports continue.
Network idle that never arrives, fonts that never load, images still in flight:
each degrades to a note on the report rather than a failed audit. Only an
unreachable site or a browser that will not launch ends a run.

---

## Known limitations

- **Runs are in-memory.** Reports are lost when the server restarts, and the
  design assumes a single process. This is the first thing to replace for
  multi-instance deployment.
- **One frame per audit.** UIX-Ray compares a single Figma frame against a
  single URL. Linking a specific frame gives markedly better results than
  letting it guess. A section frame works as well as a full-page one — it is
  located on the page first, and the report states the band it mapped to.
- **Evidence is budgeted.** Six screenshots per viewport by default. Lower-
  severity findings past that budget carry their full measurements but no image.
- **Locating a frame needs anchors.** Placement is fitted from confident text
  matches. A frame with almost no copy in it (pure imagery, icons) cannot be
  located reliably and falls back to assuming it starts at the top of the page.
- **Auto-layout only for spacing.** Figma exposes padding and gap only on
  auto-layout frames; elsewhere spacing is inferred geometrically.
- **Sizing modes need a reasonably modern file.** Fixed / Hug / Fill comes from
  `layoutSizing*`, `textAutoResize` and the legacy auto-layout sizing modes. If a
  file predates all of them, text heights are assumed content-driven and skipped
  rather than guessed at.
- **Gradients collapse to their midpoint stop** for colour comparison.
- **Transform-based carousels** may still register as flex overflow. Scroller-
  based ones are correctly ignored.
- **Authenticated pages are not supported** — there is no login step.
