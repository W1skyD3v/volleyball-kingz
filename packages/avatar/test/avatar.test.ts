import { describe, expect, it } from 'vitest';
import { AvatarConfigSchema, BEARD_STYLES, HAIR_STYLES, SKIN_TONES, defaultAvatarConfig, lookFromSeed, renderAvatarSvg } from '../src/index.js';

describe('avatar', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = renderAvatarSvg(defaultAvatarConfig('king'));
    expect(renderAvatarSvg(defaultAvatarConfig('king'))).toBe(a);
    expect(renderAvatarSvg(defaultAvatarConfig('queen'))).not.toBe(a);
  });
  it('draws every look: skin tones, hair styles and beards render and differ', () => {
    const base = defaultAvatarConfig('x');
    const seen = new Set<string>();
    for (const hair of HAIR_STYLES) for (const beard of BEARD_STYLES) seen.add(renderAvatarSvg({ ...base, look: { skin: 2, hair, hairColor: 1, beard } }));
    expect(seen.size).toBe(HAIR_STYLES.length * BEARD_STYLES.length);
    for (let skin = 0; skin < SKIN_TONES.length; skin++) expect(renderAvatarSvg({ ...base, look: { skin, hair: 'short', hairColor: 0, beard: 'none' } })).toContain(SKIN_TONES[skin]);
  });
  it('an old config without a look still renders, with a stable face derived from its seed', () => {
    const old = defaultAvatarConfig('legacy');
    delete old.look;
    expect(AvatarConfigSchema.safeParse(old).success).toBe(true);
    expect(renderAvatarSvg(old)).toBe(renderAvatarSvg(old));
    expect(lookFromSeed('legacy')).toEqual(lookFromSeed('legacy'));
  });
  it('is small: a full avatar is under 14 KB of SVG', () => {
    expect(renderAvatarSvg(defaultAvatarConfig('size'), { headwear: 'crown', accessory: 'chain', jersey: 'royal' }).length).toBeLessThan(14_000);
  });
  it('layers jersey, shorts and shoes with configured colours', () => {
    const cfg = defaultAvatarConfig('x');
    cfg.jersey.primary = '#ff0000';
    cfg.shoes = { style: 'high', color: '#00ff00' };
    const svg = renderAvatarSvg(cfg);
    for (const id of ['jersey', 'shorts', 'legs']) expect(svg).toContain(`id="${id}"`);
    expect(svg).toContain('#ff0000');
    expect(svg).toContain('#00ff00');
    expect(svg.startsWith('<svg')).toBe(true);
  });
  it('rejects non-hex colours so config cannot inject SVG', () => {
    const cfg = defaultAvatarConfig('x');
    cfg.shorts.color = '"/><script>alert(1)</script>';
    expect(() => renderAvatarSvg(cfg)).toThrow();
    expect(AvatarConfigSchema.safeParse(cfg).success).toBe(false);
  });
  it('draws worn cosmetics as layers and ignores unknown variants (no markup injection)', () => {
    const cfg = defaultAvatarConfig('x');
    const base = renderAvatarSvg(cfg);
    expect(base).not.toContain('id="headwear"');
    const dressed = renderAvatarSvg(cfg, { headwear: 'crown', accessory: 'chain', shorts: 'stripe', jersey: 'royal', shoes: 'high' });
    for (const id of ['headwear', 'accessory']) expect(dressed).toContain(`id="${id}"`);
    expect(dressed).toContain('#4c1d95'); // royal jersey
    expect(renderAvatarSvg(cfg, { headwear: '"/><script>x</script>', accessory: 'nope' })).toBe(base);
  });
});
