import { z } from 'zod';

/**
 * Kingz Baller avatar: our own vector character (no third-party art, no licence strings), drawn in code so it is
 * deterministic, tiny, testable and works the same on web and phone. Stored as a small JSON config; the SVG is never saved.
 */
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex colour like #aabbcc');

export const JERSEY_STYLES = ['classic', 'stripe', 'split'] as const;
export const SHOE_STYLES = ['low', 'high'] as const;
export const SKIN_TONES = ['#f6d3b5', '#eab98f', '#d39a6a', '#b9774a', '#8d5a38', '#5b3a24'] as const;
export const HAIR_COLORS = ['#141414', '#3b2a1e', '#6b4429', '#b07a3a', '#d9b45a', '#9a9aa3'] as const;
export const HAIR_STYLES = ['bald', 'buzz', 'short', 'waves', 'afro', 'locs', 'bun'] as const;
export const BEARD_STYLES = ['none', 'stubble', 'goatee', 'full'] as const;

export const LookSchema = z.object({
  skin: z.number().int().min(0).max(SKIN_TONES.length - 1),
  hair: z.enum(HAIR_STYLES),
  hairColor: z.number().int().min(0).max(HAIR_COLORS.length - 1),
  beard: z.enum(BEARD_STYLES),
});
export type Look = z.infer<typeof LookSchema>;

/** Stored in profiles.avatar as JSON. `look` is optional: older configs derive their face from the seed. */
export const AvatarConfigSchema = z.object({
  seed: z.string().min(1).max(64),
  look: LookSchema.optional(),
  jersey: z.object({ style: z.enum(JERSEY_STYLES), primary: Hex, secondary: Hex, number: z.number().int().min(0).max(99) }),
  shorts: z.object({ color: Hex }),
  shoes: z.object({ style: z.enum(SHOE_STYLES), color: Hex }),
});
export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;

