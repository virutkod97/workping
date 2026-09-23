import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { daysLeftText, fmtDate } from '../../lib/format';
import { colors } from '../../lib/theme';
import type { Dashboard } from '../../lib/types';
import { ROLE_LABEL } from '../../lib/types';
import { Button, Card, Empty, PriorityTag, StateTag, s } from '../../components/ui';

function Stat({ label, value, color }: { label: string; value: number | undefined; color?: string }) {
  return (
    <View style={{ width: '31%', backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: color ?? colors.text }}>{value ?? 0}</Text>
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
    </View>
  );
}

export default function Home() {
  const { user, canAssign } = useAuth();
  const { data, isFetching, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const t = data?.tasks;
  const m = data?.milestones;
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }} refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Xin chào, {user?.fullName}</Text>
      <Text style={[s.muted, { marginBottom: 12 }]}>{user && ROLE_LABEL[user.role]}{user?.team ? ` · ${user.team}` : ''}</Text>

      {canAssign && <Button title="＋ Giao việc mới" onPress={() => router.push('/task/new')} style={{ marginBottom: 14 }} />}

      <Text style={[s.title, { marginBottom: 8 }]}>Công việc</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Stat label="Tổng số" value={t?.total} />
        <Stat label="Hoàn thành" value={t?.done} color={colors.success} />
        <Stat label="Đang làm" value={t?.inProgress} color={colors.info} />
        <Stat label="Chưa làm" value={t?.notStarted} />
        <Stat label="Sắp đến hạn" value={t?.dueSoon} color={colors.warning} />
        <Stat label="Quá hạn" value={t?.overdue} color={colors.danger} />
      </View>
      <Text style={[s.title, { marginBottom: 8, marginTop: 4 }]}>Mốc công việc</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Stat label="Tổng số mốc" value={m?.total} />
        <Stat label="Sắp đến hạn" value={m?.dueSoon} color={colors.warning} />
        <Stat label="Quá hạn" value={m?.overdue} color={colors.danger} />
      </View>

      <Text style={[s.title, { marginVertical: 8 }]}>Cần chú ý</Text>
      {data && !data.attention.length && <Empty text="Không có việc quá hạn hoặc sắp đến hạn 👍" />}
      {data?.attention.map((a) => (
        <Pressable key={a.id} onPress={() => router.push(`/task/${a.id}`)}>
          <Card>
            <View style={s.row}>
              <Text style={{ fontWeight: '700', color: colors.primary }}>{a.code}</Text>
              <StateTag state={a.state} />
              <PriorityTag p={a.priority} />
            </View>
            <Text style={{ marginTop: 6 }} numberOfLines={2}>{a.title}</Text>
            <Text style={[s.muted, { marginTop: 4 }]}>
              {a.owner.fullName} · Hạn {fmtDate(a.dueDate)} · <Text style={{ color: a.state === 'OVERDUE' ? colors.danger : colors.warning }}>{daysLeftText(a.daysLeft)}</Text>
            </Text>
          </Card>
        </Pressable>
      ))}

      {canAssign && !!data?.byPerson.length && (
        <>
          <Text style={[s.title, { marginVertical: 8 }]}>Theo nhân sự</Text>
          <Card>
            {data.byPerson.map((p) => (
              <View key={p.user.id} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.border }}>
                <Text style={{ flex: 1 }}>{p.user.fullName}</Text>
                <Text style={[s.muted, { width: 70, textAlign: 'right' }]}>{p.done}/{p.total}</Text>
                <Text style={{ width: 70, textAlign: 'right', color: p.overdue ? colors.danger : colors.muted, fontWeight: p.overdue ? '700' : '400' }}>{p.overdue} trễ</Text>
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
