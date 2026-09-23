import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useNavigation } from 'expo-router';
import { useLayoutEffect } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { colors } from '../../lib/theme';
import type { Notification } from '../../lib/types';
import { Empty, s } from '../../components/ui';

const ICON: Record<string, string> = { ASSIGNED: '📌', STATUS: '✅', COMMENT: '💬', REMINDER: '⏰', DIGEST: '📋', UPDATED: '✏️' };

export default function Notifications() {
  const qc = useQueryClient();
  const nav = useNavigation();
  const { data = [], isFetching, refetch } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/notifications?limit=100') });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries() });

  useLayoutEffect(() => {
    nav.setOptions({
      headerRight: () => (
        <Pressable onPress={() => readAll.mutate()} style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: '#fff' }}>Đọc hết</Text>
        </Pressable>
      ),
    });
  }, [nav, readAll]);

  const open = async (n: Notification) => {
    if (!n.readAt) {
      await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['unread'] });
    }
    router.push(n.taskId ? `/task/${n.taskId}` : '/my-work');
  };

  return (
    <FlatList
      data={data}
      keyExtractor={(n) => String(n.id)}
      refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
      ListEmptyComponent={!isFetching ? <Empty text="Chưa có thông báo" /> : null}
      renderItem={({ item: n }) => (
        <Pressable onPress={() => open(n)} style={{ flexDirection: 'row', gap: 12, padding: 14, backgroundColor: n.readAt ? '#fff' : colors.primaryLight, borderBottomWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 22 }}>{ICON[n.type] ?? '🔔'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: n.readAt ? '500' : '700', fontSize: 15 }}>{n.title}</Text>
            <Text style={{ marginTop: 2, color: colors.text }}>{n.body}</Text>
            <Text style={[s.muted, { marginTop: 4, fontSize: 12 }]}>{fmtDateTime(n.createdAt)}</Text>
          </View>
          {!n.readAt && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.info, marginTop: 6 }} />}
        </Pressable>
      )}
    />
  );
}
