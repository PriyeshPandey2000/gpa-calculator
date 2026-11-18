type ValidationIssue = { key: string; field: 'gpa' | 'credits' | 'percentage'; reason: 'missing' | 'out_of_range' };
type ResultState = {
  validity: 'complete' | 'partial' | 'invalid' | 'empty';
  mode: string;
  primary: string;
  secondary?: string;
  // Used only in memory to identify edits. Never sent to analytics.
  signature: string;
  includedRows: number;
  excludedRows: number;
  issues?: ValidationIssue[];
};

/** One controller per calculator; defaults/restoration never enter the funnel. */
export function createCalculatorFeedback({ root, calculator, result, numbers }: {
  root: HTMLElement;
  calculator: string;
  result: HTMLElement;
  numbers: HTMLElement[];
}) {
  const summary = root.querySelector<HTMLElement>('[data-calculator-summary]')!;
  const primary = summary.querySelector<HTMLElement>('[data-summary-primary]')!;
  const secondary = summary.querySelector<HTMLElement>('[data-summary-secondary]')!;
  const link = summary.querySelector<HTMLAnchorElement>('[data-summary-link]')!;
  const narrow = matchMedia('(max-width: 1023px)');
  // This is a correlation ID, not a security token. HTTP previews and older
  // browsers may lack randomUUID; analytics must not prevent initialization.
  const instanceId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let state: ResultState | undefined;
  let intentional = false;
  let startedAt = 0;
  let dirty = false;
  let revision = 0;
  let trackable = false;
  let committedSignature = '';
  let pending: ReturnType<typeof setTimeout> | undefined;
  const visibleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const viewed = new Set<string>();
  const errors = new Map<string, { issue: ValidationIssue; since: number; mode: string }>();

  function capture(event: string, extra: Record<string, string | number> = {}) {
    const properties = {
      calculator_type: calculator,
      calculator_instance_id: instanceId,
      entry_mode: state?.mode || 'unknown',
      viewport_bucket: narrow.matches ? 'narrow' : 'wide',
      schema_version: 1,
      ...extra,
      // Shared URLs may contain course names. These events use the clean path.
      $current_url: `${location.origin}${location.pathname}`,
      $referrer: document.referrer ? document.referrer.split(/[?#]/)[0] : '',
    };
    if (import.meta.env.DEV) {
      window.dispatchEvent(new CustomEvent('calculator:analytics', { detail: { event, properties } }));
    }
    // Local/preview checks must not create production analytics events.
    if (location.hostname !== 'gpacalculatorfree.com' && location.hostname !== 'www.gpacalculatorfree.com') return;
    try {
      (window as Window & { posthog?: { capture: (event: string, properties: object) => void } }).posthog?.capture(event, properties);
    } catch { /* Analytics must never interrupt a calculation. */ }
  }

  function clearViewTimers() {
    visibleTimers.forEach(clearTimeout);
    visibleTimers.clear();
  }

  function fullyVisible(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom || 0;
    const summaryBottom = !summary.hidden && narrow.matches ? summary.getBoundingClientRect().bottom : 0;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const left = viewport?.offsetLeft || 0;
    const visible = typeof el.checkVisibility === 'function' ? el.checkVisibility() : getComputedStyle(el).visibility === 'visible';
    return visible && rect.width > 0 && rect.height > 0 &&
      rect.top >= Math.max(top, headerBottom, el === primary ? 0 : summaryBottom) &&
      rect.bottom <= top + (viewport?.height || innerHeight) &&
      rect.left >= left && rect.right <= left + (viewport?.width || innerWidth);
  }

  function inspectVisibility() {
    if (!state) return;
    const fullVisible = numbers.every(fullyVisible);
    const available = state.validity !== 'empty';
    // Keep a stable summary while editing; hide it when the full result is visible.
    summary.hidden = !narrow.matches || !available || fullVisible;
    if (document.hidden || !intentional || dirty || state.validity !== 'complete' || !trackable) {
      clearViewTimers();
      return;
    }
    const surfaces = { full: fullVisible, compact: !summary.hidden && fullyVisible(primary) };
    for (const [surface, visible] of Object.entries(surfaces)) {
      const key = `${revision}:${surface}`;
      if (!visible) {
        clearTimeout(visibleTimers.get(surface));
        visibleTimers.delete(surface);
      } else if (!viewed.has(key) && !visibleTimers.has(surface)) {
        visibleTimers.set(surface, setTimeout(() => {
          visibleTimers.delete(surface);
          if (document.hidden || dirty || state?.validity !== 'complete') return;
          const stillVisible = surface === 'full' ? numbers.every(fullyVisible) : !summary.hidden && fullyVisible(primary);
          if (!stillVisible) return;
          viewed.add(key);
          capture('calculator_result_viewed', { result_version: revision, surface, visibility_ms: 1000, ms_since_start: Math.round(performance.now() - startedAt) });
        }, 1000));
      }
    }
  }

  function commit() {
    if (!state || !intentional || !dirty) return;
    dirty = false;
    const nextIssues = new Map((state.issues || []).map(issue => [issue.key, issue]));
    // Switching modes or deleting a row is not a correction of that field.
    for (const [key, previous] of errors) {
      if (!nextIssues.has(key)) {
        const field = document.getElementById(key);
        const value = field instanceof HTMLInputElement ? field.valueAsNumber : NaN;
        const inRange = previous.issue.field === 'gpa' ? value >= 0 && value <= 4
          : previous.issue.field === 'percentage' ? value >= 0 && value <= 100
          : key === 'prev-credits' ? value >= 0 : value > 0;
        if (previous.mode === state.mode && field?.isConnected && field instanceof HTMLInputElement && field.value !== '' && Number.isFinite(value) && inRange) {
          capture('calculator_validation_resolved', { field_category: previous.issue.field, reason_code: previous.issue.reason, correction_ms: Math.round(performance.now() - previous.since) });
        }
        errors.delete(key);
      }
    }
    for (const [key, issue] of nextIssues) {
      const previous = errors.get(key);
      if (!previous || previous.issue.reason !== issue.reason) {
        errors.set(key, { issue, since: performance.now(), mode: state.mode });
        capture('calculator_validation_error', { field_category: issue.field, reason_code: issue.reason, excluded_row_count: state.excludedRows });
      }
    }
    if (state.signature !== committedSignature) {
      committedSignature = state.signature;
      revision++;
      trackable = true;
      viewed.clear();
      capture('calculator_result_updated', { result_version: revision, validity: state.validity, included_row_count: state.includedRows, excluded_row_count: state.excludedRows, ms_since_start: Math.round(performance.now() - startedAt) });
    }
    inspectVisibility();
  }

  function markIntent(event: Event) {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const input = event.target.closest('input, select, button');
    if (!input || input.matches('input[type="text"], [data-summary-link]')) return;
    if (event.type === 'click' && !input.matches('.credits-step, [data-remove-sem], [data-remove-course], .remove-course-btn, #add-course-btn, #add-semester-btn, [aria-label="Add course to this semester"], [aria-label^="Remove course"], [aria-label="Remove this semester"], [role="tab"]')) return;
    if (event.type === 'keydown' && (!(event instanceof KeyboardEvent) || !input.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight'].includes(event.key))) return;
    if (!intentional) {
      // Opening a mode or adding default rows is not a calculation attempt.
      if (!input.matches('input[type="number"], select, .credits-step')) return;
      intentional = true;
      startedAt = performance.now();
      capture('calculator_started');
    }
    dirty = true;
    clearViewTimers();
    // Native number fields also emit change on blur. That event may not trigger
    // a recalculation, but must still settle so it cannot suspend view tracking.
    clearTimeout(pending);
    pending = setTimeout(commit, 450);
  }
  for (const type of ['input', 'change', 'click', 'keydown']) root.addEventListener(type, markIntent, true);

  link.addEventListener('click', event => {
    event.preventDefault();
    if (state?.validity === 'invalid') {
      root.querySelector<HTMLButtonElement>('#review-field-btn')?.click();
      return;
    }
    result.focus({ preventScroll: true });
    result.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  let frame = 0;
  function scheduleVisibility() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; inspectVisibility(); });
  }
  addEventListener('scroll', scheduleVisibility, { passive: true });
  addEventListener('resize', scheduleVisibility);
  document.addEventListener('visibilitychange', inspectVisibility);
  window.visualViewport?.addEventListener('resize', scheduleVisibility);
  window.visualViewport?.addEventListener('scroll', scheduleVisibility);
  const observer = new IntersectionObserver(scheduleVisibility, { threshold: [0, 1] });
  [...numbers, primary].forEach(el => observer.observe(el));

  return {
    update(next: ResultState) {
      if (state?.signature !== next.signature) clearViewTimers();
      state = next;
      primary.textContent = next.primary;
      secondary.textContent = next.secondary || '';
      secondary.hidden = !next.secondary;
      link.textContent = next.validity === 'invalid' ? 'Check entries ↑' : 'View result ↓';
      clearTimeout(pending);
      if (dirty) pending = setTimeout(commit, 450);
      scheduleVisibility();
    },
    reset() {
      clearTimeout(pending);
      clearViewTimers();
      errors.clear();
      dirty = false;
      committedSignature = '';
      trackable = false;
      viewed.clear();
      summary.hidden = true;
    },
  };
}