export function defaultAvatarConfig(seed: string): AvatarConfig {
  return {
    seed,
    look: lookFromSeed(seed),
    jersey: { style: 'classic', primary: '#f5b301', secondary: '#1b1b1b', number: 23 },
    shorts: { color: '#1b1b1b' },
    shoes: { style: 'low', color: '#f5f3ee' },
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A pleasant, deterministic starting face for a seed. */
export function lookFromSeed(seed: string): Look {
  const h = hash(seed);
  return {
    skin: h % SKIN_TONES.length,
    hair: HAIR_STYLES[(h >>> 3) % HAIR_STYLES.length]!,
    hairColor: (h >>> 7) % 4,
    beard: (h >>> 11) % 3 === 0 ? BEARD_STYLES[1 + ((h >>> 13) % 3)]! : 'none',
  };
}

/** Cosmetic variants worn by the player, keyed by slot (the `variant` of the equipped catalog item). */
export interface WornVariants {
  jersey?: string;
  shorts?: string;
  shoes?: string;
  headwear?: string;
  accessory?: string;
}

/** Multiply an #rrggbb colour's brightness (f < 1 darkens, f > 1 lightens toward white). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const INK = '#1a1410';

function hairBack(look: Look, c: string): string {
  switch (look.hair) {
    case 'afro':
      return `<g id="hair-back"><circle cx="200" cy="96" r="76" fill="${c}"/></g>`;
    case 'locs':
      return `<g id="hair-back">${[152, 166, 234, 248].map((x, i) => `<path d="M${x} 92 Q${x + (x < 200 ? -10 : 10)} 150 ${x + (x < 200 ? -6 : 6)} ${176 + (i % 2) * 14}" stroke="${c}" stroke-width="15" stroke-linecap="round" fill="none"/>`).join('')}</g>`;
    case 'bun':
      return `<g id="hair-back"><circle cx="200" cy="24" r="24" fill="${c}"/></g>`;
    default:
      return '';
  }
}

function hairFront(look: Look, c: string): string {
  const hi = shade(c, 1.25);
  switch (look.hair) {
    case 'bald':
      return '';
    case 'buzz':
      return `<path id="hair" d="M152 100 C150 62 172 50 200 50 C228 50 250 62 248 100 C238 84 224 76 200 76 C176 76 162 84 152 100 Z" fill="${c}" opacity="0.92"/>`;
    case 'short':
      return `<g id="hair"><path d="M149 108 C140 60 170 40 202 42 C236 42 262 62 251 108 C242 88 226 74 200 76 C176 74 160 88 149 108 Z" fill="${c}"/><path d="M168 56 Q200 44 232 58" stroke="${hi}" stroke-width="4" fill="none" opacity="0.5" stroke-linecap="round"/></g>`;
    case 'waves':
      return `<g id="hair"><path d="M148 110 C136 58 172 36 204 38 C240 38 266 60 252 110 C244 90 230 78 200 80 C172 78 156 90 148 110 Z" fill="${c}"/>${[0, 1, 2].map((i) => `<path d="M${164 + i * 22} 54 Q${172 + i * 22} 48 ${180 + i * 22} 56" stroke="${hi}" stroke-width="4" fill="none" opacity="0.45" stroke-linecap="round"/>`).join('')}</g>`;
    case 'afro':
      return `<path id="hair" d="M150 110 C146 82 168 66 200 66 C232 66 254 82 250 110 C240 92 224 86 200 86 C176 86 160 92 150 110 Z" fill="${c}"/>`;
    case 'locs':
      return `<path id="hair" d="M148 108 C140 56 172 40 202 40 C236 40 262 58 252 108 C242 86 226 76 200 78 C174 76 158 86 148 108 Z" fill="${c}"/>`;
    case 'bun':
      return `<path id="hair" d="M150 106 C146 64 172 48 200 48 C228 48 254 64 250 106 C240 86 224 78 200 80 C176 78 160 86 150 106 Z" fill="${c}"/>`;
  }
}

function beardLayer(look: Look, c: string): string {
  if (look.beard === 'none') return '';
  if (look.beard === 'stubble') return `<path id="beard" d="M156 130 C158 168 178 188 200 188 C222 188 242 168 244 130 C236 160 220 170 200 170 C180 170 164 160 156 130 Z" fill="${c}" opacity="0.35"/>`;
  if (look.beard === 'goatee') return `<g id="beard"><path d="M184 166 Q200 162 216 166 Q214 188 200 190 Q186 188 184 166 Z" fill="${c}"/><path d="M178 158 Q200 150 222 158" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round"/></g>`;
  return `<path id="beard" d="M153 116 C152 160 174 192 200 192 C226 192 248 160 247 116 C242 148 226 160 200 160 C174 160 158 148 153 116 Z" fill="${c}"/>`;
}

function headwearLayer(v: string | undefined, look: Look, hair: string): string {
  const top = look.hair === 'afro' ? 22 : 40;
  if (v === 'headband') return `<g id="headwear"><path d="M149 80 Q200 64 251 80 L251 93 Q200 77 149 93 Z" fill="#ef4444"/><path d="M149 80 Q200 64 251 80" stroke="#fff" stroke-opacity=".35" stroke-width="3" fill="none"/></g>`;
  if (v === 'cap') return `<g id="headwear"><path d="M146 104 C142 54 172 38 202 38 C236 38 262 54 254 104 Q200 90 146 104 Z" fill="#17202e"/><path d="M146 104 Q200 92 254 104 L282 112 Q262 120 240 112 Q200 102 146 112 Z" fill="#0e1520"/><circle cx="200" cy="40" r="6" fill="#f5b301"/><path d="M180 70 Q200 62 220 70" stroke="#f5b301" stroke-width="5" fill="none" stroke-linecap="round"/></g>`;
  if (v === 'crown') return `<g id="headwear"><path d="M152 ${top + 44} L160 ${top} L181 ${top + 24} L200 ${top - 10} L219 ${top + 24} L240 ${top} L248 ${top + 44} Z" fill="#f5b301" stroke="#b45309" stroke-width="3" stroke-linejoin="round"/><rect x="152" y="${top + 38}" width="96" height="10" rx="3" fill="#d99a00"/><circle cx="200" cy="${top + 8}" r="5" fill="#ef4444"/><circle cx="168" cy="${top + 12}" r="3.5" fill="#60a5fa"/><circle cx="232" cy="${top + 12}" r="3.5" fill="#60a5fa"/></g>`;
  void hair;
  return '';
}

/** Shades and chain are drawn with the head group so they scale with it. */
function faceAccessoryLayer(v: string | undefined): string {
  if (v === 'shades') return `<g id="accessory"><path d="M160 104 h36 q4 0 4 4 v10 q0 10 -10 10 h-20 q-10 0 -10 -10 Z" fill="#0c0c0e"/><path d="M204 104 h36 q4 0 4 4 v10 q0 10 -10 10 h-20 q-10 0 -10 -10 Z" fill="#0c0c0e"/><rect x="196" y="108" width="8" height="4" fill="#0c0c0e"/><path d="M166 108 l16 0" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/></g>`;
  if (v === 'chain') return `<g id="accessory"><path d="M166 214 Q200 270 234 214" fill="none" stroke="#f5b301" stroke-width="5" stroke-linecap="round"/><circle cx="200" cy="262" r="11" fill="#f5b301" stroke="#b45309" stroke-width="2"/><text x="200" y="266" font-size="11" font-weight="800" text-anchor="middle" fill="#7a4b00" font-family="Arial,sans-serif">K</text></g>`;
  return '';
}

function jerseyLayer(j: AvatarConfig['jersey'], variant?: string): string {
  if (variant === 'royal') j = { ...j, style: 'classic', primary: '#4c1d95', secondary: '#f5b301' };
  else if (variant === 'classic' || variant === 'stripe' || variant === 'split') j = { ...j, style: variant };
  const body = 'M150 226 L174 220 Q200 252 226 220 L250 226 Q268 262 260 304 L264 394 Q200 408 136 394 L140 304 Q132 262 150 226 Z';
  const light = shade(j.primary, 1.18);
  const dark = shade(j.primary, 0.78);
  const deco =
    j.style === 'stripe'
      ? `<path d="M130 262 L270 262 L270 280 L130 280 Z" fill="${j.secondary}"/><path d="M130 366 L270 366 L270 382 L130 382 Z" fill="${j.secondary}"/>`
      : j.style === 'split'
        ? `<path d="M200 252 L262 304 L264 394 Q232 402 200 402 Z" fill="${j.secondary}"/>`
        : '';
  const numColor = j.style === 'split' ? '#ffffff' : j.secondary;
  return (
    `<g id="jersey"><clipPath id="jc"><path d="${body}"/></clipPath>` +
    `<path d="${body}" fill="${j.primary}"/>` +
    `<g clip-path="url(#jc)">${deco}<path d="M136 330 Q200 350 264 330 L264 420 L136 420 Z" fill="${dark}" opacity="0.35"/><path d="M150 232 Q146 300 150 360" stroke="${light}" stroke-width="10" opacity="0.28" fill="none"/></g>` +
    `<path d="M174 220 Q200 252 226 220" fill="none" stroke="${j.secondary}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M150 226 Q168 232 174 220 M250 226 Q232 232 226 220" fill="none" stroke="${j.secondary}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M139 392 Q200 406 261 392" fill="none" stroke="${j.secondary}" stroke-width="6" stroke-linecap="round"/>` +
    `<text x="200" y="342" font-family="Barlow Condensed,Arial Narrow,Arial,sans-serif" font-size="68" font-weight="800" text-anchor="middle" fill="${numColor}">${j.number}</text></g>`
  );
}

function shortsLayer(s: AvatarConfig['shorts'], variant?: string): string {
  const dark = shade(s.color, 0.7);
  const stripe = variant === 'stripe' ? `<path d="M134 400 L124 486 M266 400 L276 486" stroke="#f5f3ee" stroke-width="8" fill="none" stroke-linecap="round"/>` : '';
  return (
    `<g id="shorts"><path d="M136 392 L264 392 L278 494 Q246 500 214 494 L200 440 L186 494 Q154 500 122 494 Z" fill="${s.color}"/>` +
    `<path d="M200 440 L186 494 L214 494 Z" fill="${dark}" opacity="0.55"/>` +
    `<rect x="136" y="390" width="128" height="14" rx="5" fill="${dark}"/>${stripe}<path d="M190 404 L200 418 L210 404" stroke="#f5f3ee" stroke-opacity=".55" stroke-width="2.5" fill="none"/></g>`
  );
}

/** A pose for animation. Angles are degrees; arm angles are measured from hanging straight down, outward positive. */
export interface Pose {
  /** Whole-body shift in avatar units (negative dy = in the air). */
  dx?: number;
  dy?: number;
  /** Lean about the feet, positive = clockwise. */
  lean?: number;
  /** Vertical squash about the feet (1 = none, 0.9 = crouch). */
  squash?: number;
  /** Horizontal scale about the body centre; cos of a spin angle (1 = facing front, -1 = flipped). */
  spin?: number;
  headTilt?: number;
  /** Upper-arm angle `s` and forearm angle `f` (both from straight down, outward positive). */
  armL?: { s: number; f: number };
  armR?: { s: number; f: number };
  /** Leg abduction (outward) and lift (units the leg is raised). */
  legL?: { a: number; lift?: number };
  legR?: { a: number; lift?: number };
}

export const REST_POSE: Required<Pick<Pose, 'armL' | 'armR' | 'legL' | 'legR'>> = {
  armL: { s: 9, f: 5 },
  armR: { s: 9, f: 5 },
  legL: { a: 0 },
  legR: { a: 0 },
};

const SHOULDER = { L: { x: 146, y: 238 }, R: { x: 254, y: 238 } } as const;
const UPPER = 74;
const FORE = 70;
const rad = (d: number) => (d * Math.PI) / 180;

function armPoints(side: 'L' | 'R', arm: { s: number; f: number }) {
  const sign = side === 'L' ? -1 : 1;
  const sh = SHOULDER[side];
  const ex = sh.x + sign * UPPER * Math.sin(rad(arm.s));
  const ey = sh.y + UPPER * Math.cos(rad(arm.s));
  const hx = ex + sign * FORE * Math.sin(rad(arm.f));
  const hy = ey + FORE * Math.cos(rad(arm.f));
  return { sh, e: { x: ex, y: ey }, h: { x: hx, y: hy } };
}

/** Where a hand is in avatar units (before the whole-body pose transform). */
export function handPosition(pose: Pose, side: 'L' | 'R'): { x: number; y: number } {
  const arm = (side === 'L' ? pose.armL : pose.armR) ?? REST_POSE.armL;
  return armPoints(side, arm).h;
}

function armsLayer(skin: string, pose: Pose, wrist: boolean): string {
  const dark = shade(skin, 0.8);
  const one = (side: 'L' | 'R', arm: { s: number; f: number }) => {
    const { sh, e, h } = armPoints(side, arm);
    const sign = side === 'L' ? -1 : 1;
    const bandFrom = { x: h.x - sign * 20 * Math.sin(rad(arm.f)), y: h.y - 20 * Math.cos(rad(arm.f)) };
    const bandTo = { x: h.x - sign * 8 * Math.sin(rad(arm.f)), y: h.y - 8 * Math.cos(rad(arm.f)) };
    return (
      `<path d="M${sh.x} ${sh.y} L${e.x.toFixed(1)} ${e.y.toFixed(1)}" stroke="${skin}" stroke-width="30" stroke-linecap="round"/>` +
      `<path d="M${e.x.toFixed(1)} ${e.y.toFixed(1)} L${h.x.toFixed(1)} ${h.y.toFixed(1)}" stroke="${skin}" stroke-width="26" stroke-linecap="round"/>` +
      `<path d="M${sh.x + sign * 4} ${sh.y + 8} L${(e.x + sign * 4).toFixed(1)} ${(e.y + 4).toFixed(1)}" stroke="${dark}" stroke-width="7" stroke-linecap="round" opacity="0.3"/>` +
      `<circle cx="${h.x.toFixed(1)}" cy="${h.y.toFixed(1)}" r="16" fill="${skin}"/>` +
      (wrist ? `<path d="M${bandFrom.x.toFixed(1)} ${bandFrom.y.toFixed(1)} L${bandTo.x.toFixed(1)} ${bandTo.y.toFixed(1)}" stroke="#f5f3ee" stroke-width="28"/><path d="M${((bandFrom.x + bandTo.x) / 2).toFixed(1)} ${((bandFrom.y + bandTo.y) / 2).toFixed(1)} l0 0" stroke="#ef4444" stroke-width="3"/>` : '')
    );
  };
  return `<g id="arms">${one('L', pose.armL ?? REST_POSE.armL)}${one('R', pose.armR ?? REST_POSE.armR)}</g>`;
}

function shoeShape(s: AvatarConfig['shoes'], variant?: string): string {
  const style = variant === 'high' || variant === 'low' ? variant : s.style;
  const hi = style === 'high' ? 22 : 0;
  const upper = s.color;
  const dark = shade(upper, 0.78);
  // Drawn at the left foot with the toe pointing outward (left); the right foot is its mirror image.
  return (
    `<path d="M-14 ${572 - hi} Q-14 ${548 - hi} 6 ${546 - hi} L24 ${548 - hi} L28 572 L28 584 L-46 584 L-46 576 Q-46 566 -30 562 Q-16 560 -14 572 Z" fill="${upper}"/>` +
    `<path d="M-46 576 Q-20 570 28 574" stroke="${dark}" stroke-width="2" fill="none" opacity=".4"/>` +
    `<path d="M2 ${552 - hi} L-12 ${558 - hi} M6 ${558 - hi} L-8 ${564 - hi}" stroke="${dark}" stroke-width="3" stroke-linecap="round" opacity=".7"/>` +
    `<path d="M-40 574 Q-10 566 22 570" stroke="#ef4444" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    `<rect x="-50" y="580" width="82" height="12" rx="6" fill="#f5f3ee" stroke="${dark}" stroke-opacity=".35"/>`
  );
}

/** Both legs, each with its sock and shoe, swung about the hip. */
function legsLayer(skin: string, shoes: AvatarConfig['shoes'], shoeVariant: string | undefined, pose: Pose): string {
  const dark = shade(skin, 0.82);
  const shoe = shoeShape(shoes, shoeVariant);
  const leg = (side: 'L' | 'R', spec: { a: number; lift?: number }) => {
    const hipX = side === 'L' ? 166 : 234;
    const rot = side === 'L' ? spec.a : -spec.a;
    const body =
      `<rect x="${hipX - 20}" y="480" width="40" height="84" rx="16" fill="${skin}"/>` +
      `<rect x="${hipX - 20}" y="480" width="14" height="84" rx="7" fill="${dark}" opacity="0.35"/>` +
      `<rect x="${hipX - 22}" y="528" width="44" height="34" rx="9" fill="#f5f3ee"/><rect x="${hipX - 22}" y="534" width="44" height="5" fill="#ef4444" opacity=".85"/>`;
    const foot = side === 'L' ? `<g transform="translate(166 0)">${shoe}</g>` : `<g transform="translate(234 0) scale(-1 1)">${shoe}</g>`;
    return `<g transform="translate(0 ${-(spec.lift ?? 0)}) rotate(${rot} ${hipX} 484)">${body}${foot}</g>`;
  };
  return `<g id="legs">${leg('L', pose.legL ?? REST_POSE.legL)}${leg('R', pose.legR ?? REST_POSE.legR)}</g>`;
}

function headLayer(look: Look, skin: string, hairColor: string): string {
  const dark = shade(skin, 0.8);
  const face = 'M150 110 C150 70 175 50 200 50 C225 50 250 70 250 110 C250 150 232 184 200 188 C168 184 150 150 150 110 Z';
  return (
    `<g id="head">` +
    `<path d="M180 170 h40 v54 q-20 12 -40 0 Z" fill="${skin}"/><path d="M180 196 q20 16 40 0 v14 q-20 12 -40 0 Z" fill="${dark}" opacity="0.45"/>` +
    `<ellipse cx="148" cy="120" rx="11" ry="15" fill="${skin}"/><ellipse cx="252" cy="120" rx="11" ry="15" fill="${skin}"/>` +
    `<path d="${face}" fill="${skin}"/>` +
    `<path d="M156 150 Q176 186 200 188 Q224 186 244 150 Q226 176 200 176 Q174 176 156 150 Z" fill="${dark}" opacity="0.18"/>` +
    `<ellipse cx="178" cy="114" rx="10.5" ry="7.5" fill="#fff"/><ellipse cx="222" cy="114" rx="10.5" ry="7.5" fill="#fff"/>` +
    `<circle cx="180" cy="114.5" r="5.6" fill="${INK}"/><circle cx="224" cy="114.5" r="5.6" fill="${INK}"/><circle cx="182" cy="112.5" r="1.8" fill="#fff"/><circle cx="226" cy="112.5" r="1.8" fill="#fff"/>` +
    `<path d="M166 98 Q178 92 191 98 M209 98 Q222 92 234 98" stroke="${look.hair === 'bald' ? dark : hairColor}" stroke-width="4.5" stroke-linecap="round" fill="none"/>` +
    `<path d="M200 118 Q196 136 200 140 Q206 140 206 138" stroke="${dark}" stroke-width="3" stroke-linecap="round" fill="none"/>` +
    `<path d="M184 156 Q200 168 216 156" stroke="${INK}" stroke-width="4" stroke-linecap="round" fill="none"/>` +
    `</g>`
  );
}

/** Full-body avatar, 400 x 600. Colours come from the config; style variants from what the player wears; a pose animates it. */
export function renderAvatarSvg(input: AvatarConfig, worn: WornVariants = {}, pose: Pose = {}): string {
  const c = AvatarConfigSchema.parse(input);
  const look = c.look ?? lookFromSeed(c.seed);
  const skin = SKIN_TONES[look.skin]!;
  const hairColor = HAIR_COLORS[look.hairColor]!;
  const dy = pose.dy ?? 0;
  const body = `translate(${pose.dx ?? 0} ${dy}) rotate(${pose.lean ?? 0} 200 590) translate(200 590) scale(${pose.spin ?? 1} ${pose.squash ?? 1}) translate(-200 -590)`;
  const shadowRx = Math.max(60, 118 * (1 + dy / 700));
  const headTf = `translate(200 215) scale(1.1) translate(-200 -215) rotate(${pose.headTilt ?? 0} 200 215)`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600" role="img" aria-label="Player avatar">` +
    `<g transform="translate(20 30) scale(0.95)">` +
    `<ellipse cx="${200 + (pose.dx ?? 0)}" cy="590" rx="${shadowRx.toFixed(1)}" ry="9" fill="#000" opacity="0.28"/>` +
    `<g transform="${body}">` +
    `<g transform="${headTf}">${hairBack(look, hairColor)}</g>` +
    legsLayer(skin, c.shoes, worn.shoes, pose) +
    shortsLayer(c.shorts, worn.shorts) +
    armsLayer(skin, pose, worn.accessory === 'wristbands') +
    jerseyLayer(c.jersey, worn.jersey) +
    `<g transform="${headTf}">` +
    headLayer(look, skin, hairColor) +
    beardLayer(look, hairColor) +
    hairFront(look, hairColor) +
    headwearLayer(worn.headwear, look, hairColor) +
    faceAccessoryLayer(worn.accessory) +
    `</g>` +
    `</g>` +
    `</g>` +
    `</svg>`
  );
}
export * from './choreo.js';
export * from './stage.js';
