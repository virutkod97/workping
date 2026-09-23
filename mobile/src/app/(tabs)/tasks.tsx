import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { daysLeftText, fmtDate } from '../../lib/format';
import { colors } from '../../lib/theme';
import type { Task } from '../../lib/types';
import { Button, Card, Chips, Empty, Input, PriorityTag, ProgressBar, StateTag, s } from '../../components/ui';

type Scope = 'all' | 'mine' | 'assigned';
type St = '' | 'OVERDUE' | 'DUE_SOON' | 'IN_PROGRESS' | 'DONE';

export default function Tasks() {
  const { canAssign } = useAuth();
  const [scope, setScope] = useState<Scope>('all');
  const [state, setState] = useState<St>('');
  const [q, setQ] = useState('');
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ['tasks', scope, state],
    queryFn: () => api.get<Task[]>(`/tasks?scope=${scope}${state ? `&state=${state}` : ''}`),
  });
  const items = q ? data.filter((t) => `${t.code} ${t.title}`.toLowerCase().includes(q.toLowerCase())) : data;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 8 }}>
        <Input value={q} onChangeText={setQ} placeholder="🔍 Tìm mã hoặc tên công việc" />
        <Chips
          value={scope}
          onChange={setScope}
          options={[{ value: 'all', label: 'Tất cả' }, { value: 'mine', label: 'Của tôi' }, ...(canAssign ? [{ value: 'assigned' as const, label: 'Tôi giao' }] : [])]}
        />
        <Chips
          value={state}
          onChange={setState}
          options={[
            { value: '', label: 'Mọi tình trạng' },
            { value: 'OVERDUE', label: 'Quá hạn' },
            { value: 'DUE_SOON', label: 'Sắp hạn' },
            { value: 'IN_PROGRESS', label: 'Đang làm' },
            { value: 'DONE', label: 'Xong' },
          ]}
        />
      </View>
      <FlatList
        data={items}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ padding: 12, paddingTop: 0, paddingBottom: 90 }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        ListEmptyComponent={!isFetching ? <Empty text="Không có công việc" /> : null}
        renderItem={({ item: t }) => (
          <Pressable onPress={() => router.push(`/task/${t.id}`)}>
            <Card>
              <View style={s.row}>
                <Text style={{ fontWeight: '700', color: colors.primary }}>{t.code}</Text>
                <StateTag state={t.state} />
                <PriorityTag p={t.priority} />
              </View>
              <Text style={[s.title, { marginTop: 6 }]} numberOfLines={3}>{t.title}</Text>
              <Text style={[s.muted, { marginTop: 4 }]}>
                {t.owner.fullName} · Hạn {fmtDate(t.dueDate)} {t.daysLeft !== null ? `· ${daysLeftText(t.daysLeft)}` : ''} · Mốc {t.milestoneDone}/{t.milestoneCount}
              </Text>
              <View style={{ marginTop: 8 }}>
                <ProgressBar value={t.progress} danger={t.state === 'OVERDUE'} />
              </View>
            </Card>
          </Pressable>
        )}
      />
      <Button
        title={canAssign ? '＋ Giao việc' : '＋ Thêm việc'}
        onPress={() => router.push('/task/new')}
        style={{ position: 'absolute', right: 16, bottom: 16, borderRadius: 28, paddingHorizontal: 20, elevation: 4, shadowOpacity: 0.2, shadowRadius: 6 }}
      />
    </View>
  );
}
