import { useCallback, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { ApiError } from '../lib/api';
import { colors } from '../lib/theme';
import type { Assignable } from '../lib/types';
import { ROLE_LABEL } from '../lib/types';
import { Button, Input } from './ui';

export interface OutOfGroupExtra {
  confirmOutOfGroup?: boolean;
  outOfGroupReason?: string | null;
}
export class Cancelled extends Error {}
export const isCancelled = (e: unknown): boolean => e instanceof Cancelled;

type Person = { id: number; fullName: string; groupLead: string | null };

/**
 * Bọc lệnh giao việc: server trả 409 OUT_OF_GROUP → hiện hộp cảnh báo + ô lý do,
 * người dùng xác nhận thì gửi lại kèm confirmOutOfGroup. Trả về [guard, phần tử modal cần render].
 */
export function useOutOfGroupGuard() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [reason, setReason] = useState('');
  const resolver = useRef<((r: string | null) => void) | null>(null);

  const guard = useCallback(async <T,>(fn: (extra: OutOfGroupExtra) => Promise<T>): Promise<T> => {
    try {
      return await fn({});
    } catch (e) {
      if (!(e instanceof ApiError) || e.data.code !== 'OUT_OF_GROUP') throw e;
      setReason('');
      setPeople((e.data.people as Person[]) ?? []);
      const r = await new Promise<string | null>((resolve) => (resolver.current = resolve));
      setPeople(null);
      if (r === null) throw new Cancelled();
      return fn({ confirmOutOfGroup: true, outOfGroupReason: r.trim() || null });
    }
  }, []);

  const element = (
    <Modal visible={!!people} transparent animationType="fade" onRequestClose={() => resolver.current?.(null)}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 8 }}>⚠️ Giao việc ngoài nhóm phụ trách</Text>
          {people?.map((p) => (
            <Text key={p.id} style={{ marginBottom: 4 }}>
              • <Text style={{ fontWeight: '700' }}>{p.fullName}</Text> — {p.groupLead ? `nhóm ${p.groupLead}` : 'Trưởng phòng quản lý trực tiếp'}
            </Text>
          ))}
          <Text style={{ color: colors.warning, marginVertical: 10 }}>Vẫn giao được, nhưng sẽ được ghi nhận vào báo cáo và báo cho người quản lý nhóm đó.</Text>
          <Input value={reason} onChangeText={setReason} multiline placeholder="Lý do giao ngoài nhóm" />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Button title="Huỷ" variant="default" onPress={() => resolver.current?.(null)} style={{ flex: 1 }} />
            <Button title="Vẫn giao việc" onPress={() => resolver.current?.(reason)} style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
  return [guard, element] as const;
}

/** Tuỳ chọn cho ô chọn người: người ngoài nhóm có nhãn cảnh báo */
export const personOptions = (people: Assignable[], excludeId?: number) =>
  people
    .filter((u) => u.id !== excludeId)
    .map((u) => ({
      value: u.id,
      label: u.inGroup ? u.fullName : `${u.fullName}  ⚠️ Ngoài nhóm`,
      sub: `${ROLE_LABEL[u.role]}${u.team ? ` · ${u.team}` : ''}${!u.inGroup ? ` · ${u.groupLead ? `nhóm ${u.groupLead}` : 'TP quản lý trực tiếp'}` : ''}`,
    }));

/** Dòng cảnh báo dưới ô chọn khi chọn người ngoài nhóm */
export function OutOfGroupHint({ people, id }: { people: Assignable[]; id: number | null }) {
  const p = people.find((u) => u.id === id);
  if (!p || p.inGroup) return null;
  return (
    <Text style={{ color: colors.warning, marginTop: 6, fontSize: 13 }}>
      ⚠️ {p.fullName} không thuộc nhóm bạn phụ trách{p.groupLead ? ` (nhóm ${p.groupLead})` : ''}. Vẫn giao được nhưng sẽ được ghi nhận.
    </Text>
  );
}
