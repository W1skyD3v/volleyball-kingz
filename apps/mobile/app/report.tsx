import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { REPORT_REASONS, type ReportInput } from '@vk/core';
import { Switch, TextInput } from 'react-native';
import { useApp } from '../src/state/AppState';
import { Body, Button, Card, Chip, Dim, H2, Row, Screen, colors } from '../src/ui/kit';

/** Used for posts (runs), users and games. Safety escalation routes to a human reviewer. */
export default function Report() {
  const { backend } = useApp();
  const p = useLocalSearchParams<{ targetType?: string; targetId?: string; safety?: string }>();
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>(p.safety ? 'unsafe' : 'inappropriate');
  const [details, setDetails] = useState('');
  const [safety, setSafety] = useState(Boolean(p.safety));
  const [sent, setSent] = useState(false);

  async function submit() {
    await backend.report({
      targetType: (p.targetType as ReportInput['targetType']) ?? 'post',
      targetId: p.targetId ?? 'unknown',
      reason,
      details: details || undefined,
      safetyEscalation: safety,
    });
    setSent(true);
  }

  if (sent) {
    return (
      <Screen>
        <Card>
          <H2>Thanks</H2>
          <Body testID="report-sent">Your report was sent{safety ? ' and flagged for a human reviewer' : ''}. The other player is not told.</Body>
          <Button title="Done" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }
  return (
    <Screen>
      <Card>
        <H2>What happened?</H2>
        <Row>{REPORT_REASONS.map((r) => <Chip key={r} label={r} testID={`reason-${r}`} active={reason === r} onPress={() => setReason(r)} />)}</Row>
        <TextInput
          testID="details"
          value={details}
          onChangeText={setDetails}
          multiline
          placeholder="Details (optional)"
          placeholderTextColor={colors.dim}
          style={{ color: colors.text, backgroundColor: colors.bg, padding: 10, borderRadius: 8, minHeight: 80 }}
        />
        <Row>
          <Switch testID="safety" value={safety} onValueChange={setSafety} />
          <Dim>I feel unsafe: send to a human reviewer now</Dim>
        </Row>
        <Button title="Send report" onPress={submit} testID="send-report" />
      </Card>
    </Screen>
  );
}
