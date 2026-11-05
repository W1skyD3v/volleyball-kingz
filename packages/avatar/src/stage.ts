import { FLOOR_Y, RIM_X, RIM_Y, SPRITE_K, STAGE_H, STAGE_W, type StageFrame } from './choreo.js';
import { renderAvatarSvg, type AvatarConfig, type WornVariants } from './index.js';

/** Vector scenery for the replay and the live court strip. All generated in code: no image files, nothing to license. */
const open = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const SHIRTS = ['#3b4a6b', '#6b3b4a', '#3b6b55', '#6b5a3b', '#55416b', '#4a4a55', '#2f5f7a', '#7a4a2f'];
const SKINS = ['#f6d3b5', '#eab98f', '#d39a6a', '#b9774a', '#8d5a38', '#5b3a24'];

/** One row of the crowd. Row 0 is the back row (smallest), row 2 the front. Drawn once, bounced by the viewer. */
export function crowdRowSvg(row: number, seed: string, showArms = false): string {
  const r = rng(hash(`${seed}:${row}`));
  const scale = [0.8, 1, 1.2][row] ?? 1;
  const y = [236, 266, 298][row] ?? 266;
  const n = [30, 26, 22][row] ?? 24;
  let out = open(STAGE_W, STAGE_H);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.3 + r() * 0.4) * (STAGE_W / n);
    const shirt = SHIRTS[Math.floor(r() * SHIRTS.length)]!;
    const skin = SKINS[Math.floor(r() * SKINS.length)]!;
    const s = scale * (0.9 + r() * 0.2);
    const armUp = showArms && r() < 0.6;
    out +=
      `<g transform="translate(${x.toFixed(1)} ${y}) scale(${s.toFixed(2)})">` +
      (armUp ? `<path d="M-13 -4 L-20 -30 M13 -4 L20 -30" stroke="${skin}" stroke-width="6" stroke-linecap="round"/>` : '') +
      `<path d="M-17 22 Q-17 -4 0 -4 Q17 -4 17 22 Z" fill="${shirt}"/><circle cx="0" cy="-14" r="9" fill="${skin}"/>` +
      (r() < 0.45 ? `<path d="M-9 -16 Q0 -30 9 -16 Z" fill="${r() < 0.5 ? '#141414' : '#6b4429'}"/>` : '') +
      `</g>`;
  }
  return out + '</svg>';
}

/** Arena, stands, hardwood and court lines. Static. */
export function courtSvg(): string {
  const y0 = 318; // far edge of the floor
  const line = 'stroke="#f5f3ee" stroke-opacity="0.55" stroke-width="2" fill="none"';
  let out = open(STAGE_W, STAGE_H);
  out +=
    `<defs><linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0b10"/><stop offset="1" stop-color="#1b1b27"/></linearGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9793a"/><stop offset="1" stop-color="#d9a05a"/></linearGradient>` +
    `<radialGradient id="spot" cx="0.5" cy="0.2" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${STAGE_W}" height="${STAGE_H}" fill="url(#wall)"/>` +
    // stands: tiered steps
    [0, 1, 2].map((i) => `<rect x="0" y="${200 + i * 32}" width="${STAGE_W}" height="34" fill="${['#15151e', '#1a1a26', '#20202e'][i]}"/>`).join('') +
    `<rect x="0" y="${y0 - 10}" width="${STAGE_W}" height="12" fill="#2a2a3a"/>` +
    `<text x="${STAGE_W / 2}" y="${y0 - 1}" font-size="9" font-family="Barlow Condensed,Arial Narrow,Arial,sans-serif" font-weight="800" letter-spacing="6" text-anchor="middle" fill="#f5b301" opacity="0.8">BASKETBALL KINGZ</text>` +
    `<rect x="0" y="${y0}" width="${STAGE_W}" height="${STAGE_H - y0}" fill="url(#floor)"/>` +
    // planks
    Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${y0 + 8 + i * 9}" x2="${STAGE_W}" y2="${y0 + 8 + i * 9}" stroke="#7a4a1f" stroke-opacity="0.18"/>`).join('') +
    // lines in a flattened perspective
    `<rect x="40" y="${y0 + 6}" width="${STAGE_W - 80}" height="${STAGE_H - y0 - 14}" ${line}/>` +
    `<line x1="${STAGE_W / 2}" y1="${y0 + 6}" x2="${STAGE_W / 2}" y2="${STAGE_H - 8}" ${line}/>` +
    `<ellipse cx="${STAGE_W / 2}" cy="${(y0 + STAGE_H) / 2}" rx="56" ry="14" ${line}/>` +
    // keys and three-point arcs at both ends
    `<rect x="40" y="${y0 + 18}" width="110" height="${STAGE_H - y0 - 38}" ${line}/><rect x="${STAGE_W - 150}" y="${y0 + 18}" width="110" height="${STAGE_H - y0 - 38}" ${line}/>` +
    `<path d="M40 ${y0 + 10} Q250 ${(y0 + STAGE_H) / 2} 40 ${STAGE_H - 12}" ${line}/><path d="M${STAGE_W - 40} ${y0 + 10} Q${STAGE_W - 250} ${(y0 + STAGE_H) / 2} ${STAGE_W - 40} ${STAGE_H - 12}" ${line}/>` +
    `<rect width="${STAGE_W}" height="${STAGE_H}" fill="url(#spot)"/>`;
  return out + '</svg>';
}

