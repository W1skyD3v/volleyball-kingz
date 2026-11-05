import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as RouterMock from 'expo-router';
import React from 'react';
import Courts from '../app/(tabs)/index';
import Friends from '../app/(tabs)/friends';
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
beforeEach(() => jest.clearAllMocks());

async function demo() {
  const b = createMemoryBackend();
  await b.createProfile('Tester', new Date('1990-01-01T00:00:00Z'));
  return b;
}

describe('load failures show a message and a retry instead of crashing', () => {
  it('courts: shows the error, then recovers on retry', async () => {
    const b = await demo();
    let fail = true;
    const flaky: Backend = {
      ...b,
      listCourts: async (near) => {
        if (fail) throw new Error('Network request failed');
        return b.listCourts(near);
      },
    };
    await renderWithApp(<Courts />, { backend: flaky });
    await waitFor(() => screen.getByTestId('load-error'));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    fail = false;
    await press('retry');
    await waitFor(() => expect(screen.queryByTestId('load-error')).toBeNull());
    expect(screen.getByTestId('checkin-c1')).toBeTruthy();
  });

  it('friends: a failing list shows the same retry card', async () => {
    const b = await demo();
    const broken: Backend = { ...b, listFriends: async () => { throw new Error('offline'); } };
    await renderWithApp(<Friends />, { backend: broken });
    await waitFor(() => screen.getByTestId('load-error'));
  });
});

describe('void needs both captains (game screen)', () => {
  it('shows the request to the other side, who can agree', async () => {
    const b = await demo();
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    await b.sendEvent(g.id, { type: 'claim_point', side: 'A', points: 1 });
    await b.sendEvent(g.id, { type: 'confirm_point', side: 'B' });
    await b.sendEvent(g.id, { type: 'dispute', side: 'B', reason: 'x' });
    rm.__setParams({ id: g.id });
    await renderWithApp(<GameScreen />, { backend: b });
    await waitFor(() => screen.getByTestId('void'));
    expect(screen.getByText('Ask to void')).toBeTruthy();
    await press('void'); // demo plays both captains: this is side A asking
    await waitFor(() => screen.getByTestId('void-banner'));
    expect(screen.getByText(/Side A asked to void/)).toBeTruthy();
    expect(screen.getByText('Status: disputed')).toBeTruthy(); // not voided yet
    await press('void-agree'); // side B agrees
    await waitFor(() => expect(screen.getByText('Status: voided')).toBeTruthy());
  });

  it('the safety alert button is announced properly to screen readers', async () => {
    const b = await demo();
    const g = await b.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: '7-1s-w1', mode: 'live' });
    rm.__setParams({ id: g.id });
    await renderWithApp(<GameScreen />, { backend: b });
    await waitFor(() => screen.getByTestId('alert-button'));
    expect(screen.getByTestId('alert-button').props.accessibilityLabel).toBe('Report a safety problem');
  });
});
