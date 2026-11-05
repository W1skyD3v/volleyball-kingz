import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as RouterMock from 'expo-router';
import React from 'react';
import Courts from '../app/(tabs)/index';
import Profile from '../app/(tabs)/profile';
import Runs from '../app/(tabs)/runs';
import GameScreen from '../app/game/[id]';
import Login from '../app/login';
import { createMemoryBackend } from '../src/backend/memory';
import type { Backend } from '../src/backend/types';
import { renderWithApp } from '../test-utils/helpers';

const rm = RouterMock as unknown as { __setParams(p: object): void; __router: { push: jest.Mock } };
const press = async (id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};
const text = (id: string) => [screen.getByTestId(id).props.children].flat().join('');
beforeEach(() => jest.clearAllMocks());

async function demo() {
  const b = createMemoryBackend();
  await b.createProfile('Tester', new Date('1990-01-01T00:00:00Z'));
  return b;
}

/** Wrap a backend so games look like real two-device games where this phone captains `side`. */
function asCaptain(b: Backend, side: 'A' | 'B'): Backend {
  const decorate = async (g: Awaited<ReturnType<Backend['getGame']>>) => ({
    ...g,
    mySide: side,
    players: { A: [{ id: 'me', name: 'Tester' }], B: [{ id: 'u-bo', name: 'Bo' }] },
  });
  return { ...b, getGame: async (id) => decorate(await b.getGame(id)), sendEvent: async (id, ev) => decorate(await b.sendEvent(id, ev)) };
}

describe('two-device game screen', () => {
  it('shows only the captain’s own controls and says who it is waiting for', async () => {
    const b = await demo();
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    rm.__setParams({ id: g.id });
    await renderWithApp(<GameScreen />, { backend: asCaptain(b, 'B') });
    await waitFor(() => screen.getByTestId('score-A'));
    expect(screen.queryByTestId('claim-A-1')).toBeNull();
    expect(screen.getByTestId('claim-B-1')).toBeTruthy();
    await press('claim-B-1');
    expect(screen.queryByTestId('confirm-point')).toBeNull(); // B made the claim; A must confirm
    expect(screen.getByText(/Waiting for Side A/)).toBeTruthy();
  });

  it('lets the captain say who scored on a team game, records it, and never guesses on a solo team', async () => {
    const b = await demo();
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    rm.__setParams({ id: g.id });
    const sent: unknown[] = [];
    const twoPerSide = (rec: Awaited<ReturnType<Backend['getGame']>>) => ({
      ...rec,
      mySide: 'A' as const,
      players: { A: [{ id: 'me', name: 'Tester' }, { id: 'u-mate', name: 'Mate' }], B: [{ id: 'u-bo', name: 'Bo' }, { id: 'u-cy', name: 'Cy' }] },
    });
    const wrapped: Backend = { ...b, getGame: async (id) => twoPerSide(await b.getGame(id)), sendEvent: async (id, ev) => { sent.push(ev); return twoPerSide(await b.sendEvent(id, ev)); } };
    await renderWithApp(<GameScreen />, { backend: wrapped });
    await waitFor(() => screen.getByTestId('claim-A-1'));
    await press('claim-A-1'); // no one picked: nothing is guessed
    expect(sent[0]).toEqual({ type: 'claim_point', side: 'A', points: 1 });
  });

  it('records the picked scorer on the claim', async () => {
    const b = await demo();
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    rm.__setParams({ id: g.id });
    const sent: { scorer?: string }[] = [];
    const twoPerSide = (rec: Awaited<ReturnType<Backend['getGame']>>) => ({ ...rec, mySide: 'A' as const, players: { A: [{ id: 'me', name: 'Tester' }, { id: 'u-mate', name: 'Mate' }], B: [{ id: 'u-bo', name: 'Bo' }] } });
    const wrapped: Backend = { ...b, getGame: async (id) => twoPerSide(await b.getGame(id)), sendEvent: async (id, ev) => { sent.push(ev as { scorer?: string }); return twoPerSide(await b.sendEvent(id, ev)); } };
    await renderWithApp(<GameScreen />, { backend: wrapped });
    await waitFor(() => screen.getByTestId('scorer-A-u-mate'));
    await press('scorer-A-u-mate');
    await press('claim-A-1');
    expect(sent[0]!.scorer).toBe('u-mate');
    const state = (await b.getGame(g.id)).state;
    expect(state.pending?.scorer).toBe('u-mate');
  });

  it('lets a player rate the other players after the game (bots are not rateable)', async () => {
    const b = await demo();
    const spy = jest.spyOn(b, 'ratePlayer');
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'quick' });
    await b.sendEvent(g.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 1 } });
    await b.sendEvent(g.id, { type: 'confirm_proposed', side: 'B' });
    rm.__setParams({ id: g.id });
    await renderWithApp(<GameScreen />, { backend: asCaptain(b, 'A') });
    await waitFor(() => screen.getByTestId('rate-u-bo-4'));
    await press('rate-u-bo-4');
    expect(spy).toHaveBeenCalledWith(g.id, 'u-bo', 4);
  });
});

