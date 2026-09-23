import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { daysLeftText, fmtDate } from '../../lib/format';
import { colors } from '../../lib/theme';
import type { Milestone, MyWorkItem } from '../../lib/types';
import { Button, Card, Chips, Empty, MsStatusTag, PriorityTag, ProgressBar, WarningTag, s } from '../../components/ui';
import { ProgressSheet } from '../../components/ProgressSheet';

type F = 'open' | 'OVERDUE' | 'DUE_SOON' | 'all';

/** Việc cần xử lý của tôi (thay sheet VIEC_CAN_XU_LY) */
export default function MyWork() {
  const [f, setF] = useState<F>('open');
  const [editing, setEditing] = useState<Milestone | null>(null);
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ['my-work', f === 'all'],
    queryFn: () => api.get<MyWorkItem[]>(`/dashboard/my-work${f === 'all' ? '?includeDone=1' : ''}`),
  });
  const items = f === 'OVERDUE' || f === 'DUE_SOON' ? data.filter((m) => m.warning === f) : data;
  const n = (w: string) => data.filter((m) => m.warning === w).length;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, paddingBottom: 4 }}>
        <Chips
          value={f}
          onChange={setF}
          options={[
            { value: 'open', label: 'Chưa xong' },
            { value: 'OVERDUE', label: `Quá hạn (${n('OVERDUE')})` },
            { value: 'DUE_SOON', label: `Sắp hạn (${n('DUE_SOON')})` },
            { value: 'all', label: 'Tất cả' },
          ]}
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        ListEmptyComponent={!isFetching ? <Empty text="Không có việc nào 🎉" /> : null}
        renderItem={({ item: m }) => (
          <Pressable onPress={() => router.push(`/task/${m.task.id}`)}>
            <Card style={m.warning === 'OVERDUE' ? { borderLeftWidth: 4, borderLeftColor: colors.danger } : m.warning === 'DUE_SOON' ? { borderLeftWidth: 4, borderLeftColor: colors.warning } : undefined}>
              <View style={s.row}>
                <Text style={{ fontWeight: '700', color: colors.primary }}>{m.task.code}</Text>
                <WarningTag w={m.warning} />
                <PriorityTag p={m.task.priority} />
              </View>
              <Text style={[s.title, { marginTop: 6 }]}>{m.content}</Text>
              <Text style={[s.muted, { marginTop: 2 }]} numberOfLines={1}>{m.task.title}</Text>
              <View style={[s.row, { marginTop: 6 }]}>
                <MsStatusTag s={m.status} />
                <Text style={s.muted}>Hạn {fmtDate(m.dueDate)}</Text>
                <Text style={{ fontSize: 13, color: m.warning === 'OVERDUE' ? colors.danger : colors.warning, fontWeight: '600' }}>{daysLeftText(m.daysLeft, m.status === 'DONE')}</Text>
              </View>
              <View style={{ marginTop: 8 }}>
                <ProgressBar value={m.percent} danger={m.warning === 'OVERDUE'} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <Text style={s.muted}>Giao bởi {m.assignedBy?.fullName ?? m.task.owner.fullName}</Text>
                <Button title="Cập nhật" small onPress={() => setEditing(m)} />
              </View>
            </Card>
          </Pressable>
        )}
      />
      <ProgressSheet milestone={editing} onClose={() => setEditing(null)} />
    </View>
  );
}
