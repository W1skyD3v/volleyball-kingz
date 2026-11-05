import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { useApp } from '../src/state/AppState';
import { Body, Brand, Button, Card, Dim, H1, Screen, colors } from '../src/ui/kit';

/** Email one-time-code login (Supabase Auth). Only shown when the backend needs a real login. */
export default function Login() {
  const { backend, refreshProfile } = useApp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = { backgroundColor: colors.card, color: colors.text, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.line } as const;

  async function send() {
    try {
      await backend.signInWithEmail(email.trim());
      setSent(true);
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not send the code');
    }
  }
  async function verify() {
    try {
      await backend.verifyEmailCode(email.trim(), code.trim());
      await refreshProfile();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'That code did not work');
    }
  }
  return (
    <Screen>
      <Brand />
      <H1>Sign in</H1>
      <Dim>We email you a one-time code. No password.</Dim>
      <Card>
        <TextInput testID="email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.dim} style={input} />
        {sent && <TextInput testID="code" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="Code from the email" placeholderTextColor={colors.dim} style={input} />}
        {msg && <Body style={{ color: colors.danger }} testID="login-error">{msg}</Body>}
        {!sent ? <Button title="Email me a code" onPress={send} testID="send-code" /> : <Button title="Verify" onPress={verify} testID="verify-code" />}
      </Card>
    </Screen>
  );
}
