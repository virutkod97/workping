import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { api, getServer } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';
import { ROLE_LABEL } from '../../lib/types';
import { Card, s } from '../../components/ui';

function Row({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 16, color: danger ? colors.danger : colors.text }}>{label}</Text>
      <Text style={{ color: colors.muted }}>›</Text>
    </Pressable>
  );
}

export default function Profile() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '700' }}>{user.fullName.split(' ').pop()?.[0]}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{user.fullName}</Text>
            <Text style={s.muted}>
              {user.code} · {ROLE_LABEL[user.role]}
              {user.team ? ` · ${user.team}` : ''}
            </Text>
            {user.manager && <Text style={s.muted}>Quản lý: {user.manager.fullName}</Text>}
          </View>
        </View>
      </Card>
      <Card>
        <Row label="Danh bạ nhân sự" onPress={() => router.push('/staff')} />
        <Row label="Đổi mật khẩu" onPress={() => router.push('/change-password')} />
        <Row
          label="Gửi thông báo thử"
          onPress={async () => {
            try {
              const r = await api.post<{ pushEnabled: boolean; sent: number }>('/devices/test');
              Alert.alert(
                'Thông báo thử',
                !r.pushEnabled ? 'Máy chủ chưa cấu hình Firebase.' : r.sent ? `Đã gửi tới ${r.sent} thiết bị.` : 'Thiết bị chưa đăng ký nhận thông báo (kiểm tra quyền thông báo).',
              );
            } catch (e) {
              Alert.alert('Lỗi', (e as Error).message);
            }
          }}
        />
        <Row
          label="Đăng xuất"
          danger
          onPress={() =>
            Alert.alert('Đăng xuất?', 'Thiết bị sẽ ngừng nhận thông báo của tài khoản này.', [
              { text: 'Huỷ', style: 'cancel' },
              { text: 'Đăng xuất', style: 'destructive', onPress: () => void logout() },
            ])
          }
        />
      </Card>
      <Text style={[s.muted, { textAlign: 'center', fontSize: 12 }]}>Máy chủ: {getServer()}</Text>
    </ScrollView>
  );
}
