import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { getServer, setServer } from '../lib/api';
import { colors } from '../lib/theme';
import { Button, Field, Input } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [server, setSrv] = useState(getServer());
  const [showServer, setShowServer] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!username || !password) return;
    setLoading(true);
    try {
      await setServer(server);
      await login(username.trim(), password);
    } catch (e) {
      Alert.alert('Đăng nhập thất bại', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.primary }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', textAlign: 'center' }}>⏰ WorkPing</Text>
        <Text style={{ color: '#D6E4F0', textAlign: 'center', marginBottom: 28 }}>Quản lý tiến độ & nhắc việc</Text>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20 }}>
          <Field label="Tên đăng nhập">
            <Input value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="VD: ns002" />
          </Field>
          <Field label="Mật khẩu">
            <Input value={password} onChangeText={setPassword} secureTextEntry placeholder="••••••" onSubmitEditing={submit} />
          </Field>
          {showServer && (
            <Field label="Địa chỉ máy chủ">
              <Input value={server} onChangeText={setSrv} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            </Field>
          )}
          <Button title="Đăng nhập" onPress={submit} loading={loading} />
          <Pressable onPress={() => setShowServer((v) => !v)} style={{ marginTop: 14 }}>
            <Text style={{ textAlign: 'center', color: colors.muted, fontSize: 13 }}>{showServer ? 'Ẩn cấu hình máy chủ' : 'Cấu hình máy chủ'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
