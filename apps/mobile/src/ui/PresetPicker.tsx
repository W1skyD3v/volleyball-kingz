import React from 'react';
import { SCORING_MODES, TARGETS, WIN_BYS, getPreset, presetId, type ScoringMode, type Target, type WinBy } from '@vk/core';
import { Chip, Dim, Row } from './kit';

/** Full scoring-preset matrix: target x scoring x win-by. Value is a preset id like "11-1s-w2". */
export function PresetPicker({ value, onChange, idPrefix = '' }: { value: string; onChange: (id: string) => void; idPrefix?: string }) {
  const m = /^(\d+)-(1s|1s2s)-w([12])$/.exec(value)!;
  const target = Number(m[1]) as Target;
  const scoring: ScoringMode = m[2] === '1s' ? 'ones' : 'onesAndTwos';
  const winBy = Number(m[3]) as WinBy;
  return (
    <>
      <Row style={{ flexWrap: 'nowrap' }}>{TARGETS.map((t) => <Chip fill key={t} label={`to ${t}`} testID={`${idPrefix}target-${t}`} active={target === t} onPress={() => onChange(presetId(t, scoring, winBy))} />)}</Row>
      <Row style={{ flexWrap: 'nowrap' }}>{SCORING_MODES.map((s) => <Chip fill key={s} label={s === 'ones' ? 'ones only' : 'ones and twos'} testID={`${idPrefix}scoring-${s}`} active={scoring === s} onPress={() => onChange(presetId(target, s, winBy))} />)}</Row>
      <Row style={{ flexWrap: 'nowrap' }}>{WIN_BYS.map((w) => <Chip fill key={w} label={`win by ${w}`} testID={`${idPrefix}winby-${w}`} active={winBy === w} onPress={() => onChange(presetId(target, scoring, w))} />)}</Row>
      <Dim>{getPreset(value).label}</Dim>
    </>
  );
}
