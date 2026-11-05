import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as RouterMock from 'expo-router';
import React from 'react';
import Courts from '../app/(tabs)/index';
import GameScreen from '../app/game/[id]';
import Onboarding from '../app/onboarding';
import Play from '../app/(tabs)/play';
import ReportScreen from '../app/report';
import Runs from '../app/(tabs)/runs';
import { createMemoryBackend } from '../src/backend/memory';
import { renderWithApp } from '../test-utils/helpers';

const rm = RouterMock as unknown as { __setParams(p: object): void; __router: { push: jest.Mock } };
const press = async (id: string) => {
  await act(async () => {
    fireEvent.press(screen.getByTestId(id));
  });
};

beforeEach(() => jest.clearAllMocks());

describe('onboarding', () => {
  it('turns away a 12 year old and lets an adult in', async () => {
    const { backend } = await renderWithApp(<Onboarding />, { birth: null });
    const fill = async (n: string, y: string) => {
      fireEvent.changeText(screen.getByTestId('name'), n);
      fireEvent.changeText(screen.getByTestId('year'), y);
      fireEvent.changeText(screen.getByTestId('month'), '1');
      fireEvent.changeText(screen.getByTestId('day'), '1');
      await press('continue');
    };
    await fill('Kid', String(new Date().getUTCFullYear() - 10));
    expect(screen.getByText('Sorry, you cannot create an account.')).toBeTruthy();
    expect(await backend.getProfile()).toBeNull();
    await fill('Grown', '1990');
    await waitFor(async () => expect(await backend.getProfile()).not.toBeNull());
  });
});

describe('courts and check-in (location mocked)', () => {
  it('checks in using a foreground fix', async () => {
    await renderWithApp(<Courts />);
    await waitFor(() => expect(screen.getByTestId('headcount-c1')).toBeTruthy());
    expect(screen.getByTestId('headcount-c1').props.children.join('')).toContain('2 here now');
    await press('checkin-c1');
    await waitFor(() => expect(screen.getByText(/Checked in. Valid for 90 minutes./)).toBeTruthy());
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
  });

  it('refuses a check-in from far away', async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({ coords: { latitude: 34.5, longitude: -118.2518, accuracy: 5 } });
    await renderWithApp(<Courts />);
    await waitFor(() => screen.getByTestId('checkin-c1'));
    await press('checkin-c1');
    await waitFor(() => expect(screen.getByText(/Too far from the court/)).toBeTruthy());
  });

  it('explains a denied permission and never asks for background', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    await renderWithApp(<Courts />);
    await waitFor(() => screen.getByTestId('checkin-c1'));
    await press('checkin-c1');
    await waitFor(() => expect(screen.getByText(/Location permission is needed/)).toBeTruthy());
    expect((Location as unknown as Record<string, unknown>).requestBackgroundPermissionsAsync).toBeUndefined();
  });

  it('a minor viewer sees the minor in the headcount, an adult does not', async () => {
    await renderWithApp(<Courts />, { birth: new Date('2010-01-01T00:00:00Z') });
    await waitFor(() => expect(screen.getByTestId('headcount-c1').props.children.join('')).toContain('3 here now'));
  });
});

describe('run board', () => {
  it('joins, leaves and reports a post', async () => {
    await renderWithApp(<Runs />);
    await waitFor(() => screen.getByTestId('join-r1'));
    await press('join-r1');
    await waitFor(() => expect(screen.getByTestId('members-r1').props.children.join('')).toContain('Tester'));
    await press('leave-r1');
    await waitFor(() => screen.getByTestId('join-r1'));
    await press('report-r1');
    expect(rm.__router.push).toHaveBeenCalledWith({ pathname: '/report', params: { targetType: 'run', targetId: 'r1' } });
  });
  it('blocking a host removes the post', async () => {
    await renderWithApp(<Runs />);
    await waitFor(() => screen.getByTestId('block-r1'));
    await press('block-r1');
    await waitFor(() => expect(screen.queryByTestId('join-r1')).toBeNull());
  });
  it('posts a run which the host can cancel', async () => {
    await renderWithApp(<Runs />);
    await waitFor(() => screen.getByTestId('post-run'));
    await press('post-run');
    await waitFor(() => expect(screen.getByText('Cancel run')).toBeTruthy());
  });
});

