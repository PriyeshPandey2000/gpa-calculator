# Calculator feedback and analytics

Implemented for `/`, `/high-school-gpa-calculator/`, and `/cumulative-gpa-calculator/`.
The shared narrow-screen summary is shown below 1024 CSS pixels and links to the full result. It disappears when the full numeric result is visible. An invalid cumulative result instead links to the field requiring correction.

## Events

| Event | Trigger |
| --- | --- |
| `calculator_started` | First trusted grade, course-type, or numeric edit, or credit-stepper click, per page instance. Initialization, shared-result restoration, names, adding default rows, and opening modes do not start the funnel. |
| `calculator_result_updated` | Changed result/input state after 450 ms without another edit, after the calculator has started. `validity` is `complete`, `partial`, `invalid`, or `empty`. |
| `calculator_result_viewed` | A complete result stays fully within the viewport for at least one continuous second while the document is visible. Recorded once per result version and surface: `compact` or `full`. Sticky headers and the compact summary are excluded from the usable area. This measures exposure, not attention. |
| `calculator_validation_error` | A cumulative GPA/credits field remains invalid after the settling delay. Includes only `field_category`, `reason_code`, and excluded-row count. Repeated edits with the same reason do not repeat the event. |
| `calculator_validation_resolved` | An invalid cumulative field becomes valid in the same mode. Includes correction duration. Deleting, clearing, resetting, switching modes, or excluding an invalid course does not count as correcting the field. |

Common properties: `calculator_type` (`quick`, `high_school`, `cumulative`), `entry_mode`, `viewport_bucket`, `schema_version`, and a random `calculator_instance_id`. Updates/views also include `result_version` and `ms_since_start`. A new result version resets exposure eligibility; resetting the form does not reuse a previous version number.

The state fingerprint remains in memory. Custom properties do not contain course/semester names, raw field values, exact GPA/credits, or serialized shared-result data. The explicit `$current_url` and `$referrer` properties strip query strings and fragments. Existing PostHog autocapture/replay configuration is unchanged.

New custom events are sent only on `gpacalculatorfree.com` and `www.gpacalculatorfree.com`. In development, they are available through the local `calculator:analytics` DOM event; local/preview checks do not send these custom events to PostHog. Analytics failure does not block calculations.

Uses the existing [PostHog JavaScript capture API](https://posthog.com/docs/references/posthog-js#capture).

## Validation funnels after deployment

Use unique sessions, broken down by calculator and viewport:

1. `calculator_started` → `calculator_result_updated` with `validity=complete` → `calculator_result_viewed`.
2. For the compact-summary improvement, compare start-to-exposure time (`ms_since_start`) on narrow screens. Filter `surface=full` separately to measure visits to the full result; do not sum compact and full views as two completions.
3. `calculator_validation_error` → `calculator_validation_resolved` → complete result updated/viewed. Compare correction time and sessions leaving with unresolved errors.

For result-level analysis, join on `calculator_instance_id` plus `result_version`. Do not treat defaults, restored links, partial totals, empty forms, or invalid states as completions. P/W courses remain intentionally excluded and do not by themselves make a result partial.

No PostHog project settings, insights, dashboards, or other saved objects were changed. Production ingestion must be checked after deployment; local tests validate the event contract only.

## Browser validation — November 18, 2026

- Cumulative calculator: 28 behavior assertions passed, covering invalid/negative/zero GPA, missing and invalid credits, fractional credits, both modes, P/W, correction, removal, and reset.
- High school: 8 behavior assertions passed, including weighted AP calculation, new semesters, identical header/row tracks, equal credits, percentage mode, inherited new-course controls, removal, and reset.
- High-school layout checked at 320, 375, 640, 768, 931, 1024, and 1440 pixels. Desktop header/row tracks match exactly. Mobile fields are labeled and controls remain within the row.
- Home layout checked at 320, 375, 480, 640, 768, 931, 1024, and 1440 pixels. Checked individual controls against row bounds, not just document overflow. This caught and fixed clipped remove/name controls at 320 pixels. Mobile credit steppers now have 44-pixel targets.
- Manual input/click checks confirmed compact/full summaries, focus movement, cumulative correction navigation, light/dark appearance, native blur behavior, credit steppers, equal-credit/percentage modes, and share-link handling.
- Local event checks confirmed invalid → correction → complete → exposure, one-second compact/full exposure, duplicate suppression, reset suppression, partial-result classification, and stripped shared-link query data. No entered names appeared in custom properties.
- Production build and whitespace validation passed. Browser resizing does not verify a physical phone's OS keyboard or native input zoom.

## Pre-PR code review

The installed `review-agent` skill was used for a read-only review of the complete UX/tracking change before preparing the PR. Three P2 findings were reproduced and fixed:

- Guard optional `crypto.randomUUID()` so an HTTP phone preview or older browser cannot fail before creating calculator rows.
- Fall back to computed CSS visibility when `Element.checkVisibility()` is unavailable.
- Use the visual viewport's offset, width, and height, and listen for its scroll events, so keyboard panning/zooming cannot incorrectly classify full-result exposure.

Regression command: `node --test tools/tests/calculator-feedback.test.mjs` — 10 tests passed. These tests compile the actual controller and cover missing APIs, CSS-hidden results, offset/zoomed viewport boundaries, and the continuous one-second exposure threshold. No qualifying findings remain after these fixes. Production ingestion and physical-phone keyboard behavior remain unverified.
