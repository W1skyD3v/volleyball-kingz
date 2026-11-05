import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import Closet from '../app/(tabs)/closet';
import { createMemoryBackend } from '../src/backend/memory';
import { safeAvatarSvg } from '../src/ui/Avatar';
import { defaultAvatarConfig } from '@vk/avatar';
import { renderWithApp } from '../test-utils/helpers';

const press = async (id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};
const text = (id: string) => [screen.getByTestId(id).props.children].flat().join('');

async function demo() {
  const b = createMemoryBackend();
  await b.createProfile('Tester', new Date('1990-01-01T00:00:00Z'));
  await b.checkIn('c1', { lat: 34.0488, lng: -118.2518, accuracyM: 10 });
  return b;
}
async function earn(b: Awaited<ReturnType<typeof demo>>, games: number) {
  for (let i = 0; i < games; i++) {
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'quick' });
    await b.sendEvent(g.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 2 } });
    await b.sendEvent(g.id, { type: 'confirm_proposed', side: 'B' });
  }
}

describe('closet screen', () => {
  it('a new player owns the starter pack, has 0 Gold, and cannot buy yet', async () => {
    const b = await demo();
    await renderWithApp(<Closet />, { backend: b });
    await waitFor(() => screen.getByTestId('item-jersey-classic'));
    expect(text('closet-gold')).toContain('0');
    expect(text('item-jersey-classic')).toContain('(wearing)');
    await press('buy-head-headband');
    await waitFor(() => expect(text('closet-msg')).toMatch(/Not enough Royalty Bucks/));
    expect((await b.getCloset()).owned).not.toContain('head-headband');
  });

  it('premium-only items cannot be bought and say so', async () => {
    const b = await demo();
    await renderWithApp(<Closet />, { backend: b });
    await waitFor(() => screen.getByTestId('item-jersey-royal'));
    expect(screen.queryByTestId('buy-jersey-royal')).toBeNull();
    expect(screen.getAllByText(/Premium, coming later/).length).toBeGreaterThan(0);
    await expect(b.buyItem('jersey-royal')).rejects.toThrow('premium_only');
  });

  it('earned Gold buys, wears and takes off an item; the balance drops by the price', async () => {
    const b = await demo();
    await earn(b, 8); // 20 + 7 x 10 = 90... plus more below
    await earn(b, 2);
    const before = (await b.getCloset()).gold;
    expect(before).toBeGreaterThanOrEqual(100);
    await renderWithApp(<Closet />, { backend: b });
    await waitFor(() => screen.getByTestId('buy-head-headband'));
    await press('buy-head-headband');
    await waitFor(() => expect(text('closet-msg')).toMatch(/Bought Headband/));
    expect((await b.getCloset()).gold).toBe(before - 100);
    await press('wear-head-headband');
    await waitFor(() => expect(text('item-head-headband')).toContain('(wearing)'));
    expect((await b.getCloset()).loadout.headwear).toBe('head-headband');
    await press('unequip-headwear');
    await waitFor(async () => expect((await b.getCloset()).loadout.headwear).toBeUndefined());
  });

  it('cannot own an item twice or wear one you do not own', async () => {
    const b = await demo();
    await expect(b.equipItem('head-cap')).rejects.toThrow('not_owned');
    await expect(b.buyItem('jersey-classic')).rejects.toThrow('already_owned');
    await expect(b.unequipSlot('jersey')).rejects.toThrow('cannot_empty');
  });

  it('animation styles can be previewed before buying, and previewing costs nothing', async () => {
    const b = await demo();
    await renderWithApp(<Closet />, { backend: b });
    await waitFor(() => screen.getByTestId('preview-dunk-windmill'));
    expect(screen.queryByTestId('style-preview')).toBeNull();
    await press('preview-dunk-windmill');
    expect(screen.getByTestId('style-preview')).toBeTruthy();
    await press('preview-dunk-windmill');
    expect(screen.queryByTestId('style-preview')).toBeNull();
    expect((await b.getCloset()).owned).not.toContain('dunk-windmill');
    expect((await b.getCloset()).gold).toBe(0);
    expect(screen.queryByTestId('preview-jersey-classic')).toBeNull(); // plain gear has no preview
  });

  it('a hostile or broken avatar from another player never crashes the screen', () => {
    const bad = { seed: 'x', jersey: { style: 'classic', primary: '"><script>alert(1)</script>', secondary: '#000000', number: 5 }, shorts: { color: '#000000' }, shoes: { style: 'low', color: '#000000' } } as never;
    const svg = safeAvatarSvg(bad);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('<script');
    expect(safeAvatarSvg(null as never)).toContain('<svg');
    expect(safeAvatarSvg(defaultAvatarConfig('ok'))).toContain('<svg');
  });
});
