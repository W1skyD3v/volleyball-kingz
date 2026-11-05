import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as RouterMock from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';
import Friends from '../app/(tabs)/friends';
import Profile from '../app/(tabs)/profile';
import Runs from '../app/(tabs)/runs';
import GameScreen from '../app/game/[id]';
import { createMemoryBackend } from '../src/backend/memory';
import type { Backend } from '../src/backend/types';
import { renderWithApp } from '../test-utils/helpers';

const rm = RouterMock as unknown as { __setParams(p: object): void };
const press = async (id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};
const text = (id: string) => [screen.getByTestId(id).props.children].flat().join('');
beforeEach(() => jest.clearAllMocks());

async function demo(birth = '1990-01-01T00:00:00Z') {
  const b = createMemoryBackend();
  await b.createProfile('Tester', new Date(birth));
  return b;
}

describe('friends', () => {
  it('shows my code, accepts a request, and sees friends by code only', async () => {
    const b = await demo();
    await renderWithApp(<Friends />, { backend: b });
    await waitFor(() => expect(text('my-code')).toBe('DEMO1234'));
    await press('accept-u-cy');
    await waitFor(() => screen.getByTestId('friend-u-cy'));
    expect(screen.getByTestId('friend-u-ana')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('friend-code'), 'NOSUCHCD');
    await press('send-request');
    await waitFor(() => expect(text('friends-msg')).toMatch(/No player with that code/));

    fireEvent.changeText(screen.getByTestId('friend-code'), 'bobobo22');
    await press('send-request');
    await waitFor(() => expect(screen.getByText(/Waiting for Bo/)).toBeTruthy());
  });

  it('an adult cannot add a minor by code, and sees the same error as for an unknown code', async () => {
    await renderWithApp(<Friends />, { backend: await demo() });
    await waitFor(() => screen.getByTestId('friend-code'));
    fireEvent.changeText(screen.getByTestId('friend-code'), 'TEEN0001');
    await press('send-request');
    await waitFor(() => expect(text('friends-msg')).toMatch(/No player with that code/));
  });

  it('removes a friend', async () => {
    await renderWithApp(<Friends />, { backend: await demo() });
    await waitFor(() => screen.getByTestId('remove-u-ana'));
    await press('remove-u-ana');
    await waitFor(() => expect(screen.queryByTestId('friend-u-ana')).toBeNull());
  });
});

describe('invite-only private runs', () => {
  it('the host invites a friend and the button shows it was sent', async () => {
    const b = await demo();
    await b.createRun({ courtId: 'c1', startsAt: Date.now() + 1000, tier: 2, lane: 'private', presetId: '7-1s-w1' });
    const spy = jest.spyOn(b, 'inviteToRun');
    await renderWithApp(<Runs />, { backend: b });
    await waitFor(() => screen.getByText(/Invite-only/));
    const invite = await screen.findByTestId(/^invite-r-\d+-u-ana$/);
    await act(async () => {
      fireEvent.press(invite);
    });
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^r-/), 'u-ana');
    await waitFor(() => expect(screen.getByText('Invited')).toBeTruthy());
  });

  it('only friends can be invited and only on private runs', async () => {
    const b = await demo();
    await b.createRun({ courtId: 'c1', startsAt: Date.now() + 1000, tier: 2, lane: 'casual', presetId: '7-1s-w1' });
    await b.createRun({ courtId: 'c1', startsAt: Date.now() + 1000, tier: 2, lane: 'private', presetId: '7-1s-w1' });
    const runs = await b.listRuns();
    const casual = runs.find((r) => r.lane === 'casual' && r.mine)!;
    const priv = runs.find((r) => r.lane === 'private')!;
    await expect(b.inviteToRun(casual.id, 'u-ana')).rejects.toThrow('not_your_private_run');
    await expect(b.inviteToRun(priv.id, 'u-dee')).rejects.toThrow('not_friends');
    await expect(b.inviteToRun(priv.id, 'u-ana')).resolves.toBeUndefined();
  });
});

