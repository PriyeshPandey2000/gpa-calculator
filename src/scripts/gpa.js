/**
 * GPA Calculator — shared logic
 * All calculator pages import from here via <script> inline or module.
 */

// ─── Grade point maps ───────────────────────────────────────────────────────

/** Standard 4.0 letter grade points */
export const GRADE_POINTS = {
  'A+': 4.0,
  'A':  4.0,
  'A-': 3.7,
  'B+': 3.3,
  'B':  3.0,
  'B-': 2.7,
  'C+': 2.3,
  'C':  2.0,
  'C-': 1.7,
  'D+': 1.3,
  'D':  1.0,
  'D-': 0.7,
  'F':  0.0,
  'P':  null,  // Pass — excluded from GPA
  'NP': null,  // No Pass — excluded
  'W':  null,  // Withdrawal — excluded
  'I':  null,  // Incomplete — excluded
};

/** Weight bonuses by course type */
export const COURSE_WEIGHT = {
  'Regular': 0.0,
  'Honors':  0.5,
  'AP':      1.0,
  'IB':      1.0,
};

/** Convert percentage to letter grade */
export function percentToLetter(pct) {
  const p = parseFloat(pct);
  if (isNaN(p)) return '';
  if (p >= 97) return 'A+';
  if (p >= 93) return 'A';
  if (p >= 90) return 'A-';
  if (p >= 87) return 'B+';
  if (p >= 83) return 'B';
  if (p >= 80) return 'B-';
  if (p >= 77) return 'C+';
  if (p >= 73) return 'C';
  if (p >= 70) return 'C-';
  if (p >= 67) return 'D+';
  if (p >= 63) return 'D';
  if (p >= 60) return 'D-';
  return 'F';
}

/** Get grade points for a letter grade (null for excluded) */
export function getGradePoints(letter) {
  return GRADE_POINTS[letter] ?? null;
}

/** Get weighted grade points (adds course weight bonus, capped at 5.0 for 5.0 scale) */
export function getWeightedPoints(letter, courseType, scale = 4.0) {
  const base = getGradePoints(letter);
  if (base === null) return null;
  const bonus = COURSE_WEIGHT[courseType] ?? 0;
  return Math.min(base + bonus, scale);
}

// ─── Core calculation ────────────────────────────────────────────────────────

/**
 * Calculate GPA from array of course objects.
 * Each course: { grade, credits, courseType? }
 * Returns { gpa, totalCredits, totalQualityPoints } or null if no valid courses.
 */
export function calculateGPA(courses, weighted = false, scale = 4.0) {
  let totalQualityPoints = 0;
  let totalCredits = 0;

  for (const course of courses) {
    const credits = parseFloat(course.credits);
    if (!credits || credits <= 0) continue;

    let points;
    if (weighted && course.courseType) {
      points = getWeightedPoints(course.grade, course.courseType, scale);
    } else {
      points = getGradePoints(course.grade);
    }

    if (points === null) continue; // Pass/Fail, W, I — skip

    totalQualityPoints += points * credits;
    totalCredits += credits;
  }

  if (totalCredits === 0) return null;

  return {
    gpa: Math.round((totalQualityPoints / totalCredits) * 1000) / 1000,
    totalCredits,
    totalQualityPoints,
  };
}

/**
 * Calculate cumulative GPA by combining previous + new.
 */
export function calculateCumulativeGPA(prevGPA, prevCredits, newQualityPoints, newCredits) {
  const prev = parseFloat(prevGPA);
  const prevCr = parseFloat(prevCredits);
  const newCr = parseFloat(newCredits);

  if (isNaN(prev) || isNaN(prevCr) || prevCr < 0) return null;
  if (isNaN(newQualityPoints) || isNaN(newCr) || newCr <= 0) return null;

  const totalQP = (prev * prevCr) + newQualityPoints;
  const totalCr = prevCr + newCr;

  if (totalCr === 0) return null;

  return {
    gpa: Math.round((totalQP / totalCr) * 1000) / 1000,
    totalCredits: totalCr,
    totalQualityPoints: totalQP,
  };
}

/**
 * What-If: calculate new GPA after adding planned courses.
 */
export function calculateWhatIfGPA(currentGPA, currentCredits, plannedCourses) {
  const curGPA = parseFloat(currentGPA);
  const curCr = parseFloat(currentCredits);

  if (isNaN(curGPA) || isNaN(curCr) || curCr < 0) return null;

  const planned = calculateGPA(plannedCourses);
  if (!planned) return null;

  const existingQP = curGPA * curCr;
  const totalQP = existingQP + planned.totalQualityPoints;
  const totalCr = curCr + planned.totalCredits;

  if (totalCr === 0) return null;

  const newGPA = Math.round((totalQP / totalCr) * 1000) / 1000;

  return {
    newGPA,
    oldGPA: curGPA,
    change: Math.round((newGPA - curGPA) * 1000) / 1000,
    totalCredits: totalCr,
    plannedCredits: planned.totalCredits,
  };
}

