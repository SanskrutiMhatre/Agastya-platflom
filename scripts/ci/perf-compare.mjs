// WP-20 (QA-013; audit 11 section 10.5): the comparison rule of the performance probes, kept apart so it is unit-tested
// (scripts/ci/perf-compare.test.mjs). A run is compared, metric by metric, with the MEDIAN of the last `window` comparable runs (same probe
// size, same machine): +alert % or more is an ALERT, +fail % or more is a FAIL. With fewer than `minRuns` earlier runs there is no verdict yet
// (the baseline is being built: budgets come from measurements, never from guesses). Lower is better for every metric (times, memory).

export const DEFAULTS = { window: 5, minRuns: 3, alertPct: 25, failPct: 40, floorMs: 50 };

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** The metrics of one probe result: every number under `steps` plus peakRssMB. */
export function metricsOf(result) {
  const out = {};
  for (const [k, v] of Object.entries(result.steps ?? {})) if (typeof v === 'number') out[k] = v;
  if (typeof result.peakRssMB === 'number') out.peakRssMB = result.peakRssMB;
  return out;
}

/**
 * history: earlier entries [{ key, metrics }], oldest first; run: { key, metrics }.
 * Returns { verdict: 'BASELINE'|'OK'|'ALERT'|'FAIL', rows: [{ metric, value, median, pct, status }] }.
 * Times below floorMs are not judged (a 20 ms step that becomes 30 ms is noise, not a +50 % regression).
 */
export function compare(history, run, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const same = history.filter((h) => h.key === run.key).slice(-o.window);
  if (same.length < o.minRuns) return { verdict: 'BASELINE', previous: same.length, rows: Object.entries(run.metrics).map(([metric, value]) => ({ metric, value, median: null, pct: null, status: 'baseline' })) };
  const rows = [];
  for (const [metric, value] of Object.entries(run.metrics)) {
    const prev = same.map((h) => h.metrics[metric]).filter((v) => typeof v === 'number');
    if (prev.length < o.minRuns) { rows.push({ metric, value, median: null, pct: null, status: 'new' }); continue; }
    const m = median(prev);
    const pct = m > 0 ? ((value - m) / m) * 100 : 0;
    const tiny = /Ms$/.test(metric) && Math.max(value, m) < o.floorMs;
    const status = tiny ? 'ok' : pct >= o.failPct ? 'FAIL' : pct >= o.alertPct ? 'ALERT' : 'ok';
    rows.push({ metric, value, median: m, pct: Math.round(pct * 10) / 10, status });
  }
  const verdict = rows.some((r) => r.status === 'FAIL') ? 'FAIL' : rows.some((r) => r.status === 'ALERT') ? 'ALERT' : 'OK';
  return { verdict, previous: same.length, rows };
}