describe('play: start guards', () => {
  it('ranked without check-in is refused with a reason', async () => {
    await renderWithApp(<Play />);
    await waitFor(() => screen.getByTestId('lane-ranked'));
    fireEvent.press(screen.getByTestId('lane-ranked'));
    await press('start-game');
    await waitFor(() => expect(screen.getByTestId('start-error').props.children).toMatch(/check-in/i));
  });
  it('5v5 is refused on a half court and allowed on a confirmed full court', async () => {
    await renderWithApp(<Play />);
    await waitFor(() => screen.getByText('Echo Park half court'));
    fireEvent.press(screen.getByText('Echo Park half court'));
    fireEvent.press(screen.getByTestId('tier-5'));
    await press('start-game');
    await waitFor(() => expect(screen.getByTestId('start-error').props.children).toMatch(/full court only/));
    expect(rm.__router.push).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Pershing Square')); // demo c1: full court with a confirmation
    await press('start-game');
    await waitFor(() => expect(rm.__router.push).toHaveBeenCalled());
  });
});

async function startedGame(mode: 'live' | 'quick', preset = '7-1s-w1') {
  const backend = createMemoryBackend();
  await backend.createProfile('Tester', new Date('1990-01-01T00:00:00Z'));
  const g = await backend.createGame({ courtId: 'c1', lane: 'casual', tier: 1, presetId: preset, mode });
  rm.__setParams({ id: g.id });
  await renderWithApp(<GameScreen />, { backend });
  await waitFor(() => screen.getByTestId('score-A'));
  return backend;
}
const scoreText = () => `${screen.getByTestId('score-A').props.children} - ${screen.getByTestId('score-B').props.children}`;

describe('live scoring screen', () => {
  it('needs the other side to confirm each point, then plays out to a confirmed final', async () => {
    const backend = await startedGame('live');
    await press('claim-A-1');
    expect(scoreText()).toBe('0 - 0');
    await press('confirm-point');
    expect(scoreText()).toBe('1 - 0');
    for (let i = 0; i < 6; i++) {
      await press('claim-A-1');
      await press('confirm-point');
    }
    expect(scoreText()).toBe('7 - 0');
    expect(screen.getByTestId('status').props.children.join('')).toContain('awaiting_final');
    await press('final-A');
    await press('final-B');
    await waitFor(() => expect(screen.getByTestId('rating-line')).toBeTruthy());
    expect(screen.getByTestId('gold-award').props.children.join('')).toContain('+20');
    expect((await backend.getProfile())!.goldEarned).toBe(20);
  });

  it('a dispute freezes the game', async () => {
    await startedGame('live');
    await press('claim-A-1');
    await press('dispute');
    expect(screen.getByTestId('status').props.children.join('')).toContain('disputed');
    expect(screen.queryByTestId('claim-A-1')).toBeNull();
    expect(screen.getByText('Game frozen: dispute')).toBeTruthy();
  });

  it('the hidden alert button opens a safety report', async () => {
    await startedGame('live');
    await press('alert-button');
    expect(rm.__router.push).toHaveBeenCalledWith({ pathname: '/report', params: expect.objectContaining({ targetType: 'game', safety: '1' }) });
  });
});

describe('quick scoring screen', () => {
  it('rejects an impossible final and accepts a valid one', async () => {
    await startedGame('quick');
    fireEvent.changeText(screen.getByTestId('quick-a'), '5');
    fireEvent.changeText(screen.getByTestId('quick-b'), '3');
    await press('propose');
    expect(screen.getByTestId('game-error')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('quick-a'), '7');
    await press('propose');
    await press('confirm-proposed');
    await waitFor(() => expect(screen.getByTestId('rating-line')).toBeTruthy());
  });
});

describe('report screen', () => {
  it('sends a safety escalation', async () => {
    rm.__setParams({ targetType: 'game', targetId: 'g1', safety: '1' });
    const backend = createMemoryBackend();
    const spy = jest.spyOn(backend, 'report');
    await renderWithApp(<ReportScreen />, { backend });
    await press('send-report');
    await waitFor(() => expect(screen.getByTestId('report-sent')).toBeTruthy());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ safetyEscalation: true, targetType: 'game', reason: 'unsafe' }));
  });
});