describe('run board: start a game from a run', () => {
  it('host starts a game and is sent to it', async () => {
    const b = await demo();
    await b.createRun({ courtId: 'c1', startsAt: Date.now() + 1000, tier: 1, lane: 'casual', presetId: '7-1s-w1' });
    await renderWithApp(<Runs />, { backend: b });
    await waitFor(() => screen.getByText(/Start game \(1\/2\)/));
    await act(async () => {
      fireEvent.press(screen.getByText(/Start game \(1\/2\)/));
    });
    await waitFor(() => expect(rm.__router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/game\/g-/)));
  });
});

describe('courts: check-out and reporting a court', () => {
  it('checks in, then leaves; and can report a court problem', async () => {
    const b = await demo();
    await renderWithApp(<Courts />, { backend: b });
    await waitFor(() => screen.getByTestId('checkin-c1'));
    await press('checkin-c1');
    await waitFor(() => screen.getByTestId('checkout-c1'));
    await press('checkout-c1');
    await waitFor(() => expect(screen.queryByTestId('checkout-c1')).toBeNull());
    expect(await b.myCheckInCourtId()).toBeNull();
    await press('report-court-c1');
    expect(rm.__router.push).toHaveBeenCalledWith({ pathname: '/report', params: { targetType: 'court', targetId: 'c1' } });
  });
  it('sorts by distance after the player asks (foreground fix only)', async () => {
    await renderWithApp(<Courts />);
    await waitFor(() => screen.getByTestId('near-me'));
    await press('near-me');
    await waitFor(() => expect(screen.getAllByText(/m away/).length).toBeGreaterThan(0));
  });
});

describe('avatar editor', () => {
  it('saves free cosmetic choices to the profile', async () => {
    const b = await demo();
    await renderWithApp(<Profile />, { backend: b });
    await waitFor(() => screen.getByTestId('jersey-primary-#ef4444'));
    await press('jersey-primary-#ef4444');
    await press('number-up');
    await waitFor(async () => {
      const a = (await b.getProfile())!.avatar;
      expect(a.jersey.primary).toBe('#ef4444');
      expect(a.jersey.number).toBe(24);
    });
    expect((await b.getProfile())!.goldBought).toBe(0);
  });
});

describe('login screen', () => {
  it('sends a code, then verifies it', async () => {
    const b = createMemoryBackend();
    const send = jest.fn(async () => undefined);
    const verify = jest.fn(async () => undefined);
    const fake = { ...b, supportsAuth: true, signInWithEmail: send, verifyEmailCode: verify } as Backend;
    await renderWithApp(<Login />, { backend: fake, birth: null });
    fireEvent.changeText(screen.getByTestId('email'), 'ana@example.com');
    await press('send-code');
    expect(send).toHaveBeenCalledWith('ana@example.com');
    fireEvent.changeText(screen.getByTestId('code'), '123456');
    await press('verify-code');
    expect(verify).toHaveBeenCalledWith('ana@example.com', '123456');
  });
  it('shows an error when the code is wrong', async () => {
    const b = createMemoryBackend();
    const fake = { ...b, signInWithEmail: async () => undefined, verifyEmailCode: async () => { throw new Error('Token has expired or is invalid'); } } as Backend;
    await renderWithApp(<Login />, { backend: fake, birth: null });
    fireEvent.changeText(screen.getByTestId('email'), 'a@b.co');
    await press('send-code');
    fireEvent.changeText(screen.getByTestId('code'), '000000');
    await press('verify-code');
    await waitFor(() => expect(text('login-error')).toMatch(/invalid/));
  });
});
