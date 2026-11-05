import { PNG } from 'pngjs';

export interface VisualOptions {
  /** Per-channel difference (0-255) below which two pixels count as equal: absorbs anti-aliasing and font smoothing. */
  channelTolerance?: number;
  /** Image is split into square cells; a cell is "significant" only if this share of its pixels changed. */
  cellSize?: number;
  cellFloor?: number;
  /** Fail when more than this many cells are significant. */
  maxSignificantCells?: number;
}

export interface VisualResult {
  ok: boolean;
  sizeMismatch: boolean;
  changedPixels: number;
  changedRatio: number;
  significantCells: number;
  totalCells: number;
  /** Bounding box of significant cells, for a human to look at. */
  box?: { x: number; y: number; w: number; h: number };
}

export function decodePng(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

/** Compare two screenshots by measurement. Returns a verdict plus numbers, never just "looks fine". */
export function compareImages(a: PNG, b: PNG, o: VisualOptions = {}): VisualResult {
  const tol = o.channelTolerance ?? 24;
  const cell = o.cellSize ?? 24;
  const floor = o.cellFloor ?? 0.03;
  const maxCells = o.maxSignificantCells ?? 0;
  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, sizeMismatch: true, changedPixels: 0, changedRatio: 1, significantCells: 0, totalCells: 0 };
  }
  const cols = Math.ceil(a.width / cell);
  const rows = Math.ceil(a.height / cell);
  const changedPerCell = new Uint32Array(cols * rows);
  let changed = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i]! - b.data[i]!), Math.abs(a.data[i + 1]! - b.data[i + 1]!), Math.abs(a.data[i + 2]! - b.data[i + 2]!), Math.abs(a.data[i + 3]! - b.data[i + 3]!));
      if (d > tol) {
        changed++;
        changedPerCell[Math.floor(y / cell) * cols + Math.floor(x / cell)]!++;
      }
    }
  }
  let significant = 0;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const w = Math.min(cell, a.width - c * cell);
      const h = Math.min(cell, a.height - r * cell);
      if (changedPerCell[r * cols + c]! / (w * h) > floor) {
        significant++;
        minX = Math.min(minX, c * cell); minY = Math.min(minY, r * cell);
        maxX = Math.max(maxX, c * cell + w); maxY = Math.max(maxY, r * cell + h);
      }
    }
  }
  return {
    ok: significant <= maxCells,
    sizeMismatch: false,
    changedPixels: changed,
    changedRatio: changed / (a.width * a.height),
    significantCells: significant,
    totalCells: cols * rows,
    box: significant ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : undefined,
  };
}
