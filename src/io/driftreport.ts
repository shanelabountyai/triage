// drift:report over two run directories and the override log: the eight signals and which fired.
import { driftSignals, windowStats, type SignalValue, type WindowStats } from '../pipeline/drift.js';
import { loadPolicyData } from './load.js';
import { isOverridden, readOverrides, DEFAULT_OVERRIDES } from './overrides.js';
import { readRunDir } from './run.js';

export interface DriftReport { baseline: string; window: string; stats: { baseline: WindowStats; window: WindowStats }; signals: SignalValue[] }

export function driftReport(baselineDir: string, windowDir: string, overridesPath = DEFAULT_OVERRIDES, root = '.'): DriftReport {
  const { data } = loadPolicyData(root);
  const overrides = readOverrides(overridesPath);
  const stats = (dir: string) => {
    const { row, decisions } = readRunDir(dir);
    return { id: row.run_id, s: windowStats(data.policy, decisions.map((d) => ({ ...d, overridden: d.human_touched && isOverridden(d, overrides) })), row.threshold_bps) };
  };
  const b = stats(baselineDir), w = stats(windowDir);
  return { baseline: b.id, window: w.id, stats: { baseline: b.s, window: w.s }, signals: driftSignals(data.drift, b.s, w.s) };
}

/** The table as the reference output prints it (fixtures/samples/reference_pipeline.output.txt). */
export function signalTable(signals: readonly SignalValue[]): string[] {
  return [
    '  signal                              value     threshold  fired',
    ...signals.map((s) => `  ${s.id.padEnd(34)} ${String(s.value_bps).padStart(6)} bps  ${String(s.threshold_bps).padStart(6)} bps  ${s.fired ? 'YES' : 'no'}`),
    '  (a distance of 1000 bps means 10% of the mix moved; a delta of 500 bps means the rate rose 5 points)',
  ];
}
