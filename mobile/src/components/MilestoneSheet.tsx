import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { api } from '../lib/api';
import { useAssignable } from '../lib/hooks';
import type { Milestone } from '../lib/types';
import { isCancelled, OutOfGroupHint, personOptions, useOutOfGroupGuard } from './OutOfGroup';
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
  const [guard, guardModal] = useOutOfGroupGuard();

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
      return guard((extra) =>
        milestone ? api.put(`/milestones/${milestone.id}`, { ...body, ...extra }) : api.post(`/tasks/${taskId}/milestones`, { ...body, ...extra }),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => !isCancelled(e) && Alert.alert('Lỗi', e.message),
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
                options={personOptions(people)}
              />
              <OutOfGroupHint people={people} id={assigneeId} />
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
      {guardModal}
    </Modal>
  );
}

/** Giao tiếp: Phó trưởng phòng chuyển mốc mình đang nhận xuống nhân viên */
export function DelegateSheet({ milestone, onClose }: { milestone: Milestone | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: people = [] } = useAssignable();
  const [assigneeId, setAssignee] = useState<number | null>(null);
  const [dueDate, setDue] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [guard, guardModal] = useOutOfGroupGuard();

  useEffect(() => {
    if (!milestone) return;
    setAssignee(null);
    setDue(milestone.dueDate);
    setNote('');
  }, [milestone]);

  const save = useMutation({
    mutationFn: () => guard((extra) => api.post(`/milestones/${milestone!.id}/delegate`, { assigneeId, dueDate, note: note || null, ...extra })),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => !isCancelled(e) && Alert.alert('Lỗi', e.message),
  });

  return (
    <Modal visible={!!milestone} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 4 }}>Giao tiếp cho nhân viên</Text>
            <Text style={{ color: '#6B7280', marginBottom: 14 }}>{milestone?.content}</Text>
            <Field label="Giao cho">
              <SelectField title="Giao cho" value={assigneeId} onChange={setAssignee} placeholder="Chọn người" options={personOptions(people, milestone?.assignee?.id)} />
              <OutOfGroupHint people={people} id={assigneeId} />
            </Field>
            <Field label="Hạn hoàn thành">
              <DateField value={dueDate} onChange={setDue} />
            </Field>
            <Field label="Chỉ đạo / ghi chú">
              <Input value={note} onChangeText={setNote} multiline placeholder="Yêu cầu cụ thể cho người thực hiện" />
            </Field>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Huỷ" variant="default" onPress={onClose} style={{ flex: 1 }} />
              <Button title="Giao tiếp" onPress={() => save.mutate()} loading={save.isPending} disabled={!assigneeId} style={{ flex: 2 }} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      {guardModal}
    </Modal>
  );
}
