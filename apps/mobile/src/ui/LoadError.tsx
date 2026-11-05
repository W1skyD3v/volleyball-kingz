import React from 'react';
import { Body, Button, Card, Dim, colors } from './kit';

/** Shown when a load fails: plain words, one button. */
export function LoadError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <Card>
      <Body style={{ color: colors.danger }} testID="load-error">Could not load. Check your connection and try again.</Body>
      <Dim>{error}</Dim>
      <Button title="Try again" kind="ghost" onPress={onRetry} testID="retry" />
    </Card>
  );
}
