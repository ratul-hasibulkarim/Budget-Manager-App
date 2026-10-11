import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalcError, evaluateToMinor, formatMoney, isExpression, type Minor } from '@bm/core';
import { useSettings } from '../lib/settings';
import { FONT } from '../lib/theme';

export function Txt({
  children,
  style,
  muted,
  weight = 'regular',
  size = 15,
  color,
  numberOfLines,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  weight?: keyof typeof FONT;
  size?: number;
  color?: string;
  numberOfLines?: number;
  testID?: string;
}) {
  const { theme } = useSettings();
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      style={[{ fontFamily: FONT[weight], fontSize: size, lineHeight: Math.round(size * 1.45), color: color ?? (muted ? theme.textMuted : theme.text) }, style]}
    >
      {children}
    </Text>
  );
}

/** Scrollable page body with the theme background. */
export function Screen({ children, scroll = true, footer }: { children: ReactNode; scroll?: boolean; footer?: ReactNode }) {
  const { theme } = useSettings();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 96 + insets.bottom, gap: 12 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, padding: 16, gap: 12 }}>{children}</View>
      )}
      {footer}
    </View>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { theme } = useSettings();
  return (
    <View testID={testID} style={[{ backgroundColor: theme.surface, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border, padding: 14, gap: 8 }, style]}>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  small,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  testID?: string;
}) {
  const { theme } = useSettings();
  const bg = kind === 'primary' ? theme.primary : kind === 'danger' ? theme.negative : kind === 'secondary' ? theme.surfaceAlt : 'transparent';
  const fg = kind === 'primary' ? theme.onPrimary : kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? theme.primary : theme.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: bg,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        borderRadius: 10,
        paddingVertical: small ? 6 : 11,
        paddingHorizontal: small ? 10 : 16,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: small ? 32 : 44,
      })}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Txt weight="semibold" size={small ? 13 : 15} color={fg}>{label}</Txt>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress?: () => void; testID?: string }) {
  const { theme } = useSettings();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: selected ? theme.primary : theme.border,
        backgroundColor: selected ? theme.primary : theme.surface,
      }}
    >
      <Txt size={13} weight="medium" color={selected ? theme.onPrimary : theme.text}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Row({ children, style, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; wrap?: boolean }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>{children}</View>;
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { theme } = useSettings();
  return (
    <View style={{ gap: 4 }}>
      <Txt size={13} muted weight="medium">
        {label}
      </Txt>
      <TextInput
        placeholderTextColor={theme.textMuted}
        accessibilityLabel={label}
        {...props}
        style={[
          {
            fontFamily: FONT.regular,
            fontSize: 16,
            color: theme.text,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: error ? theme.negative : theme.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            minHeight: props.multiline ? 72 : 44,
            textAlignVertical: props.multiline ? 'top' : 'center',
          },
          props.style,
        ]}
      />
      {error ? (
        <Txt size={12} color={theme.negative}>
          {error}
        </Txt>
      ) : hint ? (
        <Txt size={12} muted>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * Amount field with a built-in calculator: type "250+80+40" and the result is shown and used.
 * Calls onChange with the amount in paisa, or null while the text is not a valid amount.
 */
export function AmountField({
  label,
  text,
  onText,
  testID,
  autoFocus,
}: {
  label: string;
  text: string;
  onText: (text: string, amount: Minor | null) => void;
  testID?: string;
  autoFocus?: boolean;
}) {
  const { theme, settings } = useSettings();
  const [showPad, setShowPad] = useState(false);
  let amount: Minor | null = null;
  let error: string | null = null;
  if (text.trim()) {
    try {
      amount = evaluateToMinor(text);
      if (amount <= 0) amount = null;
    } catch (e) {
      if (e instanceof CalcError) amount = null;
      else throw e;
    }
    if (amount === null && !/[+\-×÷*/(]$/.test(text.trim())) error = '?';
  }
  const set = (t: string) => {
    let a: Minor | null = null;
    try {
      a = evaluateToMinor(t);
      if (a <= 0) a = null;
    } catch {
      a = null;
    }
    onText(t, a);
  };
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '⌫', '+'];
  return (
    <View style={{ gap: 6 }}>
      <Txt size={13} muted weight="medium">
        {label}
      </Txt>
      <Row>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          autoFocus={autoFocus}
          value={text}
          onChangeText={set}
          keyboardType="numbers-and-punctuation"
          placeholder="0"
          placeholderTextColor={theme.textMuted}
          style={{
            flex: 1,
            fontFamily: FONT.semibold,
            fontSize: 24,
            color: theme.text,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: error ? theme.negative : theme.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        />
        <Button small kind="secondary" label="🧮" onPress={() => setShowPad((v) => !v)} testID={testID ? `${testID}-calc` : undefined} />
      </Row>
      {amount !== null && isExpression(text) ? (
        <Txt testID={testID ? `${testID}-result` : undefined} weight="semibold" color={theme.primary}>
          = {formatMoney(amount, { lang: settings.lang })}
        </Txt>
      ) : null}
      {showPad ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {keys.map((k) => (
            <Pressable
              key={k}
              testID={`calc-key-${k}`}
              onPress={() => {
                if (k === '⌫') set(text.slice(0, -1));
                else set(text + (['+', '−', '×', '÷'].includes(k) ? ` ${k} ` : k));
              }}
              style={{ width: '23%', paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: theme.surfaceAlt }}
            >
              <Txt weight="semibold" size={18}>
                {k}
              </Txt>
            </Pressable>
          ))}
          {amount !== null && isExpression(text) ? (
            <Pressable
              testID="calc-key-equals"
              onPress={() => set((amount! / 100).toFixed(2).replace(/\.00$/, ''))}
              style={{ width: '98%', paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: theme.primary }}
            >
              <Txt weight="semibold" size={18} color={theme.onPrimary}>
                =
              </Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt weight="semibold" size={16}>
          {title}
        </Txt>
        {right}
      </Row>
      {children}
    </View>
  );
}

export function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Txt muted style={{ textAlign: 'center' }}>
        {text}
      </Txt>
      {action}
    </Card>
  );
}

export function Banner({ text, kind = 'info', testID }: { text: string; kind?: 'info' | 'warn' | 'error'; testID?: string }) {
  const { theme } = useSettings();
  const color = kind === 'error' ? theme.negative : kind === 'warn' ? theme.warning : theme.primary;
  return (
    <View testID={testID} style={{ borderLeftWidth: 4, borderLeftColor: color, backgroundColor: theme.surfaceAlt, borderRadius: 8, padding: 10 }}>
      <Txt size={14}>{text}</Txt>
    </View>
  );
}

/** Floating "+" button. */
export function Fab({ onPress, label, testID }: { onPress: () => void; label: string; testID?: string }) {
  const { theme } = useSettings();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        position: 'absolute',
        right: 20,
        bottom: 24 + insets.bottom,
        backgroundColor: theme.primary,
        borderRadius: 28,
        paddingHorizontal: 20,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        elevation: 4,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      }}
    >
      <Txt weight="bold" size={22} color={theme.onPrimary}>
        +
      </Txt>
      <Txt weight="semibold" color={theme.onPrimary}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Horizontal tab bar inside a screen. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  const { theme } = useSettings();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: theme.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            testID={`tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.key)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 3, borderBottomColor: on ? theme.primary : 'transparent' }}
          >
            <Txt weight={on ? 'semibold' : 'regular'} size={14} color={on ? theme.primary : theme.textMuted}>
              {tab.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Divider() {
  const { theme } = useSettings();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />;
}
