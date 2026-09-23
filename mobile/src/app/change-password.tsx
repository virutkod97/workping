import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import { Button, Field, Input } from '../components/ui';

export default function ChangePassword() {
  const { user, refresh } = useAuth();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (newPassword.length < 6) return Alert.alert('Mật khẩu mới tối thiểu 6 ký tự');
    if (newPassword !== confirm) return Alert.alert('Mật khẩu nhập lại không khớp');
    setLoading(true);
    try {
      await api.post('/auth/change-password', { oldPassword, newPassword });
      await refresh();
      Alert.alert('Đã đổi mật khẩu');
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (e) {
      Alert.alert('Lỗi', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {user?.mustChangePassword && (
        <Text style={{ color: colors.warning, marginBottom: 16 }}>Bạn đang dùng mật khẩu mặc định. Vui lòng đổi mật khẩu để tiếp tục.</Text>
      )}
      <Field label="Mật khẩu hiện tại">
        <Input value={oldPassword} onChangeText={setOld} secureTextEntry />
      </Field>
      <Field label="Mật khẩu mới">
        <Input value={newPassword} onChangeText={setNew} secureTextEntry />
      </Field>
      <Field label="Nhập lại mật khẩu mới">
        <Input value={confirm} onChangeText={setConfirm} secureTextEntry />
      </Field>
      <Button title="Lưu" onPress={submit} loading={loading} />
    </ScrollView>
  );
}
