import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DOC_PILL, T, type DocType } from './theme';

/** Navy app bar — the phone half of the web console's chrome. */
export function AppBar({
  title,
  onBack,
  right,
}: {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.appbar, { paddingTop: insets.top + 10 }]}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={12} style={s.back}>
          <Text style={s.backIcon}>‹</Text>
        </Pressable>
      )}
      {title ? (
        <Text style={s.appbarTitle}>{title}</Text>
      ) : (
        <Text style={s.brand}>
          Purchase<Text style={s.brandAccent}>Division</Text>
        </Text>
      )}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function Btn({
  label,
  onPress,
  tone = 'green',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'green' | 'blue' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const tones = {
    green: { bg: T.green, fg: '#fff', border: T.green },
    blue: { bg: T.blue, fg: '#fff', border: T.blue },
    ghost: { bg: T.card, fg: T.text, border: T.border },
    danger: { bg: T.card, fg: T.red, border: '#f3c9c3' },
  }[tone];

  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: tones.bg, borderColor: tones.border, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy && <ActivityIndicator size="small" color={tones.fg} style={{ marginRight: 8 }} />}
      <Text style={[s.btnLabel, { color: tones.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Pill({ type }: { type: DocType }) {
  const c = DOC_PILL[type];
  return (
    <View style={[s.pill, { backgroundColor: c.bg }]}>
      <Text style={[s.pillText, { color: c.fg }]}>{type}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={s.error}>
      <Text style={s.errorText}>{message}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  appbar: {
    backgroundColor: T.navy,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brand: { color: T.invert, fontSize: 19, fontWeight: '700' },
  brandAccent: { color: T.gold, fontWeight: '400', fontStyle: 'italic' },
  appbarTitle: { color: T.invert, fontSize: 17, fontWeight: '600' },
  back: { paddingRight: 2 },
  backIcon: { color: T.invert, fontSize: 30, lineHeight: 32, marginTop: -4 },

  btn: {
    height: 48,
    borderRadius: T.radiusSm,
    borderWidth: 1,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnLabel: { fontSize: 15, fontWeight: '600' },

  pill: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 11, alignSelf: 'flex-start' },
  pillText: { fontSize: 11, fontWeight: '700' },

  card: {
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.borderSoft,
    padding: 16,
  },

  error: {
    backgroundColor: '#fbe4e1',
    borderColor: '#f0c4bd',
    borderWidth: 1,
    borderRadius: T.radiusSm,
    padding: 11,
    marginTop: 12,
  },
  errorText: { color: '#a5291b', fontSize: 13 },
});
