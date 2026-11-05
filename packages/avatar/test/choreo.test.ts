import { describe, expect, it } from 'vitest';
import type { ReplayStep } from '@vk/core';
import { CAMERA_W, MAKE_AT, RIM_X, RIM_Y, STAGE_W, cameraX, frameAt, type Styles } from '../src/index.js';

const step = (over: Partial<ReplayStep> = {}): ReplayStep => ({ t: 0, durationMs: 7000, side: 'A', points: 1, shot: 'dunk', scoreA: 1, scoreB: 0, kind: 'basket', ...over });
const three = (over: Partial<ReplayStep> = {}) => step({ points: 2, shot: 'three', ...over });
const at = (s: ReplayStep, u: number, opts: { teamSize?: number; styles?: Partial<Styles> } = {}) => frameAt(s, { teamSize: opts.teamSize ?? 1, styles: opts.styles }, u * s.durationMs);
const shooter = (f: ReturnType<typeof at>) => f.actors.find((a) => a.role === 'shooter')!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('choreography of one made shot', () => {
  it('the ball goes through the rim when the shot is made (dunk and three)', () => {
    for (const [s, make] of [[step(), MAKE_AT.dunk], [three(), MAKE_AT.three]] as const) {
      const f = at(s, make + 0.015);
      expect(dist(f.ball, { x: RIM_X.R, y: RIM_Y + 8 })).toBeLessThan(40);
      expect(f.hoop.made).toBe(true);
      expect(at(s, make - 0.08).hoop.made).toBe(false);
    }
  });

  it('team A attacks the right hoop, team B the left', () => {
    expect(at(step(), 0.5).hoop.side).toBe('R');
    const b = at(step({ side: 'B' }), 0.72);
    expect(b.hoop.side).toBe('L');
    expect(dist(b.ball, { x: RIM_X.L, y: RIM_Y })).toBeLessThan(60);
    expect(shooter(at(step({ side: 'B' }), 0.5)).team).toBe('B');
    expect(at(step({ side: 'B' }), 0.5).actors.find((a) => a.role === 'defender')!.team).toBe('A');
  });

  it('shows the point value as a popup only after the shot goes in', () => {
    expect(at(step(), 0.3).popup).toBeNull();
    expect(at(three(), 0.3).popup).toBeNull();
    expect(at(step(), 0.85).popup?.text).toBe('+1');
    expect(at(three(), 0.85).popup?.text).toBe('+2');
  });

  it('a one-on-one has no passer; a team game passes the ball to the shooter early on', () => {
    expect(at(step(), 0.1, { teamSize: 1 }).actors.some((a) => a.role === 'passer')).toBe(false);
    const f0 = at(step(), 0.05, { teamSize: 3 });
    const passer = f0.actors.find((a) => a.role === 'passer')!;
    expect(passer).toBeTruthy();
    expect(dist(f0.ball, { x: passer.x, y: passer.y - 60 })).toBeLessThan(90); // passer has it at the start
    const f1 = at(step(), 0.22, { teamSize: 3 });
    expect(dist(f1.ball, { x: shooter(f1).x, y: shooter(f1).y - 60 })).toBeLessThan(110); // shooter has it after the pass
  });

  it('plays the same shape at any duration (a 4 s step is a sped-up 7 s step)', () => {
    const a = frameAt(step({ durationMs: 7000 }), { teamSize: 2 }, 3500);
    const b = frameAt(step({ durationMs: 4000 }), { teamSize: 2 }, 2000);
    expect(JSON.stringify(a.actors)).toBe(JSON.stringify(b.actors));
  });

  it('the defender is on the shooter early (guarding) and the shooter really leaves the floor', () => {
    for (const s of [step(), three()]) {
      for (const u of [0.1, 0.25]) {
        const f = at(s, u);
        expect(Math.abs(f.actors.find((a) => a.role === 'defender')!.x - shooter(f).x)).toBeLessThan(180);
      }
    }
    const peakDunk = Math.min(...Array.from({ length: 60 }, (_, i) => shooter(at(step(), 0.54 + (i * 0.2) / 60)).pose.dy ?? 0));
    expect(peakDunk).toBeLessThan(-100);
    const peakThree = Math.min(...Array.from({ length: 60 }, (_, i) => shooter(at(three(), 0.46 + (i * 0.2) / 60)).pose.dy ?? 0));
    expect(peakThree).toBeLessThan(-40);
  });

  it('a three is taken from behind the arc, a dunk from at the rim', () => {
    const t = shooter(at(three(), 0.56));
    expect(Math.abs(RIM_X.R - t.x)).toBeGreaterThan(190);
    const d = shooter(at(step(), 0.7));
    expect(Math.abs(RIM_X.R - d.x)).toBeLessThan(70);
  });

  it('every animation style looks different from the others at the moment it matters', () => {
    const dunks = ['two-hand', 'tomahawk', 'windmill', 'spin'].map((v) => JSON.stringify(shooter(at(step(), 0.64, { styles: { dunk: v } })).pose));
    expect(new Set(dunks).size).toBe(4);
    const shots = ['set', 'fadeaway', 'one-leg', 'stepback'].map((v) => JSON.stringify(shooter(at(three(), 0.56, { styles: { shot: v } })).pose) + shooter(at(three(), 0.56, { styles: { shot: v } })).x);
    expect(new Set(shots).size).toBe(4);
    const dribbles = ['standard', 'crossover', 'behind', 'legs'].map((v) => JSON.stringify(at(step(), 0.1, { styles: { dribble: v } }).ball) + JSON.stringify(shooter(at(step(), 0.1, { styles: { dribble: v } })).pose));
    expect(new Set(dribbles).size).toBe(4);
    const passes = ['chest', 'bounce', 'behind', 'nolook'].map((v) => JSON.stringify(at(step(), 0.14, { teamSize: 2, styles: { pass: v } })));
    expect(new Set(passes).size).toBe(4);
    const cel = ['fist', 'flex', 'shimmy'].map((v) => JSON.stringify(shooter(at(step(), 0.9, { styles: { celebration: v } })).pose));
    expect(new Set(cel).size).toBe(3);
  });

  it('the crowd gets louder when it goes in', () => {
    expect(at(step(), MAKE_AT.dunk + 0.03).crowd).toBeGreaterThan(at(step(), 0.2).crowd + 0.4);
  });

  it('nothing teleports or breaks: every style combination is finite and smooth over the whole shot', () => {
    for (const s of [step(), three(), step({ side: 'B' })]) {
      for (const dunk of ['two-hand', 'tomahawk', 'windmill', 'spin']) {
        for (const shot of ['set', 'fadeaway', 'one-leg', 'stepback']) {
          let prev: number | null = null;
          for (let ms = 0; ms <= s.durationMs; ms += 70) {
            const f = frameAt(s, { teamSize: 2, styles: { dunk, shot, dribble: 'crossover', pass: 'bounce', celebration: 'shimmy' } }, ms);
            for (const a of f.actors) for (const v of [a.x, a.y, a.pose.dy ?? 0, a.pose.lean ?? 0]) expect(Number.isFinite(v)).toBe(true);
            expect(Number.isFinite(f.ball.x) && Number.isFinite(f.ball.y)).toBe(true);
            const x = shooter(f).x;
            if (prev !== null) expect(Math.abs(x - prev)).toBeLessThan(45); // no teleporting between 70 ms frames
            prev = x;
          }
        }
      }
    }
  });

  it('the camera keeps the shooter and the hoop in view the whole time, and moves smoothly', () => {
    for (const s of [step(), three(), step({ side: 'B' }), three({ side: 'B' })]) {
      let prev: number | null = null;
      for (let ms = 0; ms <= s.durationMs; ms += 66) {
        const f = frameAt(s, { teamSize: 2 }, ms);
        const cam = cameraX(f);
        const sh = f.actors.find((a) => a.role === 'shooter')!;
        expect(cam).toBeGreaterThanOrEqual(0);
        expect(cam + CAMERA_W).toBeLessThanOrEqual(STAGE_W);
        expect(sh.x).toBeGreaterThan(cam - 10);
        expect(sh.x).toBeLessThan(cam + CAMERA_W + 10);
        const rim = RIM_X[f.hoop.side];
        expect(rim).toBeGreaterThan(cam - 10);
        expect(rim).toBeLessThan(cam + CAMERA_W + 10);
        if (prev !== null) expect(Math.abs(cam - prev)).toBeLessThan(30);
        prev = cam;
      }
    }
  });
});
