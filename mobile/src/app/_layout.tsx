import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../lib/auth';
import { listenForeground, listenOpened, type PushData } from '../lib/push';
import { colors } from '../lib/theme';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <StatusBar style="light" />
          <Gate />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const { user, ready } = useAuth();
  const segments = useSegments();
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<PushData | null>(null);

  // Điều hướng theo trạng thái đăng nhập
  useEffect(() => {
    if (!ready) return;
    const inLogin = segments[0] === 'login';
    if (!user && !inLogin) router.replace('/login');
    else if (user && inLogin) router.replace('/');
    else if (user?.mustChangePassword && segments[0] !== 'change-password') router.push('/change-password');
  }, [user, ready, segments]);

  // Push: đang mở app → hiện banner + làm mới dữ liệu; bấm vào thông báo → mở công việc
  useEffect(() => {
    if (!user) return;
    const off1 = listenForeground((d) => {
      setBanner(d);
      queryClient.invalidateQueries();
    });
    const off2 = listenOpened((d) => {
      queryClient.invalidateQueries();
      router.push(d.taskId ? `/task/${d.taskId}` : '/my-work');
    });
    return () => {
      off1();
      off2();
    };
  }, [user, queryClient]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
          headerBackTitle: 'Quay lại',
        }}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: 'Chi tiết công việc' }} />
        <Stack.Screen name="task/new" options={{ title: 'Giao việc mới', presentation: 'modal' }} />
        <Stack.Screen name="staff" options={{ title: 'Danh bạ nhân sự' }} />
        <Stack.Screen name="change-password" options={{ title: 'Đổi mật khẩu', presentation: 'modal' }} />
      </Stack>
      {banner && <Banner data={banner} onClose={() => setBanner(null)} />}
    </>
  );
}

function Banner({ data, onClose }: { data: PushData; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-120)).current;
  useEffect(() => {
    Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [data, y, onClose]);
  return (
    <Animated.View style={{ position: 'absolute', left: 10, right: 10, top: insets.top + 6, transform: [{ translateY: y }] }}>
      <Pressable
        onPress={() => {
          onClose();
          router.push(data.taskId ? `/task/${data.taskId}` : '/notifications');
        }}
        style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 6, borderLeftWidth: 4, borderLeftColor: colors.primary }}
      >
        <Text style={{ fontWeight: '700', fontSize: 15 }}>🔔 {data.title}</Text>
        <Text style={{ color: colors.muted, marginTop: 2 }} numberOfLines={2}>
          {data.body}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
