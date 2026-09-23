import DateTimePicker from '@react-native-community/datetimepicker';
import { FlatList, Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { colors } from '../lib/theme';
import { fmtDate, toYmd } from '../lib/format';
import { s } from './ui';

/** Chọn ngày (YYYY-MM-DD) */
export function DateField({ value, onChange, placeholder = 'Chọn ngày' }: { value: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable style={[s.input, { flex: 1 }]} onPress={() => setOpen(true)}>
          <Text style={{ color: value ? colors.text : '#9CA3AF', fontSize: 15 }}>{value ? fmtDate(value) : placeholder}</Text>
        </Pressable>
        {value && (
          <Pressable onPress={() => onChange(null)} style={[s.input, { justifyContent: 'center' }]}>
            <Text style={{ color: colors.muted }}>✕</Text>
          </Pressable>
        )}
      </View>
      {open && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(e, d) => {
            if (Platform.OS === 'android') setOpen(false);
            if (e.type === 'set' && d) onChange(toYmd(d));
          }}
        />
      )}
      {open && Platform.OS === 'ios' && (
        <Pressable onPress={() => setOpen(false)} style={{ alignSelf: 'flex-end', padding: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Xong</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Chọn 1 mục từ danh sách (dạng modal toàn màn hình) */
export function SelectField<T extends string | number>(props: {
  value: T | null;
  options: { value: T; label: string; sub?: string }[];
  onChange: (v: T | null) => void;
  placeholder?: string;
  title?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cur = props.options.find((o) => o.value === props.value);
  return (
    <>
      <Pressable style={s.input} onPress={() => setOpen(true)}>
        <Text style={{ color: cur ? colors.text : '#9CA3AF', fontSize: 15 }}>{cur?.label ?? props.placeholder ?? 'Chọn'}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700' }}>{props.title ?? 'Chọn'}</Text>
            <Pressable onPress={() => setOpen(false)}>
              <Text style={{ color: colors.primary, fontSize: 16 }}>Đóng</Text>
            </Pressable>
          </View>
          <FlatList
            data={props.allowClear ? [{ value: null as unknown as T, label: '— Không chọn —' }, ...props.options] : props.options}
            keyExtractor={(o) => String(o.value)}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  props.onChange(item.value ?? null);
                  setOpen(false);
                }}
                style={{ padding: 16, backgroundColor: item.value === props.value ? colors.primaryLight : '#fff', borderBottomWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ fontSize: 16 }}>{item.label}</Text>
                {'sub' in item && item.sub ? <Text style={s.muted}>{item.sub}</Text> : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
