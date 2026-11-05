/**
 * Compare a screenshot with an approved baseline by measurement.
 *   tsx scripts/visual-compare.ts <baseline.png> <current.png> [--update]
 * Exit 0 = same within tolerance, 1 = changed (prints counts and the changed box), 2 = usage/size error.
 * --update replaces the baseline with the current image (a human decision: review the diff first).
 * Baselines depend on fonts and rendering, so treat them as per-environment unless CI renders them too.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { compareImages, decodePng } from '@vk/guards';

const [baseline, current, flag] = process.argv.slice(2);
if (!baseline || !current) {
  console.error('usage: visual-compare <baseline.png> <current.png> [--update]');
  process.exit(2);
}
if (flag === '--update' || !existsSync(baseline)) {
  copyFileSync(current, baseline);
  console.log(`baseline ${existsSync(baseline) && flag !== '--update' ? 'created' : 'updated'}: ${baseline}`);
  process.exit(0);
}
const r = compareImages(decodePng(readFileSync(baseline)), decodePng(readFileSync(current)));
console.log(JSON.stringify(r));
if (r.sizeMismatch) console.error('image size differs from the baseline');
else if (!r.ok) console.error(`VISUAL CHANGE: ${r.significantCells}/${r.totalCells} regions changed, box ${JSON.stringify(r.box)}`);
process.exit(r.ok ? 0 : r.sizeMismatch ? 2 : 1);
