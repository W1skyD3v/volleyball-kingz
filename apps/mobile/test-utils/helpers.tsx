import { act, render } from '@testing-library/react-native';
import React from 'react';
import { createMemoryBackend } from '../src/backend/memory';
import type { Backend } from '../src/backend/types';
import { AppProvider } from '../src/state/AppState';

/** Renders under the provider with a signed-in adult by default (pass birth: null for no profile). */
export async function renderWithApp(ui: React.ReactElement, opts: { birth?: Date | null; backend?: Backend } = {}) {
  const backend = opts.backend ?? createMemoryBackend();
  if (opts.birth !== null && !(await backend.getProfile())) await backend.createProfile('Tester', opts.birth ?? new Date('1990-01-01T00:00:00Z'));
  render(<AppProvider backend={backend}>{ui}</AppProvider>);
  await act(async () => {}); // flush the provider's initial profile load
  return { backend };
}
