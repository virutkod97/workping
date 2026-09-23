import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/tabs';
import { useUnread } from '../../lib/hooks';
import { colors } from '../../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) => ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} size={size} color={color as string} />;

export default function TabsLayout() {
  const { data: unread } = useUnread();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Tổng quan', tabBarIcon: icon('speedometer-outline') }} />
      <Tabs.Screen name="my-work" options={{ title: 'Việc của tôi', tabBarIcon: icon('checkbox-outline') }} />
      <Tabs.Screen name="tasks" options={{ title: 'Công việc', tabBarIcon: icon('list-outline') }} />
      <Tabs.Screen
        name="notifications"
        options={{ title: 'Thông báo', tabBarIcon: icon('notifications-outline'), tabBarBadge: unread?.count ? unread.count : undefined }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Cá nhân', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
