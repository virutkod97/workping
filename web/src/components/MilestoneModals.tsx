import { App, DatePicker, Form, Input, InputNumber, Modal, Select, Slider } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Milestone } from '../types';
import { MILESTONE_STATUS_LABEL } from '../types';
import { AssigneeSelect } from './UserSelect';

const toStr = (d?: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null);
const statusOptions = Object.entries(MILESTONE_STATUS_LABEL).map(([value, label]) => ({ value, label }));

/** Thêm / sửa mốc — dành cho người quản lý công việc */
export function MilestoneFormModal(props: { open: boolean; taskId: number; milestone?: Milestone | null; onClose: () => void }) {
  const { open, taskId, milestone, onClose } = props;
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (milestone) {
      form.setFieldsValue({
        ...milestone,
        assigneeId: milestone.assignee?.id ?? null,
        dueDate: milestone.dueDate ? dayjs(milestone.dueDate) : null,
      });
    } else form.setFieldsValue({ weight: 1 });
  }, [open, milestone, form]);

  const save = useMutation({
    mutationFn: (v: Record<string, unknown>) => {
      const body = { ...v, dueDate: toStr(v.dueDate as Dayjs), assigneeId: v.assigneeId ?? null };
      return milestone ? api.put(`/milestones/${milestone.id}`, body) : api.post(`/tasks/${taskId}/milestones`, body);
    },
    onSuccess: () => {
      message.success('Đã lưu mốc công việc');
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Modal title={milestone ? `Sửa mốc ${milestone.seq}` : 'Thêm mốc / giao việc'} open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="content" label="Nội dung mốc" rules={[{ required: true }]}>
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
        <Form.Item name="assigneeId" label="Người chịu trách nhiệm">
          <AssigneeSelect allowClear />
        </Form.Item>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="dueDate" label="Hạn hoàn thành" style={{ flex: 1 }}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="weight" label="Trọng số" style={{ width: 110 }}>
            <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="seq" label="STT" style={{ width: 80 }}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="unit" label="Đơn vị">
          <Input />
        </Form.Item>
        {milestone && (
          <Form.Item name="status" label="Trạng thái">
            <Select options={statusOptions} />
          </Form.Item>
        )}
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Cập nhật tiến độ — người thực hiện dùng */
export function ProgressModal(props: { open: boolean; milestone: Milestone | null; onClose: () => void }) {
  const { open, milestone, onClose } = props;
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const status = Form.useWatch('status', form);

  useEffect(() => {
    if (open && milestone) {
      form.setFieldsValue({
        status: milestone.status,
        percent: milestone.percent,
        note: milestone.note,
        completedAt: milestone.completedAt ? dayjs(milestone.completedAt) : dayjs(),
      });
    }
  }, [open, milestone, form]);

  const save = useMutation({
    mutationFn: (v: { status: string; percent: number; note?: string; completedAt?: Dayjs }) =>
      api.patch(`/milestones/${milestone!.id}/progress`, {
        status: v.status,
        percent: v.status === 'DONE' ? 100 : v.percent,
        note: v.note ?? null,
        completedAt: v.status === 'DONE' ? toStr(v.completedAt) : null,
      }),
    onSuccess: () => {
      message.success('Đã cập nhật tiến độ');
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Modal title="Cập nhật tiến độ" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnHidden>
      {milestone && <p style={{ color: '#555' }}>{milestone.content}</p>}
      <Form
        form={form}
        layout="vertical"
        onFinish={save.mutate}
        onValuesChange={(ch) => {
          if (ch.status === 'DONE') form.setFieldValue('percent', 100);
          if (ch.percent === 100) form.setFieldValue('status', 'DONE');
          else if ((ch.percent ?? 0) > 0 && form.getFieldValue('status') === 'NOT_STARTED') form.setFieldValue('status', 'IN_PROGRESS');
        }}
      >
        <Form.Item name="status" label="Trạng thái">
          <Select options={statusOptions} />
        </Form.Item>
        <Form.Item name="percent" label="% hoàn thành">
          <Slider marks={{ 0: '0%', 25: '25%', 50: '50%', 75: '75%', 100: '100%' }} step={5} />
        </Form.Item>
        {status === 'DONE' && (
          <Form.Item name="completedAt" label="Ngày hoàn thành">
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
        )}
        <Form.Item name="note" label="Ghi chú / báo cáo">
          <Input.TextArea autoSize={{ minRows: 2 }} placeholder="Kết quả, vướng mắc..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
