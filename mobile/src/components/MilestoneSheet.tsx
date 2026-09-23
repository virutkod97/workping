import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useAssignable } from '../lib/hooks';
import type { Milestone } from '../lib/types';
import { ROLE_LABEL } from '../lib/types';
import { Button, Field, Input } from './ui';
import { DateField, SelectField } from './pickers';

/** Thêm / sửa mốc & giao cho cấp dưới (dành cho người quản lý công việc) */
export function MilestoneSheet(props: { open: boolean; taskId: number; milestone?: Milestone | null; onClose: () => void }) {
  const { open, taskId, milestone, onClose } = props;
  const qc = useQueryClient();
  const { data: people = [] } = useAssignable();
  const [content, setContent] = useState('');
  const [assigneeId, setAssignee] = useState<number | null>(null);
  const [dueDate, setDue] = useState<string | null>(null);
  const [weight, setWeight] = useState('1');

  useEffect(() => {
    if (!open) return;
    setContent(milestone?.content ?? '');
    setAssignee(milestone?.assignee?.id ?? null);
    setDue(milestone?.dueDate ?? null);
    setWeight(String(milestone?.weight ?? 1));
  }, [open, milestone]);

  const save = useMutation({
    mutationFn: () => {
      const body = { content, assigneeId, dueDate, weight: Number(weight.replace(',', '.')) || 0 };
      return milestone ? api.put(`/milestones/${milestone.id}`, body) : api.post(`/tasks/${taskId}/milestones`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => Alert.alert('Lỗi', e.message),
  });

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 14 }}>{milestone ? `Sửa mốc ${milestone.seq}` : 'Thêm mốc / giao việc'}</Text>
            <Field label="Nội dung mốc">
              <Input value={content} onChangeText={setContent} multiline />
            </Field>
            <Field label="Người thực hiện">
              <SelectField
                title="Giao cho"
                allowClear
                value={assigneeId}
                onChange={setAssignee}
                placeholder="Chọn người"
                options={people.map((u) => ({ value: u.id, label: u.fullName, sub: `${ROLE_LABEL[u.role]}${u.team ? ` · ${u.team}` : ''}` }))}
              />
            </Field>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 2 }}>
                <Field label="Hạn hoàn thành">
                  <DateField value={dueDate} onChange={setDue} />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Trọng số">
                  <Input value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
                </Field>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Huỷ" variant="default" onPress={onClose} style={{ flex: 1 }} />
              <Button title="Lưu" onPress={() => save.mutate()} loading={save.isPending} disabled={!content.trim()} style={{ flex: 2 }} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
