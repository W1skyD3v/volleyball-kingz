import React, { useCallback, useState } from 'react';
import { TextInput } from 'react-native';
import type { FriendView } from '../../src/backend/types';
import { useApp } from '../../src/state/AppState';
import { LoadError } from '../../src/ui/LoadError';
import { useLoader } from '../../src/ui/useLoader';
import { Body, Brand, Button, Card, Dim, H1, H2, Row, Screen, colors } from '../../src/ui/kit';

const ERRORS: Record<string, string> = {
  friend_not_found: 'No player with that code.',
  already_friends_or_pending: 'You are already friends or a request is pending.',
};

/** Friends are added by code, never by name search. Friends see where each other are checked in. */
export default function Friends() {
  const { backend } = useApp();
  const [code, setCode] = useState('');
  const [mine, setMine] = useState('');
  const [list, setList] = useState<FriendView[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMine(await backend.myFriendCode());
    setList(await backend.listFriends());
  }, [backend]);
  const { error: loadError, retry } = useLoader(load);

  const run = (f: () => Promise<void>, ok?: string) => async () => {
    try {
      await f();
      setMsg(ok ?? null);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setMsg(ERRORS[m] ?? m);
    }
    await load();
  };

  const group = (rel: FriendView['relation']) => list.filter((f) => f.relation === rel);
  return (
    <Screen>
      <Brand />
      <H1>Friends</H1>
      <LoadError error={loadError} onRetry={retry} />
      <Card>
        <H2>Your code</H2>
        <Body testID="my-code">{mine}</Body>
        <Dim>Share it with people you play with. Friends can invite you to private games and see which court you are at.</Dim>
        <H2>Add a friend</H2>
        <TextInput testID="friend-code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="Friend's code" placeholderTextColor={colors.dim} style={{ color: colors.text, backgroundColor: colors.bg, padding: 12, borderRadius: 8 }} />
        <Button title="Send request" testID="send-request" onPress={run(async () => { await backend.sendFriendRequest(code); setCode(''); }, 'Request sent.')} />
        {msg && <Body testID="friends-msg">{msg}</Body>}
      </Card>

      {group('incoming').length > 0 && (
        <Card>
          <H2>Requests</H2>
          {group('incoming').map((f) => (
            <Row key={f.requestId}>
              <Body>{f.name}</Body>
              <Button title="Accept" testID={`accept-${f.userId}`} onPress={run(() => backend.respondFriendRequest(f.requestId, true))} />
              <Button title="Decline" kind="ghost" testID={`decline-${f.userId}`} onPress={run(() => backend.respondFriendRequest(f.requestId, false))} />
            </Row>
          ))}
        </Card>
      )}

      <Card>
        <H2>Friends</H2>
        {group('friend').length === 0 && <Dim>No friends yet.</Dim>}
        {group('friend').map((f) => (
          <Row key={f.userId}>
            <Body testID={`friend-${f.userId}`}>{f.name}</Body>
            <Dim>{f.courtName ? `at ${f.courtName}` : 'not checked in'}</Dim>
            <Button title="Remove" kind="ghost" testID={`remove-${f.userId}`} onPress={run(() => backend.removeFriend(f.userId))} />
          </Row>
        ))}
        {group('outgoing').map((f) => <Dim key={f.requestId}>Waiting for {f.name} to accept</Dim>)}
      </Card>
    </Screen>
  );
}