describe('consent lobby', () => {
  function lobbyBackend(b: Backend, accepted: Record<string, boolean>): Backend {
    const view = async (id: string) => {
      const g = await b.getGame(id);
      return {
        ...g,
        state: { ...g.state, status: 'lobby' as const },
        players: { A: [{ id: 'me', name: 'Tester', accepted: accepted.me }], B: [{ id: 'u-bo', name: 'Bo', accepted: accepted['u-bo'] }] },
      };
    };
    return { ...b, getGame: view, acceptGame: jest.fn(async (id: string) => { accepted.me = true; return view(id); }), declineGame: jest.fn(async (id: string) => view(id)) };
  }

  it('shows who has accepted, hides scoring, and lets me accept or decline', async () => {
    const b = await demo();
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    rm.__setParams({ id: g.id });
    const lb = lobbyBackend(b, { me: false, 'u-bo': true });
    await renderWithApp(<GameScreen />, { backend: lb });
    await waitFor(() => screen.getByText('Waiting for everyone to accept'));
    expect(text('seat-u-bo')).toContain('✓');
    expect(text('seat-me')).toContain('…');
    expect(screen.queryByTestId('claim-A-1')).toBeNull();
    await press('accept-game');
    expect(lb.acceptGame).toHaveBeenCalledWith(g.id);
    await waitFor(() => expect(screen.queryByTestId('accept-game')).toBeNull());
    expect(screen.getByText(/You accepted/)).toBeTruthy();
  });

  it('declining calls the backend', async () => {
    const b = await demo();
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    rm.__setParams({ id: g.id });
    const lb = lobbyBackend(b, { me: false, 'u-bo': false });
    await renderWithApp(<GameScreen />, { backend: lb });
    await waitFor(() => screen.getByTestId('decline-game'));
    await press('decline-game');
    expect(lb.declineGame).toHaveBeenCalledWith(g.id);
  });

  it('demo backend: placeholder guests auto-accept, and accepting a game that is not in the lobby is refused', async () => {
    const b = await demo();
    await b.createRun({ courtId: 'c1', startsAt: Date.now(), tier: 1, lane: 'casual', presetId: '7-1s-w1' });
    const run = (await b.listRuns()).find((r) => r.mine)!;
    const started = await b.startGameFromRun(run.id, 'live');
    expect(started.state.status).toBe('active'); // only placeholder guests, which count as accepted
    const solo = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    await expect(b.acceptGame(solo.id)).rejects.toThrow('not_in_lobby');
  });
});

describe('leaderboard, history and deletion options', () => {
  it('shows the leaderboard with deleted players flagged and my history without private games leaking', async () => {
    const b = await demo();
    await b.createGame({ courtId: 'c1', lane: 'private', tier: 1, presetId: '7-1s-w1', mode: 'quick' }).then(async (g) => {
      await b.sendEvent(g.id, { type: 'propose_final', side: 'A', score: { A: 7, B: 2 } });
      await b.sendEvent(g.id, { type: 'confirm_proposed', side: 'B' });
    });
    await renderWithApp(<Profile />, { backend: b });
    await waitFor(() => screen.getByTestId('board-1'));
    expect(screen.getByText(/Former player \(demo\) \(account deleted\)/)).toBeTruthy();
    await waitFor(() => expect(text('stat-1-private')).toContain('1-0'));
    await press('board-tier-3');
    await waitFor(() => expect(text('board-1')).toContain('1350')); // demo rows shift by tier
  });

  it('deleting passes the keep-name choice through', async () => {
    const b = await demo();
    const spy = jest.spyOn(b, 'deleteAccount');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      void buttons?.find((x) => x.style === 'destructive')?.onPress?.();
    });
    await renderWithApp(<Profile />, { backend: b });
    await waitFor(() => screen.getByTestId('delete-account'));
    await press('delete-account');
    expect(spy).toHaveBeenLastCalledWith(true);
    alert.mockRestore();
  });

  it('with keep-name off, full erasure is requested', async () => {
    const b = await demo();
    const spy = jest.spyOn(b, 'deleteAccount');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      void buttons?.find((x) => x.style === 'destructive')?.onPress?.();
    });
    await renderWithApp(<Profile />, { backend: b });
    await waitFor(() => screen.getByTestId('keep-name'));
    await act(async () => {
      fireEvent(screen.getByTestId('keep-name'), 'valueChange', false);
    });
    await press('delete-account');
    expect(spy).toHaveBeenLastCalledWith(false);
    alert.mockRestore();
  });
});
