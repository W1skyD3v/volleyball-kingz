import { createMemoryBackend } from '../src/backend/memory';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const fix = { lat: 34.0488, lng: -118.2518, accuracyM: 10 }; // Pershing Square demo court c1
const adult = new Date('1990-01-01T00:00:00Z');
const teen = new Date('2010-01-01T00:00:00Z');

async function setup(birth = adult) {
  const b = createMemoryBackend({ now: () => NOW });
  await b.createProfile('Tester', birth);
  return b;
}

describe('memory backend', () => {
  it('refuses under-13 accounts', async () => {
    const b = createMemoryBackend({ now: () => NOW });
    await expect(b.createProfile('Kid', new Date('2018-01-01T00:00:00Z'))).rejects.toThrow('age_blocked');
    expect(await b.getProfile()).toBeNull();
  });

  it('checks in near a court, refuses far away', async () => {
    const b = await setup();
    expect((await b.checkIn('c1', { lat: 34.2, lng: -118.2518 })).reason).toBe('too_far');
    expect((await b.checkIn('c1', fix)).ok).toBe(true);
    expect(await b.myCheckInCourtId()).toBe('c1');
  });

  it('adults never see the minor in headcount or runs; minors see only minor runs', async () => {
    const adultB = await setup();
    const c1 = (await adultB.listCourts()).find((c) => c.id === 'c1')!;
    expect(c1.headcount).toBe(2); // Ana + Bo, not Teen Hooper
    expect((await adultB.listRuns()).map((r) => r.id)).toEqual(['r1']);
    const teenB = await setup(teen);
    expect((await teenB.listCourts()).find((c) => c.id === 'c1')!.headcount).toBe(3);
    expect((await teenB.listRuns()).map((r) => r.id)).toEqual(['r2']); // runs are separated by age band
    await teenB.joinRun('r1'); // joining an adult run is silently refused
    expect((await teenB.listRuns()).every((r) => r.id !== 'r1')).toBe(true);
  });

  it('blocking a host hides their runs', async () => {
    const b = await setup();
    await b.block('u-ana');
    expect(await b.listRuns()).toEqual([]);
  });

  it('overall rating appears after 10 ranked games in one size; a new size starts from it, not from 1200', async () => {
    const b = await setup();
    await b.checkIn('c1', fix);
    const play = async (tier: 1 | 2) => {
      const g = await b.createGame({ courtId: 'c1', lane: 'ranked', tier, presetId: '7-1s-w1', mode: 'quick' });
      await b.sendEvent(g.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 2 } });
      await b.sendEvent(g.id, { type: 'confirm_proposed', side: 'B' });
    };
    expect((await b.getRatings()).overall).toBeNull();
    for (let i = 0; i < 10; i++) await play(1);
    const r1 = await b.getRatings();
    expect(r1.overall).not.toBeNull();
    const tier1 = Number(r1.ranked.find((r) => r.tier === 1)!.label.split(' ')[0]);
    expect(r1.overall!.rating).toBe(tier1);
    await play(2);
    const tier2 = (await b.getRatings()).ranked.find((r) => r.tier === 2)!;
    // a fresh player's first win moves 1200 up about 100; starting from tier 1's rating it ends well above that
    expect(Number(tier2.label.split(' ')[0])).toBeGreaterThan(tier1);
  });

  it('ranked requires a live check-in; 5v5 requires a confirmed full court', async () => {
    const b = await setup();
    const g = { courtId: 'c1', lane: 'ranked' as const, tier: 1 as const, presetId: '11-1s-w2', mode: 'live' as const };
    await expect(b.createGame(g)).rejects.toThrow('ranked_requires_check_in');
    await b.checkIn('c1', fix);
    await expect(b.createGame(g)).resolves.toBeDefined();
    await expect(b.createGame({ ...g, courtId: 'c3', lane: 'casual', tier: 5 })).rejects.toThrow('five_on_five_needs_full_court');
    await b.checkIn('c1', fix);
    await expect(b.createGame({ ...g, lane: 'casual', tier: 5 })).resolves.toBeDefined(); // c1 is a confirmed full court
  });

  it('a final ranked game moves rating and awards gold; casual is unrated by default', async () => {
    const b = await setup();
    await b.checkIn('c1', fix);
    for (const lane of ['ranked', 'casual'] as const) {
      const rec = await b.createGame({ courtId: 'c1', lane, tier: 1, presetId: '7-1s-w1', mode: 'quick' });
      await b.sendEvent(rec.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 2 } });
      const done = await b.sendEvent(rec.id, { type: 'confirm_proposed', side: 'B' });
      // first game of the day also pays the +10 bonus
      expect(done.outcome!.goldAwarded).toBe(lane === 'ranked' ? 25 : 10);
      expect(done.outcome!.unrated).toBe(lane === 'casual');
    }
    const r = await b.getRatings();
    expect(r.ranked).toHaveLength(1);
    expect(r.ranked[0]!.label).toMatch(/\+\/-/);
    expect(r.ranked[0]!.label).toMatch(/provisional/);
    expect(r.casualElo).toEqual([]);
    expect((await b.getProfile())!.goldEarned).toBe(35); // 25 ranked (incl. first-game bonus) + 10 casual
    expect((await b.getProfile())!.goldBought).toBe(0);
    expect(await b.tierUsage()).toHaveLength(2);
  });

  it('opted-in casual games change a separate Casual Elo, never the ranked rating', async () => {
    const b = await setup();
    await b.setCasualEloOptIn(true);
    const rec = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 2, presetId: '7-1s-w1', mode: 'quick' });
    await b.sendEvent(rec.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 2 } });
    await b.sendEvent(rec.id, { type: 'confirm_proposed', side: 'B' });
    const r = await b.getRatings();
    expect(r.casualElo[0]!.rating).toBeGreaterThan(1200);
    expect(r.ranked).toEqual([]);
  });

  it('a disputed game earns nothing', async () => {
    const b = await setup();
    const rec = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'quick' });
    await b.sendEvent(rec.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 2 } });
    const out = await b.sendEvent(rec.id, { type: 'dispute', side: 'B', reason: 'no' });
    expect(out.outcome).toBeUndefined();
    expect((await b.getProfile())!.goldEarned).toBe(0);
  });

  it('report and delete account', async () => {
    const b = await setup();
    await b.report({ targetType: 'run', targetId: 'r1', reason: 'spam', safetyEscalation: false });
    await b.deleteAccount();
    expect(await b.getProfile()).toBeNull();
  });
});
