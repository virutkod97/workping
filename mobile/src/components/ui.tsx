import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { colors, TONE, type Tone } from '../lib/theme';
import type { MilestoneStatus, Priority, TaskState, Warning } from '../lib/types';
import { MILESTONE_STATUS_LABEL, PRIORITY_LABEL, TASK_STATE_LABEL } from '../lib/types';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Tag({ label, tone = 'default' }: { label: string; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <View style={[s.tag, { backgroundColor: t.bg }]}>
      <Text style={[s.tagText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const STATE_TONE: Record<TaskState, Tone> = { DONE: 'success', OVERDUE: 'danger', DUE_SOON: 'warning', NOT_STARTED: 'default', IN_PROGRESS: 'info' };
export const StateTag = ({ state }: { state: TaskState }) => <Tag label={TASK_STATE_LABEL[state]} tone={STATE_TONE[state]} />;

const WARN: Record<Warning, [string, Tone]> = {
  DONE: ['Hoàn thành', 'success'],
  OVERDUE: ['QUÁ HẠN', 'danger'],
  DUE_SOON: ['SẮP ĐẾN HẠN', 'warning'],
  ON_TRACK: ['Theo kế hoạch', 'info'],
  NO_DEADLINE: ['Không hạn', 'default'],
};
export const WarningTag = ({ w }: { w: Warning }) => <Tag label={WARN[w][0]} tone={WARN[w][1]} />;

const PRIO: Record<Priority, Tone> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'default' };
export const PriorityTag = ({ p }: { p: Priority }) => <Tag label={PRIORITY_LABEL[p]} tone={PRIO[p]} />;

const MS: Record<MilestoneStatus, Tone> = { NOT_STARTED: 'default', IN_PROGRESS: 'info', DONE: 'success', PAUSED: 'purple' };
export const MsStatusTag = ({ s: st }: { s: MilestoneStatus }) => <Tag label={MILESTONE_STATUS_LABEL[st]} tone={MS[st]} />;

export function ProgressBar({ value, danger }: { value: number; danger?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const color = danger ? colors.danger : v >= 100 ? colors.success : colors.info;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={s.barBg}>
        <View style={[s.bar, { width: `${v}%`, backgroundColor: color }]} />
      </View>
      <Text style={{ fontSize: 12, color: colors.muted, width: 38, textAlign: 'right' }}>{Math.round(v)}%</Text>
    </View>
  );
}

export function Button(props: { title: string; onPress: () => void; variant?: 'primary' | 'default' | 'danger'; loading?: boolean; disabled?: boolean; style?: ViewStyle; small?: boolean }) {
  const { variant = 'primary' } = props;
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.card;
  const fg = variant === 'default' ? colors.text : '#fff';
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || props.loading}
      style={({ pressed }) => [
        s.btn,
        props.small && { paddingVertical: 6, paddingHorizontal: 12 },
        { backgroundColor: bg, opacity: pressed || props.disabled ? 0.6 : 1, borderWidth: variant === 'default' ? 1 : 0 },
        props.style,
      ]}
    >
      {props.loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }, props.small && { fontSize: 13 }]}>{props.title}</Text>}
    </Pressable>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  );
}

export const Input = (p: TextInputProps) => <TextInput placeholderTextColor="#9CA3AF" {...p} style={[s.input, p.multiline && { minHeight: 70, textAlignVertical: 'top' }, p.style]} />;

export function Empty({ text }: { text: string }) {
  return <Text style={{ textAlign: 'center', color: colors.muted, padding: 32 }}>{text}</Text>;
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.chip, value === o.value && s.chipOn]}>
          <Text style={{ color: value === o.value ? '#fff' : colors.text, fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
  tagText: { fontSize: 12, fontWeight: '600' },
  barBg: { flex: 1, height: 6, backgroundColor: '#EEF0F3', borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  btn: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderColor: colors.border },
  btnText: { fontWeight: '600', fontSize: 15 },
  label: { fontSize: 13, color: colors.muted, marginBottom: 6, fontWeight: '500' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: '#fff', color: colors.text },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
});
