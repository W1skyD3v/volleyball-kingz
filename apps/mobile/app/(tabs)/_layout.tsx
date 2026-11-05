import { Tabs } from 'expo-router';
import React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors, fonts } from '../../src/ui/kit';

type IconName = 'courts' | 'runs' | 'play' | 'friends' | 'closet' | 'me';

function Icon({ name, color }: { name: IconName; color: string }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === 'courts' && (
        <>
          <Path d="M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z" {...p} />
          <Circle cx={12} cy={10} r={2.5} {...p} />
        </>
      )}
      {name === 'runs' && (
        <>
          <Rect x={4} y={5} width={16} height={14} rx={2} {...p} />
          <Path d="M4 10h16" {...p} />
        </>
      )}
      {name === 'play' && (
        <>
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M3 12h18M12 3v18" {...p} />
        </>
      )}
      {name === 'friends' && (
        <>
          <Circle cx={9} cy={8} r={3} {...p} />
          <Path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 11a3 3 0 100-6M21 20c0-2.5-2-4-4-4.5" {...p} />
        </>
      )}
      {name === 'closet' && <Path d="M9 4l3 2 3-2 5 3-2 4-2-1v10H8V10l-2 1-2-4z" {...p} />}
      {name === 'me' && (
        <>
          <Circle cx={12} cy={8} r={4} {...p} />
          <Path d="M4 21c0-4 4-6 8-6s8 2 8 6" {...p} />
        </>
      )}
    </Svg>
  );
}

const tab = (name: IconName, title: string) => ({ title, tabBarIcon: ({ color }: { color: ColorValue }) => <Icon name={name} color={String(color)} /> });

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.bodyBold },
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line, height: 72, paddingBottom: 10, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, lineHeight: 20, paddingBottom: 2, fontFamily: fonts.bodyBold },
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.dim,
      }}
    >
      <Tabs.Screen name="index" options={tab('courts', 'Courts')} />
      <Tabs.Screen name="runs" options={tab('runs', 'Runs')} />
      <Tabs.Screen name="play" options={tab('play', 'Play')} />
      <Tabs.Screen name="friends" options={tab('friends', 'Friends')} />
      <Tabs.Screen name="closet" options={tab('closet', 'Closet')} />
      <Tabs.Screen name="profile" options={tab('me', 'Me')} />
    </Tabs>
  );
}
