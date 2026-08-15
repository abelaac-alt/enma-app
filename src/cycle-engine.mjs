const DAY_MS = 86_400_000;

export function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function daysBetween(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY_MS);
}

export function normalizePeriods(periods = []) {
  return [...periods]
    .filter((p) => p?.start_date)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

export function cycleLengths(periods = []) {
  const sorted = normalizePeriods(periods);
  const lengths = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = parseDate(sorted[i - 1].start_date);
    const current = parseDate(sorted[i].start_date);
    const days = daysBetween(previous, current);
    if (days > 0 && days < 120) lengths.push(days);
  }
  return lengths;
}

export function estimatedCycleLength(periods = [], fallback = 28) {
  const recent = cycleLengths(periods).slice(-6);
  if (!recent.length) return clampInt(fallback, 15, 60, 28);
  return Math.round(recent.reduce((sum, n) => sum + n, 0) / recent.length);
}

export function periodDuration(period) {
  if (!period?.start_date) return null;
  if (!period.end_date) return 1;
  const start = parseDate(period.start_date);
  const end = parseDate(period.end_date);
  const value = daysBetween(start, end) + 1;
  return value > 0 ? value : 1;
}

export function resolveCycleMode(periods = [], settings = {}) {
  if (settings.cycle_mode === 'regular' || settings.cycle_mode === 'irregular') {
    return settings.cycle_mode;
  }
  const lengths = cycleLengths(periods).slice(-6);
  if (lengths.length < 3) return 'learning';
  return Math.max(...lengths) - Math.min(...lengths) > 7 ? 'irregular' : 'regular';
}

export function getNextPeriod(periods = [], settings = {}, today = new Date()) {
  const sorted = normalizePeriods(periods);
  if (!sorted.length) return null;
  const last = parseDate(sorted.at(-1).start_date);
  const cycleDays = estimatedCycleLength(sorted, settings.default_cycle_length || 28);
  const predicted = addDays(last, cycleDays);
  const daysRemaining = daysBetween(today, predicted);
  return {
    date: toISODate(predicted),
    dateObject: predicted,
    daysRemaining,
    cycleDays,
    overdueDays: daysRemaining < 0 ? Math.abs(daysRemaining) : 0
  };
}

export function getIrregularities(periods = [], settings = {}, today = new Date()) {
  const sorted = normalizePeriods(periods);
  const lengths = cycleLengths(sorted);
  const issues = [];

  if (lengths.length >= 3) {
    const recent = lengths.slice(-6);
    const avg = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
    recent.forEach((length, index) => {
      if (Math.abs(length - avg) > 7) {
        issues.push({
          type: 'cycle-variation',
          severity: 'info',
          message: `Un ciclo reciente duró ${length} días, ${Math.abs(length - avg)} días de diferencia respecto a tu media reciente (${avg}).`,
          key: `cycle-${index}-${length}`
        });
      }
    });
  }

  const configuredPeriod = clampInt(settings.typical_period_days, 1, 15, 5);
  sorted.slice(-6).forEach((period, index) => {
    const duration = periodDuration(period);
    if (duration && Math.abs(duration - configuredPeriod) > 2) {
      issues.push({
        type: 'period-duration',
        severity: 'info',
        message: `Un periodo reciente duró ${duration} días frente a los ${configuredPeriod} días que tienes configurados como habituales.`,
        key: `duration-${index}-${duration}`
      });
    }
  });

  const next = getNextPeriod(sorted, settings, today);
  if (next && next.overdueDays > 7) {
    issues.push({
      type: 'late-estimate',
      severity: 'attention',
      message: `Han pasado ${next.overdueDays} días desde la fecha estimada. La predicción puede variar y no confirma por sí sola ninguna alteración.`,
      key: 'late-estimate'
    });
  }

  return dedupe(issues).slice(0, 8);
}

export function monthCells(year, monthIndex, periods = [], settings = {}, today = new Date()) {
  const first = new Date(year, monthIndex, 1, 12);
  const mondayIndex = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayIndex);
  const windows = buildWindows(year, periods, settings, today);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    const iso = toISODate(date);
    const match = windows.find((w) => iso >= w.start && iso <= w.end);
    return {
      date: iso,
      day: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      isToday: toISODate(today) === iso,
      periodType: match?.type || null
    };
  });
}

export function yearMonths(year, periods = [], settings = {}, today = new Date()) {
  return Array.from({ length: 12 }, (_, month) => ({
    month,
    cells: monthCells(year, month, periods, settings, today)
  }));
}

export function buildWindows(year, periods = [], settings = {}, today = new Date()) {
  const sorted = normalizePeriods(periods);
  const periodDays = clampInt(settings.typical_period_days, 1, 15, 5);
  const windows = [];

  sorted.forEach((p) => {
    const start = parseDate(p.start_date);
    if (!start) return;
    const actualDays = periodDuration(p) || periodDays;
    const end = addDays(start, actualDays - 1);
    if (start.getFullYear() === year || end.getFullYear() === year) {
      windows.push({ start: toISODate(start), end: toISODate(end), type: 'recorded' });
    }
  });

  if (!sorted.length) return windows;
  const cycleDays = estimatedCycleLength(sorted, settings.default_cycle_length || 28);
  let cursor = addDays(parseDate(sorted.at(-1).start_date), cycleDays);
  const endOfYear = new Date(year, 11, 31, 12);
  const max = new Date(Math.max(endOfYear.getTime(), addDays(today, 550).getTime()));
  let guard = 0;

  while (cursor <= max && guard < 48) {
    const end = addDays(cursor, periodDays - 1);
    if (cursor.getFullYear() === year || end.getFullYear() === year) {
      windows.push({ start: toISODate(cursor), end: toISODate(end), type: 'predicted' });
    }
    cursor = addDays(cursor, cycleDays);
    guard += 1;
  }
  return windows;
}

export function formatDateEs(iso, options = {}) {
  if (!iso) return '—';
  const date = parseDate(iso);
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: options.short ? 'short' : 'long',
    year: options.year === false ? undefined : 'numeric'
  }).format(date);
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.message)) return false;
    seen.add(item.message);
    return true;
  });
}
