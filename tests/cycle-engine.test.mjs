import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleLengths,
  estimatedCycleLength,
  getNextPeriod,
  resolveCycleMode,
  buildWindows,
  parseDate,
  daysBetween
} from '../src/cycle-engine.mjs';

const periods = [
  { start_date: '2026-01-01', end_date: '2026-01-05' },
  { start_date: '2026-01-29', end_date: '2026-02-02' },
  { start_date: '2026-02-26', end_date: '2026-03-02' },
  { start_date: '2026-03-26', end_date: '2026-03-30' }
];

test('calcula longitudes del ciclo', () => {
  assert.deepEqual(cycleLengths(periods), [28, 28, 28]);
});

test('estima el siguiente periodo desde el último inicio', () => {
  const next = getNextPeriod(periods, { default_cycle_length: 30 }, parseDate('2026-04-10'));
  assert.equal(next.date, '2026-04-23');
  assert.equal(next.daysRemaining, 13);
});



test('si una estimación ya pasó, calcula el siguiente periodo futuro con la media histórica', () => {
  const historial = [
    { start_date: '2026-04-05', end_date: '2026-04-09' },
    { start_date: '2026-05-04', end_date: '2026-05-08' },
    { start_date: '2026-06-02', end_date: '2026-06-06' },
    { start_date: '2026-07-01', end_date: '2026-07-05' }
  ];
  const next = getNextPeriod(historial, { default_cycle_length: 28 }, parseDate('2026-08-15'));
  assert.equal(next.cycleDays, 29);
  assert.equal(next.date, '2026-08-28');
  assert.equal(next.daysRemaining, 13);
  assert.equal(next.projectedCycles, 2);
});

test('detecta patrón regular en automático', () => {
  assert.equal(resolveCycleMode(periods, { cycle_mode: 'auto' }), 'regular');
});

test('respeta el modo manual irregular', () => {
  assert.equal(resolveCycleMode(periods, { cycle_mode: 'irregular' }), 'irregular');
});

test('genera ventanas previstas del año', () => {
  const windows = buildWindows(2026, periods, { typical_period_days: 5, default_cycle_length: 28 }, parseDate('2026-04-01'));
  assert.ok(windows.some((w) => w.type === 'predicted' && w.start === '2026-04-23'));
});

test('diferencia de días no cambia por horario de verano', () => {
  assert.equal(daysBetween(parseDate('2026-03-28'), parseDate('2026-03-30')), 2);
});
