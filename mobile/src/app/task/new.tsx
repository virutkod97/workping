import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAssignable, useCategories } from '../../lib/hooks';
import { colors } from '../../lib/theme';
import type { Priority, Task } from '../../lib/types';
import { ROLE_LABEL } from '../../lib/types';
import { Button, Chips, Field, Input, s } from '../../components/ui';
import { DateField, SelectField } from '../../components/pickers';

interface MsDraft {
  content: string;
  assigneeId: number | null;
  dueDate: string | null;
}

/** Giao việc: người giao (cấp 1) → người phụ trách chung (cấp 2) → mốc cho người thực hiện (cấp 3) */
export default function NewTask() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: people = [] } = useAssignable();
  const { data: cats = [] } = useCategories();
  const [title, setTitle] = useState('');
  const [ownerId, setOwner] = useState<number | null>(user?.id ?? null);
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [groupName, setGroup] = useState<string | null>(null);
  const [dueDate, setDue] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [ms, setMs] = useState<MsDraft[]>([]);

  const peopleOpts = people.map((u) => ({ value: u.id, label: u.fullName, sub: `${ROLE_LABEL[u.role]}${u.team ? ` · ${u.team}` : ''}` }));

  const save = useMutation({
    mutationFn: () =>
      api.post<Task>('/tasks', {
        title,
        ownerId,
        priority,
        groupName,
        dueDate,
        note: note || null,
        milestones: ms.filter((m) => m.content.trim()).map((m) => ({ ...m, weight: 1 })),
      }),
    onSuccess: (t) => {
      qc.invalidateQueries();
      router.replace(`/task/${t.id}`);
    },
    onError: (e: Error) => Alert.alert('Lỗi', e.message),
  });

  const upd = (i: number, patch: Partial<MsDraft>) => setMs((arr) => arr.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Field label="Tên công việc *">
          <Input value={title} onChangeText={setTitle} multiline placeholder="VD: VB 178/TTBVPC — Rà soát nội dung..." />
        </Field>
        <Field label="Người phụ trách chung *">
          <SelectField title="Người phụ trách chung" value={ownerId} onChange={setOwner} options={peopleOpts} />
        </Field>
        <Field label="Ưu tiên">
          <Chips value={priority} onChange={setPriority} options={[{ value: 'HIGH', label: 'Cao' }, { value: 'MEDIUM', label: 'Trung bình' }, { value: 'LOW', label: 'Thấp' }]} />
        </Field>
        <Field label="Hạn cuối">
          <DateField value={dueDate} onChange={setDue} />
        </Field>
        <Field label="Nhóm công việc">
          <SelectField
            title="Nhóm công việc"
            allowClear
            value={groupName}
            onChange={setGroup}
            options={cats.filter((c) => c.type === 'TASK_GROUP').map((c) => ({ value: c.name, label: c.name }))}
          />
        </Field>
        <Field label="Ghi chú">
          <Input value={note} onChangeText={setNote} multiline />
        </Field>

        <Text style={[s.title, { marginBottom: 4 }]}>Các mốc / giao cho người thực hiện</Text>
        <Text style={[s.muted, { marginBottom: 10 }]}>Bỏ trống = 1 mốc giao cho người phụ trách chung.</Text>
        {ms.map((m, i) => (
          <View key={i} style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontWeight: '700' }}>Mốc {i + 1}</Text>
              <Pressable onPress={() => setMs((arr) => arr.filter((_, j) => j !== i))}>
                <Text style={{ color: colors.danger }}>Xoá</Text>
              </Pressable>
            </View>
            <Input value={m.content} onChangeText={(v) => upd(i, { content: v })} placeholder="Nội dung mốc" style={{ marginBottom: 8 }} />
            <SelectField title="Người thực hiện" allowClear value={m.assigneeId} onChange={(v) => upd(i, { assigneeId: v })} placeholder="Người thực hiện" options={peopleOpts} />
            <View style={{ height: 8 }} />
            <DateField value={m.dueDate} onChange={(v) => upd(i, { dueDate: v })} placeholder="Hạn mốc" />
          </View>
        ))}
        <Button title="＋ Thêm mốc" variant="default" onPress={() => setMs((a) => [...a, { content: '', assigneeId: null, dueDate: dueDate }])} style={{ marginBottom: 20 }} />
        <Button title="Giao việc" onPress={() => save.mutate()} loading={save.isPending} disabled={!title.trim() || !ownerId} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
