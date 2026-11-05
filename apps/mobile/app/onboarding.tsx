import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { ageBand } from '@vk/core';
import { useApp } from '../src/state/AppState';
import { Body, Brand, Button, Card, Dim, H1, Screen, colors } from '../src/ui/kit';

/** Neutral age screen: asks for birth date without hinting at the 13+ rule. Under 13 is turned away. */
export default function Onboarding() {
  const { backend, refreshProfile } = useApp();
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (!name.trim() || name.trim().length < 2 || Number.isNaN(d.getTime()) || Number(year) < 1900) {
      setMsg('Enter a name (2+ characters) and a valid birth date.');
      return;
    }
    if (ageBand(d) === 'blocked') {
      setMsg('Sorry, you cannot create an account.');
      return;
    }
    await backend.createProfile(name.trim(), d);
    await refreshProfile();
  }

  const input = { backgroundColor: colors.card, color: colors.text, padding: 14, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, minWidth: 70 } as const;
  return (
    <Screen>
      <Brand />
      <H1>Volleyball Kingz</H1>
      <Dim>See who is at the court. Run it. Get rated.</Dim>
      <Card>
        <Body>Display name</Body>
        <TextInput testID="name" value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.dim} style={input} />
        <Body>Date of birth</Body>
        <TextInput testID="year" value={year} onChangeText={setYear} placeholder="YYYY" keyboardType="number-pad" placeholderTextColor={colors.dim} style={input} />
        <TextInput testID="month" value={month} onChangeText={setMonth} placeholder="MM" keyboardType="number-pad" placeholderTextColor={colors.dim} style={input} />
        <TextInput testID="day" value={day} onChangeText={setDay} placeholder="DD" keyboardType="number-pad" placeholderTextColor={colors.dim} style={input} />
        {msg && <Body style={{ color: colors.danger }}>{msg}</Body>}
        <Button title="Continue" onPress={go} testID="continue" />
      </Card>
      <Dim>Demo build: data lives on this device only.</Dim>
    </Screen>
  );
}