/** Hoops, backboards and nets. The viewer redraws these per frame so the net can shake when a shot goes in. */
export function hoopsSvg(frame: Pick<StageFrame, 'hoop'>): string {
  let out = open(STAGE_W, STAGE_H);
  (['L', 'R'] as const).forEach((side) => {
    const x = RIM_X[side];
    const dir = side === 'L' ? -1 : 1; // backboard sits behind the rim, toward the baseline
    const bx = x + dir * 28;
    const shake = frame.hoop.side === side ? frame.hoop.shake : 0;
    out +=
      `<rect x="${bx - 3}" y="${RIM_Y - 62}" width="6" height="70" rx="2" fill="#e8e6f0"/>` +
      `<rect x="${bx - 3 + dir * 6}" y="${RIM_Y - 30}" width="4" height="${FLOOR_Y - RIM_Y + 28}" fill="#3a3a4a"/>` +
      `<g transform="translate(${(shake * 5).toFixed(2)} 0) skewX(${(shake * 5).toFixed(2)})">` +
      `<ellipse cx="${x}" cy="${RIM_Y}" rx="24" ry="5" fill="none" stroke="#ef6a1a" stroke-width="4"/>` +
      `<path d="M${x - 22} ${RIM_Y + 2} L${x - 14} ${RIM_Y + 40} M${x - 8} ${RIM_Y + 5} L${x - 6} ${RIM_Y + 42} M${x + 8} ${RIM_Y + 5} L${x + 6} ${RIM_Y + 42} M${x + 22} ${RIM_Y + 2} L${x + 14} ${RIM_Y + 40} M${x - 17} ${RIM_Y + 20} L${x + 17} ${RIM_Y + 20}" stroke="#f5f3ee" stroke-opacity="0.75" stroke-width="1.6" fill="none"/></g>`;
  });
  return out + '</svg>';
}

export interface Appearance {
  config: AvatarConfig;
  worn: WornVariants;
}

function inner(svg: string): string {
  return svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

export const ballSvg = (x: number, y: number, color = '#f97316') =>
  `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="11" fill="${color}" stroke="#7a2e00" stroke-width="1.5"/><path d="M-11 0 H11 M0 -11 V11 M-8 -7.5 Q0 0 -8 7.5 M8 -7.5 Q0 0 8 7.5" stroke="#7a2e00" stroke-width="1.2" fill="none"/></g>`;

/** Players, ball and the "+N" popup for one frame. Back-to-front: far players first, ball behind or in front of the shooter. */
export function actorsSvg(frame: StageFrame, look: (key: string) => Appearance, ballColor?: string): string {
  let out = open(STAGE_W, STAGE_H);
  const ordered = [...frame.actors].sort((a, b) => a.y - b.y);
  if (frame.ball.visible && frame.ball.behind) out += ballSvg(frame.ball.x, frame.ball.y, ballColor);
  for (const a of ordered) {
    const ap = look(a.key);
    const svg = renderAvatarSvg(ap.config, ap.worn, a.pose);
    out += `<g transform="translate(${(a.x - 200 * SPRITE_K).toFixed(1)} ${(a.y - 590 * SPRITE_K).toFixed(1)}) scale(${SPRITE_K})">${inner(svg)}</g>`;
  }
  if (frame.ball.visible && !frame.ball.behind) out += ballSvg(frame.ball.x, frame.ball.y, ballColor);
  if (frame.popup && frame.popup.alpha > 0) {
    out += `<text x="${frame.popup.x.toFixed(1)}" y="${frame.popup.y.toFixed(1)}" font-size="34" font-weight="800" font-family="Barlow Condensed,Arial Narrow,Arial,sans-serif" text-anchor="middle" fill="#f5b301" stroke="#0c0c0e" stroke-width="3" paint-order="stroke" opacity="${frame.popup.alpha.toFixed(2)}">${frame.popup.text}</text>`;
  }
  return out + '</svg>';
}

/** A whole frame as one SVG string (for contact sheets and tests; the app layers the pieces instead). */
export function sceneSvg(frame: StageFrame, look: (key: string) => Appearance, seed = 'crowd'): string {
  const lift = (i: number) => -Math.round(frame.crowd * [4, 7, 10][i]! * 1);
  return (
    open(STAGE_W, STAGE_H) +
    inner(courtSvg()) +
    [0, 1, 2].map((i) => `<g transform="translate(0 ${lift(i)})">${inner(crowdRowSvg(i, seed, frame.crowd > 0.6))}</g>`).join('') +
    inner(hoopsSvg(frame)) +
    inner(actorsSvg(frame, look)) +
    '</svg>'
  );
}
