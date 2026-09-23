import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { daysLeftText, fmtDate, fmtDateTime } from '../../lib/format';
import { colors } from '../../lib/theme';
import type { Milestone, TaskDetail } from '../../lib/types';
import { Button, Card, Empty, Input, Loading, MsStatusTag, PriorityTag, ProgressBar, StateTag, WarningTag, s } from '../../components/ui';
import { ProgressSheet } from '../../components/ProgressSheet';
import { MilestoneSheet } from '../../components/MilestoneSheet';

const ACT: Record<string, string> = { COMMENT: '💬', CREATE: '🆕', ASSIGN: '📌', STATUS: '✅', UPDATE: '✏️' };

export default function TaskDetailScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { user } = useAuth();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<Milestone | null>(null);
  const [msSheet, setMsSheet] = useState<{ open: boolean; m?: Milestone | null }>({ open: false });
  const [comment, setComment] = useState('');
  const { data: t, isFetching, refetch, error } = useQuery({ queryKey: ['task', id], queryFn: () => api.get<TaskDetail>(`/tasks/${id}`) });

  const send = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/comments`, { content: comment }),
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['task', id] });
    },
    onError: (e: Error) => Alert.alert('Lỗi', e.message),
  });
  const delMs = useMutation({
    mutationFn: (mid: number) => api.delete(`/milestones/${mid}`),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => Alert.alert('Lỗi', e.message),
  });

  if (error) return <Empty text={(error as Error).message} />;
  if (!t) return <Loading />;
  const canManage = t.permissions.canManage;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: t.code }} />
      <ScrollView contentContainerStyle={{ padding: 12 }} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}>
        <Card>
          <View style={s.row}>
            <StateTag state={t.state} />
            <PriorityTag p={t.priority} />
            {t.groupName && <Text style={s.muted}>{t.groupName}</Text>}
          </View>
          <Text style={{ fontSize: 17, fontWeight: '700', marginTop: 8 }}>{t.title}</Text>
          <View style={{ marginTop: 10, gap: 4 }}>
            <Text style={s.muted}>Người giao: <Text style={{ color: colors.text }}>{t.assigner.fullName}</Text></Text>
            <Text style={s.muted}>Phụ trách chung: <Text style={{ color: colors.text }}>{t.owner.fullName}</Text></Text>
            <Text style={s.muted}>
              Thời gian: <Text style={{ color: colors.text }}>{fmtDate(t.startDate)} → {fmtDate(t.dueDate)}</Text>{' '}
              <Text style={{ color: t.state === 'OVERDUE' ? colors.danger : colors.warning, fontWeight: '600' }}>{daysLeftText(t.daysLeft, t.state === 'DONE')}</Text>
            </Text>
          </View>
          <View style={{ marginTop: 10 }}>
            <ProgressBar value={t.progress} danger={t.state === 'OVERDUE'} />
          </View>
          {t.note && <Text style={{ marginTop: 10, color: colors.text }}>📝 {t.note}</Text>}
        </Card>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 }}>
          <Text style={s.title}>Mốc công việc ({t.milestoneDone}/{t.milestoneCount})</Text>
          {canManage && <Button title="＋ Giao mốc" small onPress={() => setMsSheet({ open: true })} />}
        </View>
        {t.milestones.map((m) => {
          const mine = m.assignee?.id === user?.id;
          return (
            <Card key={m.id} style={mine ? { borderColor: colors.primary, borderWidth: 1 } : undefined}>
              <View style={s.row}>
                <Text style={{ fontWeight: '700' }}>#{m.seq}</Text>
                <WarningTag w={m.warning} />
                <MsStatusTag s={m.status} />
              </View>
              <Text style={{ marginTop: 6, fontSize: 15 }}>{m.content}</Text>
              <Text style={[s.muted, { marginTop: 4 }]}>
                👤 {m.assignee?.fullName ?? 'Chưa giao'} · Hạn {fmtDate(m.dueDate)} {daysLeftText(m.daysLeft, m.status === 'DONE') ? `· ${daysLeftText(m.daysLeft)}` : ''} · Trọng số {m.weight}
              </Text>
              {m.note && <Text style={[s.muted, { marginTop: 4 }]}>📝 {m.note}</Text>}
              <View style={{ marginTop: 8 }}>
                <ProgressBar value={m.percent} danger={m.warning === 'OVERDUE'} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
                {canManage && (
                  <Button
                    title="Xoá"
                    small
                    variant="default"
                    onPress={() => Alert.alert('Xoá mốc?', m.content, [{ text: 'Huỷ', style: 'cancel' }, { text: 'Xoá', style: 'destructive', onPress: () => delMs.mutate(m.id) }])}
                  />
                )}
                {canManage && <Button title="Sửa / giao lại" small variant="default" onPress={() => setMsSheet({ open: true, m })} />}
                {(mine || canManage) && <Button title="Cập nhật" small onPress={() => setProgress(m)} />}
              </View>
            </Card>
          );
        })}

        <Text style={[s.title, { marginVertical: 8 }]}>Trao đổi & lịch sử</Text>
        <Card>
          {t.activities.length === 0 && <Text style={s.muted}>Chưa có hoạt động</Text>}
          {t.activities.map((a) => (
            <View key={a.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontWeight: '600' }}>
                {ACT[a.type] ?? '•'} {a.user.fullName} <Text style={[s.muted, { fontWeight: '400', fontSize: 12 }]}>{fmtDateTime(a.createdAt)}</Text>
              </Text>
              <Text style={{ marginTop: 2 }}>{a.content}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderColor: colors.border }}>
        <Input value={comment} onChangeText={setComment} placeholder="Bình luận, báo cáo..." style={{ flex: 1 }} multiline />
        <Pressable
          disabled={!comment.trim() || send.isPending}
          onPress={() => send.mutate()}
          style={{ justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: comment.trim() ? colors.primary : colors.border }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Gửi</Text>
        </Pressable>
      </View>
      <ProgressSheet milestone={progress} onClose={() => setProgress(null)} />
      <MilestoneSheet open={msSheet.open} milestone={msSheet.m} taskId={t.id} onClose={() => setMsSheet({ open: false })} />
    </KeyboardAvoidingView>
  );
}
