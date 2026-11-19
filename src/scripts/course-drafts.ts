interface CourseDraft { name: string; credits: string; letter: string; percent: string; type: string }
const creditSelector = 'input[type="number"]:not(.pct-input)';

export function readCourseDraft(row: HTMLElement): CourseDraft {
  return {
    name: row.querySelector<HTMLInputElement>('input[type="text"]')?.value ?? '',
    credits: row.querySelector<HTMLInputElement>(creditSelector)?.value ?? row.dataset.draftCredits ?? '3',
    letter: row.querySelector<HTMLSelectElement>('.grade-select')?.value ?? row.dataset.draftLetter ?? '',
    percent: row.querySelector<HTMLInputElement>('.pct-input')?.value ?? row.dataset.draftPercent ?? '',
    type: row.querySelector<HTMLSelectElement>('.course-type')?.value ?? 'Regular',
  };
}

export function restoreCourseDraft(row: HTMLElement, draft: CourseDraft) {
  row.dataset.draftCredits = draft.credits;
  row.dataset.draftLetter = draft.letter;
  row.dataset.draftPercent = draft.percent;
  const set = (selector: string, value: string) => {
    const input = row.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    if (input) input.value = value;
  };
  set('input[type="text"]', draft.name);
  set(creditSelector, draft.credits);
  set('.grade-select', draft.letter);
  set('.pct-input', draft.percent);
  set('.course-type', draft.type);
}

export function resetSettings(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>('[data-calculator-setting] input[value="off"]').forEach(input => { input.checked = true; });
}

export function decorateCourseRow(row: HTMLElement) {
  row.classList.add('calc-course-row');
  const field = (input: Element | null, className: string, caption?: string) => {
    if (!input) return;
    let wrapper = input.parentElement!;
    if (wrapper === row && caption) {
      wrapper = document.createElement('div');
      input.before(wrapper);
      wrapper.append(input);
    }
    if (wrapper === row) input.classList.add(className);
    else {
      wrapper.classList.add(className);
      if (caption && !wrapper.querySelector('.course-field-caption, label')) {
        const label = document.createElement('span');
        label.className = 'course-field-caption';
        label.textContent = caption;
        label.setAttribute('aria-hidden', 'true');
        wrapper.prepend(label);
      }
    }
  };
  const name = row.querySelector('input[type="text"]');
  name?.setAttribute('aria-label', 'Course name (optional)');
  field(name, 'calc-name-field');
  const grade = row.querySelector('.grade-select, .pct-input');
  grade?.setAttribute('aria-label', grade.matches('.pct-input') ? 'Grade percentage' : 'Letter grade');
  field(grade, 'calc-grade-field', grade?.matches('.pct-input') ? 'Grade (%)' : 'Grade');
  const credits = row.querySelector(creditSelector);
  credits?.setAttribute('aria-label', 'Credit hours');
  field(credits, 'calc-credit-field', 'Credits');
  if (credits instanceof HTMLInputElement && !credits.closest('.calc-credit-control')) {
    const control = document.createElement('div');
    control.className = 'calc-credit-control';
    credits.before(control);
    const stepper = (direction: number) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'calc-credit-step';
      button.textContent = direction < 0 ? '−' : '+';
      button.setAttribute('aria-label', direction < 0 ? 'Decrease credit hours' : 'Increase credit hours');
      button.addEventListener('click', () => {
        const min = Number(credits.min || '0');
        const max = credits.max ? Number(credits.max) : 999;
        const step = Number(credits.step || '1');
        const current = Number.isFinite(credits.valueAsNumber) ? credits.valueAsNumber : 0;
        credits.value = String(Math.min(max, Math.max(min, Math.round((current + direction * step) * 100) / 100)));
        credits.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return button;
    };
    control.append(stepper(-1), credits, stepper(1));
  }
  field(row.querySelector('.course-type'), 'calc-type-field', 'Course type');
  const remove = [...row.querySelectorAll('button')].find(button => !button.classList.contains('calc-credit-step'));
  remove?.setAttribute('aria-label', 'Remove course');
  remove?.classList.remove('btn-danger');
  remove?.classList.add('btn-secondary');
  if (remove) (remove.parentElement === row ? remove : remove.parentElement!).classList.add('calc-remove-field');
}
