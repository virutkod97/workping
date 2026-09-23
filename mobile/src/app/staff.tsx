import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FlatList, Linking, Pressable, Text, View } from 'react-native';
import { api } from '../lib/api';
import { colors } from '../lib/theme';
import type { User } from '../lib/types';
import { ROLE_LABEL } from '../lib/types';
import { Empty, Input, Tag, s } from '../components/ui';

const ROLE_ORDER = { ADMIN: 0, HEAD: 1, DEPUTY: 2, STAFF: 3 } as const;

export default function Staff() {
  const [q, setQ] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['users', 'ACTIVE'], queryFn: () => api.get<User[]>('/users') });
  const items = data
    .filter((u) => u.role !== 'ADMIN' && (!q || u.fullName.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.code.localeCompare(b.code));
  return (
    <FlatList
      data={items}
      keyExtractor={(u) => String(u.id)}
      ListHeaderComponent={<View style={{ padding: 12 }}><Input value={q} onChangeText={setQ} placeholder="🔍 Tìm theo tên" /></View>}
      ListEmptyComponent={!isLoading ? <Empty text="Không có nhân sự" /> : null}
      renderItem={({ item: u }) => (
        <View style={{ padding: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: colors.border }}>
          <View style={s.row}>
            <Text style={s.title}>{u.fullName}</Text>
            <Tag label={ROLE_LABEL[u.role]} tone={u.role === 'HEAD' ? 'danger' : u.role === 'DEPUTY' ? 'warning' : 'info'} />
          </View>
          <Text style={s.muted}>
            {u.code}
            {u.title ? ` · ${u.title}` : ''}
            {u.team ? ` · ${u.team}` : ''}
            {u.manager ? ` · QL: ${u.manager.fullName}` : ''}
          </Text>
          <View style={[s.row, { marginTop: 4, gap: 16 }]}>
            {u.phone && (
              <Pressable onPress={() => Linking.openURL(`tel:${u.phone}`)}>
                <Text style={{ color: colors.info }}>📞 {u.phone}</Text>
              </Pressable>
            )}
            {u.email && (
              <Pressable onPress={() => Linking.openURL(`mailto:${u.email}`)}>
                <Text style={{ color: colors.info }}>✉️ {u.email}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    />
  );
}
