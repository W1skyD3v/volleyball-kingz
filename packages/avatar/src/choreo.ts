import type { ReplayStep } from '@vk/core';
import { handPosition, type Pose } from './index.js';

/**
 * Choreography for one made shot: a pure function from "how far into the step are we" to where everyone stands, what
 * pose they are in, and where the ball is. 1 point = a driving dunk, 2 points = a three-pointer (docs/design/BALLER.md).
 * The same step plays in about 7 seconds whatever the real game took, and is skippable/speedable in the viewer.
 */
export const STAGE_W = 720;
export const STAGE_H = 400;
export const FLOOR_Y = 372;
export const RIM_Y = 205;
export const RIM_X = { L: 88, R: 632 } as const;
/** Sprite scale: a 600-unit avatar is about 162 stage pixels tall. */
export const SPRITE_K = 0.27;

/** Fraction of the step at which the ball goes through the rim. */
export const MAKE_AT = { dunk: 0.72, three: 0.76 } as const;

export type Role = 'shooter' | 'passer' | 'defender' | 'defender2';
export interface StageActor {
  key: string;
  team: 'A' | 'B';
  role: Role;
  /** Feet position on the stage. */
  x: number;
  y: number;
  pose: Pose;
}
export interface StageFrame {
  actors: StageActor[];
  ball: { x: number; y: number; visible: boolean; behind: boolean };
  hoop: { side: 'L' | 'R'; shake: number; made: boolean };
  popup: { text: string; x: number; y: number; alpha: number } | null;
  /** 0..1, drives the crowd. */
  crowd: number;
  caption: string;
}
export interface Styles {
  dunk: string;
  shot: string;
  dribble: string;
  pass: string;
  celebration: string;
}
export const DEFAULT_STYLES: Styles = { dunk: 'two-hand', shot: 'set', dribble: 'standard', pass: 'chest', celebration: 'fist' };

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (u: number, a: number, b: number) => clamp((u - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const tau = Math.PI * 2;

/** Avatar-space point -> stage point for an actor (mirrors the transforms in renderAvatarSvg). */
export function avatarToStage(actor: { x: number; y: number; pose: Pose }, p: { x: number; y: number }): { x: number; y: number } {
  const pose = actor.pose;
  let x = (p.x - 200) * (pose.spin ?? 1);
  let y = (p.y - 590) * (pose.squash ?? 1);
  const a = ((pose.lean ?? 0) * Math.PI) / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  x = rx + 200 + (pose.dx ?? 0);
  y = ry + 590 + (pose.dy ?? 0);
  const cx = 20 + 0.95 * x;
  const cy = 30 + 0.95 * y;
  return { x: actor.x + (cx - 200) * SPRITE_K, y: actor.y + (cy - 590) * SPRITE_K };
}

const arms = (l: [number, number], r: [number, number]): Pick<Pose, 'armL' | 'armR'> => ({ armL: { s: l[0], f: l[1] }, armR: { s: r[0], f: r[1] } });

/** Guard stance: knees wide, hands out, shuffling side to side. */
function guardPose(u: number, lift = 0, handsUp = 0): Pose {
  const sh = Math.sin(u * tau * 5);
  return {
    ...arms([lerp(70, 165, handsUp), lerp(55, 175, handsUp)], [lerp(70, 165, handsUp), lerp(55, 175, handsUp)]),
    legL: { a: 22 + 4 * sh, lift: Math.max(0, sh) * 8 },
    legR: { a: 22 - 4 * sh, lift: Math.max(0, -sh) * 8 },
    squash: 0.93,
    dy: -lift,
    headTilt: 0,
  };
}

function runPose(u: number, speed: number): Pose {
  const sw = Math.sin(u * tau * 9) * speed;
  return { legL: { a: 8 + 10 * sw, lift: Math.max(0, sw) * 14 }, legR: { a: 8 - 10 * sw, lift: Math.max(0, -sw) * 14 }, dy: -Math.abs(Math.sin(u * tau * 4.5)) * 6 * speed };
}

/** Dribbling hand pose + ball position for each dribble style. */
function dribble(style: string, actor: StageActor, cycles: number): { ball: { x: number; y: number; behind: boolean }; arms: Pick<Pose, 'armL' | 'armR'> } {
  const bounce = Math.abs(Math.sin(Math.PI * cycles)); // 1 = at the hand-free top, 0 = on the floor
  const handR = avatarToStage(actor, handPosition({ armR: { s: 28, f: 22 } }, 'R'));
  const handL = avatarToStage(actor, handPosition({ armL: { s: 28, f: 22 } }, 'L'));
  const topY = handR.y;
  const y = FLOOR_Y - 6 - (FLOOR_Y - 6 - topY) * bounce;
  const mid = (handL.x + handR.x) / 2;
  const base = arms([12, 8], [28, 22]);
  switch (style) {
    case 'crossover': {
      const side = Math.sin((cycles / 4) * tau); // swings hand to hand
      return { ball: { x: lerp(handR.x, handL.x, 0.5 - 0.5 * side), y, behind: false }, arms: side > 0 ? arms([12, 8], [34, 26]) : arms([34, 26], [12, 8]) };
    }
    case 'behind': {
      const ph = (cycles / 3) * tau;
      const x = mid + Math.sin(ph) * (handR.x - handL.x) * 0.5;
      return { ball: { x, y: lerp(y, FLOOR_Y - 40, 0.2), behind: Math.cos(ph) < 0 }, arms: arms([40, 50], [40, 50]) };
    }
    case 'legs': {
      const side = cycles % 2 < 1 ? 1 : -1;
      return { ball: { x: mid + side * 6, y: lerp(FLOOR_Y - 6, FLOOR_Y - 70, bounce * 0.6), behind: true }, arms: arms([20, 70], [20, 70]) };
    }
    default:
      return { ball: { x: handR.x, y, behind: false }, arms: base };
  }
}

function celebratePose(style: string, u: number): Pose {
  const t = u * 14;
  switch (style) {
    case 'flex':
      return { ...arms([100, 175], [100, 175]), headTilt: 0, squash: 0.97, legL: { a: 14 }, legR: { a: 14 } };
    case 'shimmy':
      return { ...arms([60, 60], [60, 60]), dx: Math.sin(t * 2) * 12, lean: Math.sin(t * 2) * 7, legL: { a: 12 }, legR: { a: 12 } };
    default:
      return { ...arms([14, 8], [160, 170]), dy: -Math.abs(Math.sin(t)) * 18, headTilt: 6, legL: { a: 10 }, legR: { a: 10 } };
  }
}

export interface FrameOptions {
  teamSize: number;
  styles?: Partial<Styles>;
}

export function frameAt(step: ReplayStep, opts: FrameOptions, localMs: number): StageFrame {
  const styles = { ...DEFAULT_STYLES, ...opts.styles };
  const u = clamp(localMs / step.durationMs);
  const dir = step.side === 'A' ? 1 : -1;
  const side: 'L' | 'R' = dir > 0 ? 'R' : 'L';
  const rimX = RIM_X[side];
  const three = step.shot === 'three';
  const make = three ? MAKE_AT.three : MAKE_AT.dunk;
  const defTeam: 'A' | 'B' = step.side === 'A' ? 'B' : 'A';
  const x0 = rimX - dir * 300;
  const x1 = rimX - dir * 52;
  const xArc = rimX - dir * 232;

  // --- shooter
  const shooter: StageActor = { key: 'shooter', team: step.side, role: 'shooter', x: x0, y: FLOOR_Y, pose: {} };
  const drift = Math.sin(u * tau * 2) * 8;
  let jumpY = 0;
  if (!three) {
    const drive = easeIn(seg(u, 0.22, 0.52));
    const jump = seg(u, 0.54, 0.74);
    shooter.x = lerp(x0 + dir * 30 + drift * (1 - drive), x1, drive);
    if (u > 0.54) shooter.x = lerp(x1, rimX - dir * 40, easeInOut(seg(u, 0.54, 0.7)));
    if (u > 0.76) shooter.x = lerp(rimX - dir * 40, rimX - dir * 110, easeOut(seg(u, 0.78, 1)));
    jumpY = Math.sin(Math.PI * jump) * 138;
  } else {
    const move = easeInOut(seg(u, 0.22, 0.45));
    shooter.x = lerp(x0 + drift * (1 - move), xArc, move);
    if (styles.shot === 'stepback') shooter.x -= dir * 34 * easeOut(seg(u, 0.38, 0.5));
    if (styles.shot === 'fadeaway') shooter.x -= dir * 20 * easeOut(seg(u, 0.48, 0.58));
    if (u > 0.82) shooter.x += dir * 18 * easeOut(seg(u, 0.82, 1));
    jumpY = Math.sin(Math.PI * seg(u, 0.48, 0.64)) * (styles.shot === 'one-leg' ? 70 : 56);
  }
  const speed = !three ? seg(u, 0.18, 0.5) * (1 - seg(u, 0.52, 0.56)) + 0.25 : seg(u, 0.2, 0.45) * (1 - seg(u, 0.45, 0.5)) + 0.2;

  // base pose while moving/dribbling
  const bounceCycles = (localMs / 430) * 1;
  const dr = dribble(styles.dribble, shooter, bounceCycles);
  let ball = { x: dr.ball.x, y: dr.ball.y, visible: true, behind: dr.ball.behind };
  shooter.pose = { ...runPose(u, speed), ...dr.arms, lean: dir * 6 * speed };

  const centerHand = () => {
    const l = avatarToStage(shooter, handPosition(shooter.pose, 'L'));
    const r = avatarToStage(shooter, handPosition(shooter.pose, 'R'));
    return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  };

  // --- teammates and defence
  const passer: StageActor | null = opts.teamSize > 1 ? { key: 'passer', team: step.side, role: 'passer', x: x0 - dir * 95, y: FLOOR_Y, pose: { ...runPose(u, 0.25), ...arms([30, 40], [30, 40]) } } : null;
  const defender: StageActor = { key: 'defender', team: defTeam, role: 'defender', x: 0, y: FLOOR_Y, pose: guardPose(u) };
  if (!three) {
    const trail = easeInOut(seg(u, 0.4, 0.55));
    defender.x = lerp(shooter.x + dir * 70, shooter.x - dir * 16, trail);
    if (u > 0.55) defender.x = lerp(defender.x, shooter.x - dir * 70, easeOut(seg(u, 0.58, 0.8)));
    defender.pose = { ...guardPose(u, Math.sin(Math.PI * seg(u, 0.66, 0.8)) * 70, seg(u, 0.64, 0.7) * (1 - seg(u, 0.78, 0.84))), lean: -dir * 6 * trail };
  } else {
    const close = easeIn(seg(u, 0.28, 0.5));
    defender.x = lerp(shooter.x + dir * 150, shooter.x + dir * 40, close);
    defender.pose = { ...guardPose(u, Math.sin(Math.PI * seg(u, 0.54, 0.7)) * 46, seg(u, 0.5, 0.58) * (1 - seg(u, 0.72, 0.8))), lean: dir * 4 * close };
  }
  const defender2: StageActor | null = opts.teamSize > 1 ? { key: 'defender2', team: defTeam, role: 'defender2', x: rimX - dir * (three ? 140 : 100), y: FLOOR_Y, pose: guardPose(u + 0.3) } : null;

  // --- the pass (teams larger than one): passer -> shooter before the drive
  let hasBall: 'passer' | 'shooter' = 'shooter';
  if (passer) {
    const p = seg(u, 0.08, 0.2);
    if (u < 0.2) hasBall = 'passer';
    const from = avatarToStage(passer, handPosition({ armR: { s: 40, f: 40 } }, 'R'));
    const to = avatarToStage(shooter, handPosition(shooter.pose, 'R'));
    const style = styles.pass;
    if (u < 0.08) {
      const d = dribble('standard', passer, bounceCycles + 0.3);
      ball = { ...d.ball, visible: true };
      passer.pose = { ...passer.pose, ...d.arms };
    } else if (u < 0.2) {
      let by = lerp(from.y - 10, to.y, p);
      if (style === 'bounce') by = lerp(from.y - 10, to.y, p) + (FLOOR_Y - 8 - lerp(from.y - 10, to.y, 0.5)) * Math.sin(Math.PI * p);
      if (style === 'chest') by = lerp(from.y, to.y, p) - Math.sin(Math.PI * p) * 8;
      ball = { x: lerp(from.x, to.x, p), y: by, visible: true, behind: style === 'behind' && p > 0.2 && p < 0.7 };
      passer.pose = {
        ...passer.pose,
        ...(style === 'behind' ? arms([50, 10], [40, 140]) : style === 'nolook' ? arms([60, 70], [60, 70]) : arms([85, 100], [85, 100])),
        headTilt: style === 'nolook' ? -dir * 14 : 0,
        lean: dir * 4,
      };
    } else {
      hasBall = 'shooter';
    }
  }

  // --- dunk or three: the action
  let hoopMade = false;
  if (!three) {
    const j = seg(u, 0.54, 0.74);
    if (u >= 0.5 && u < 0.54) shooter.pose = { ...shooter.pose, squash: 0.9, ...arms([40, 100], [40, 100]), legL: { a: 18 }, legR: { a: 18 } };
    if (u >= 0.54 && u < 0.78) {
      const v = styles.dunk;
      const legs = { legL: { a: 16, lift: 18 }, legR: { a: 22, lift: 34 } };
      let pose: Pose = { dy: -jumpY, lean: dir * 8, ...legs };
      if (v === 'tomahawk') pose = { ...pose, armL: { s: 105, f: 80 }, armR: j < 0.62 ? { s: 150, f: 95 } : { s: lerp(150, 175, seg(j, 0.62, 0.8)), f: lerp(95, 178, seg(j, 0.62, 0.8)) } };
      else if (v === 'windmill') pose = { ...pose, armL: { s: 95, f: 40 }, armR: { s: lerp(10, 330, easeInOut(j)), f: lerp(10, 330, easeInOut(j)) } };
      else if (v === 'spin') pose = { ...pose, ...arms([165, 175], [165, 175]), spin: Math.cos(tau * easeInOut(seg(j, 0.1, 0.9))) };
      else pose = { ...pose, ...arms([lerp(110, 170, easeOut(Math.min(1, j * 1.6))), lerp(140, 176, easeOut(Math.min(1, j * 1.6)))], [lerp(110, 170, easeOut(Math.min(1, j * 1.6))), lerp(140, 176, easeOut(Math.min(1, j * 1.6)))]) };
      shooter.pose = pose;
    }
    // ball: dribbled until the gather, then carried up and slammed through the rim
    if (u >= 0.5) {
      const c = centerHand();
      const hand = styles.dunk === 'windmill' || styles.dunk === 'tomahawk' ? avatarToStage(shooter, handPosition(shooter.pose, 'R')) : c;
      const slam = easeIn(seg(u, 0.64, make));
      const through = seg(u, make, make + 0.06);
      ball = { x: lerp(hand.x, rimX, slam), y: lerp(hand.y, RIM_Y + 2, slam) + through * 64, visible: true, behind: false };
      if (u > make + 0.06) ball = { x: rimX + (u - make) * 40 * dir * 0, y: lerp(RIM_Y + 66, FLOOR_Y - 8, easeIn(seg(u, make + 0.06, make + 0.14))) - Math.abs(Math.sin(Math.PI * seg(u, make + 0.14, 0.97))) * 26, visible: true, behind: false };
    }
    hoopMade = u >= make;
  } else {
    const windup = seg(u, 0.44, 0.58);
    const release = 0.58;
    if (u >= 0.44 && u < 0.84) {
      const v = styles.shot;
      let pose: Pose = { dy: -jumpY, squash: lerp(1, 0.88, Math.sin(Math.PI * seg(u, 0.44, 0.52))) };
      const up = easeOut(windup);
      pose = { ...pose, armL: { s: lerp(70, 150, up), f: lerp(120, 165, up) }, armR: { s: lerp(70, 158, up), f: lerp(120, 172, up) } };
      if (v === 'fadeaway') pose = { ...pose, lean: -dir * 16 * easeOut(seg(u, 0.46, 0.56)), legL: { a: 14 }, legR: { a: 26, lift: 14 } };
      else if (v === 'one-leg') pose = { ...pose, legL: { a: 8 }, legR: { a: 22, lift: 38 * Math.sin(Math.PI * seg(u, 0.5, 0.66)) } };
      else if (v === 'stepback') pose = { ...pose, lean: -dir * 6, legL: { a: 22 }, legR: { a: 22 } };
      else pose = { ...pose, legL: { a: 16 }, legR: { a: 16 } };
      if (u >= release) pose = { ...pose, armR: { s: 165, f: 150 }, armL: { s: 120, f: 160 } };
      shooter.pose = u < 0.84 ? pose : { ...shooter.pose };
    }
    if (u >= 0.44) {
      const r0 = u < release ? centerHand() : null;
      if (u < release) ball = { x: r0!.x, y: r0!.y, visible: true, behind: false };
      else {
        // release from above the head, high arc to the rim, then through the net and on the floor
        const hand = avatarToStage({ ...shooter, pose: { ...shooter.pose, dy: -56 } }, handPosition({ armR: { s: 165, f: 150 } }, 'R'));
        const f = seg(u, release, make);
        const flightY = lerp(hand.y, RIM_Y, f) - Math.sin(Math.PI * f) * 120;
        const through = seg(u, make, make + 0.05);
        ball = { x: lerp(hand.x, rimX, easeOut(f)), y: u < make ? flightY : RIM_Y + through * 64, visible: true, behind: false };
        if (u > make + 0.05) ball = { x: rimX, y: lerp(RIM_Y + 64, FLOOR_Y - 8, easeIn(seg(u, make + 0.05, make + 0.14))) - Math.abs(Math.sin(Math.PI * seg(u, make + 0.14, 0.97))) * 22, visible: true, behind: false };
      }
    }
    hoopMade = u >= make;
  }

  // --- celebration and the beaten defender
  if (u >= (three ? 0.84 : 0.8)) {
    shooter.pose = celebratePose(styles.celebration, u);
    defender.pose = { ...arms([18, 4], [18, 4]), headTilt: -dir * 12, squash: 0.98 };
  }
  if (hasBall === 'passer' && u < 0.08 && passer) {
    shooter.pose = { ...shooter.pose, ...arms([12, 8], [12, 8]) };
  }

  // --- hoop, popup, crowd, caption
  const since = u - make;
  const shake = hoopMade ? Math.exp(-since * 14) * Math.cos(since * 120) : 0;
  const popup = since > -0.01 && u < 0.98 ? { text: `+${step.points}`, x: rimX - dir * 36, y: RIM_Y - 26 - easeOut(seg(u, make, 0.95)) * 44, alpha: 1 - seg(u, 0.9, 0.98) } : null;
  const crowd = clamp(0.2 + 0.2 * seg(u, 0.4, make) + (u >= make ? 0.8 * Math.exp(-since * 5) : 0));
  const caption = u < 0.22 ? 'Bringing it up' : !three ? (u < 0.54 ? 'Driving to the hoop' : u < make ? 'Rising up…' : 'SLAM!') : u < 0.45 ? 'Spacing out to the arc' : u < make ? 'Pulling up from three' : 'BANG!';

  const actors = [defender, shooter, ...(passer ? [passer] : []), ...(defender2 ? [defender2] : [])];
  // defender2 mirrors the play slightly
  if (defender2) defender2.x = rimX - dir * (three ? 150 : 110) + Math.sin(u * tau * 2) * 10;
  return { actors, ball, hoop: { side, shake, made: hoopMade }, popup, crowd, caption };
}

/** Width of the camera window on the 720-wide stage. The camera follows the shooter and keeps the hoop in view. */
export const CAMERA_W = 460;

export function cameraX(frame: Pick<StageFrame, 'actors' | 'hoop'>): number {
  const shooter = frame.actors.find((a) => a.role === 'shooter');
  const rim = RIM_X[frame.hoop.side];
  const centre = shooter ? (shooter.x + rim) / 2 : rim;
  return clamp(centre - CAMERA_W / 2, 0, STAGE_W - CAMERA_W);
}