// ─── Display helpers ─────────────────────────────────────────────────────────

/** Format GPA to 2 decimal places */
export function formatGPA(gpa) {
  if (gpa === null || gpa === undefined || isNaN(gpa)) return '—';
  return gpa.toFixed(2);
}

/** GPA color class: red < 2.0, yellow 2.0-2.9, green 3.0-3.49, blue 3.5+ */
export function gpaColorClass(gpa) {
  if (gpa === null || isNaN(gpa)) return 'gray';
  if (gpa < 2.0) return 'red';
  if (gpa < 3.0) return 'yellow';
  if (gpa < 3.5) return 'green';
  return 'blue';
}

/** Percentage for meter fill (0-100) */
export function gpaMeterPercent(gpa, scale = 4.0) {
  if (gpa === null || isNaN(gpa)) return 0;
  return Math.min(Math.max((gpa / scale) * 100, 0), 100);
}

/** Human label for GPA range */
export function gpaLabel(gpa) {
  if (gpa === null || isNaN(gpa)) return '';
  if (gpa >= 3.9) return 'Perfect / Summa Cum Laude';
  if (gpa >= 3.7) return 'Magna Cum Laude';
  if (gpa >= 3.5) return "Dean's List";
  if (gpa >= 3.0) return 'Good Standing';
  if (gpa >= 2.0) return 'Satisfactory';
  if (gpa >= 1.0) return 'Below Average';
  return 'Failing';
}

/** Proximity message — how close to next threshold */
export function gpaProximityMsg(gpa) {
  if (gpa === null || isNaN(gpa)) return '';
  const thresholds = [
    { val: 4.0, label: 'Perfect GPA' },
    { val: 3.9, label: 'Summa Cum Laude (3.9)' },
    { val: 3.7, label: 'Magna Cum Laude (3.7)' },
    { val: 3.5, label: "Dean's List (3.5)" },
    { val: 3.0, label: 'Good Standing (3.0)' },
    { val: 2.0, label: 'Passing (2.0)' },
  ];

  for (const t of thresholds) {
    if (gpa < t.val) {
      const diff = (t.val - gpa).toFixed(2);
      if (parseFloat(diff) <= 0.3) {
        return `${diff} away from ${t.label}`;
      }
    }
  }
  return '';
}

// ─── URL encoding for share feature ─────────────────────────────────────────

/** Encode GPA result into URL param */
export function encodeShareURL(data) {
  const encoded = btoa(JSON.stringify(data));
  const url = new URL(window.location.href);
  url.searchParams.set('result', encoded);
  return url.toString();
}

/** Decode GPA result from URL param */
export function decodeShareURL() {
  const url = new URL(window.location.href);
  const encoded = url.searchParams.get('result');
  if (!encoded) return null;
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

// ─── Grade dropdown options HTML ─────────────────────────────────────────────

export const GRADE_OPTIONS = [
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D+', 'D', 'D-',
  'F', 'P', 'W'
];

export function gradeOptionsHTML(selected = 'A') {
  return GRADE_OPTIONS.map(g =>
    `<option value="${g}"${g === selected ? ' selected' : ''}>${g}</option>`
  ).join('');
}

// ─── FAQ accordion init ──────────────────────────────────────────────────────

export function initFAQ() {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      // Close all
      document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
      // Toggle current
      if (!isOpen) item.classList.add('open');
    });
  });
}

// ─── GPA Meter update ────────────────────────────────────────────────────────

export function updateGPAMeter(gpa, scale = 4.0) {
  const fill = document.getElementById('gpa-meter-fill');
  const label = document.getElementById('gpa-label');
  const proximity = document.getElementById('gpa-proximity');
  const resultBadge = document.getElementById('gpa-result');

  if (!fill) return;

  const pct = gpaMeterPercent(gpa, scale);
  const color = gpaColorClass(gpa);
  const colorMap = {
    red: '#ee0000',
    yellow: '#f5a623',
    green: '#16a34a',
    blue: '#0070f3',
    gray: '#888888',
  };

  fill.style.width = pct + '%';
  fill.style.background = colorMap[color] || colorMap.gray;

  if (label) label.textContent = gpaLabel(gpa);
  if (proximity) proximity.textContent = gpaProximityMsg(gpa);
  if (resultBadge) {
    resultBadge.textContent = formatGPA(gpa);
    resultBadge.className = `tabular text-4xl font-bold transition-colors`;
    const textColors = { red: '#ee0000', yellow: '#f5a623', green: '#16a34a', blue: '#0070f3', gray: '#888' };
    resultBadge.style.color = textColors[color] || textColors.gray;
  }
}

// ─── Copy to clipboard ───────────────────────────────────────────────────────

export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}
