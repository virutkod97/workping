import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../lib/api';
import { colors } from '../lib/theme';
import type { Milestone, MilestoneStatus } from '../lib/types';
import { MILESTONE_STATUS_LABEL } from '../lib/types';
import { Button, Chips, Field, Input } from './ui';

const STEPS = [0, 10, 25, 50, 75, 90, 100];

/** Người thực hiện cập nhật tiến độ mốc */
export function ProgressSheet({ milestone, onClose }: { milestone: Milestone | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<MilestoneStatus>('NOT_STARTED');
  const [percent, setPercent] = useState(0);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (milestone) {
      setStatus(milestone.status);
      setPercent(milestone.percent);
      setNote(milestone.note ?? '');
    }
  }, [milestone]);

  const save = useMutation({
    mutationFn: () => api.patch(`/milestones/${milestone!.id}/progress`, { status, percent: status === 'DONE' ? 100 : percent, note: note || null }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => Alert.alert('Lỗi', e.message),
  });

  return (
    <Modal visible={!!milestone} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%' }}>
          <ScrollView contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 17, fontWeight: '700', marginBottom: 4 }}>Cập nhật tiến độ</Text>
            <Text style={{ color: colors.muted, marginBottom: 14 }}>{milestone?.content}</Text>
            <Field label="Trạng thái">
              <Chips
                value={status}
                onChange={(v) => {
                  setStatus(v);
                  if (v === 'DONE') setPercent(100);
                  else if (percent === 100) setPercent(90);
                }}
                options={(Object.keys(MILESTONE_STATUS_LABEL) as MilestoneStatus[]).map((k) => ({ value: k, label: MILESTONE_STATUS_LABEL[k] }))}
              />
            </Field>
            <Field label={`% hoàn thành: ${percent}%`}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {STEPS.map((p) => (
                  <Pressable
                    key={p}
                    onPress={() => {
                      setPercent(p);
                      if (p === 100) setStatus('DONE');
                      else if (p > 0 && (status === 'NOT_STARTED' || status === 'DONE')) setStatus('IN_PROGRESS');
                    }}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: percent === p ? colors.primary : '#F2F3F5' }}
                  >
                    <Text style={{ color: percent === p ? '#fff' : colors.text }}>{p}%</Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            <Field label="Ghi chú / báo cáo">
              <Input value={note} onChangeText={setNote} multiline placeholder="Kết quả, vướng mắc..." />
            </Field>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Huỷ" variant="default" onPress={onClose} style={{ flex: 1 }} />
              <Button title="Lưu" onPress={() => save.mutate()} loading={save.isPending} style={{ flex: 2 }} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
