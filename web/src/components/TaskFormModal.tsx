import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { useCategories } from '../hooks';
import type { Task } from '../types';
import { AssigneeSelect } from './UserSelect';

interface Props {
  open: boolean;
  task?: Task | null; // có = sửa
  onClose: () => void;
  onSaved?: (t: Task) => void;
}

const toStr = (d?: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null);

export function TaskFormModal({ open, task, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const { user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { data: cats = [] } = useCategories();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (task) {
      form.setFieldsValue({
        ...task,
        ownerId: task.owner.id,
        startDate: task.startDate ? dayjs(task.startDate) : null,
        dueDate: task.dueDate ? dayjs(task.dueDate) : null,
      });
    } else {
      form.setFieldsValue({ priority: 'MEDIUM', ownerId: user?.id, startDate: dayjs(), milestones: [] });
    }
  }, [open, task, form, user]);

  const save = useMutation({
    mutationFn: async (v: Record<string, unknown>) => {
      const body = {
        ...v,
        startDate: toStr(v.startDate as Dayjs),
        dueDate: toStr(v.dueDate as Dayjs),
        milestones: task
          ? undefined
          : ((v.milestones as Record<string, unknown>[] | undefined) ?? []).map((m) => ({ ...m, dueDate: toStr(m.dueDate as Dayjs) })),
      };
      return task ? api.put<Task>(`/tasks/${task.id}`, body) : api.post<Task>('/tasks', body);
    },
    onSuccess: (t) => {
      message.success(task ? 'Đã cập nhật công việc' : `Đã tạo công việc ${t.code}`);
      qc.invalidateQueries();
      onSaved?.(t);
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  return (
    <Modal
      title={task ? `Sửa công việc ${task.code}` : 'Giao việc mới'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={task ? 'Lưu' : 'Giao việc'}
      confirmLoading={save.isPending}
      width={820}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="title" label="Tên công việc" rules={[{ required: true, message: 'Nhập tên công việc' }]}>
          <Input.TextArea autoSize={{ minRows: 2 }} placeholder="VD: VB 178/TTBVPC ngày 14/9 — Rà soát nội dung kiểm soát tuân thủ" />
        </Form.Item>
        <Space.Compact block style={{ gap: 12, display: 'flex', flexWrap: 'wrap' }}>
          <Form.Item name="ownerId" label="Người phụ trách chung" style={{ flex: 2, minWidth: 240 }} rules={[{ required: true }]}>
            <AssigneeSelect />
          </Form.Item>
          <Form.Item name="priority" label="Ưu tiên" style={{ flex: 1, minWidth: 120 }}>
            <Select options={[{ value: 'HIGH', label: 'Cao' }, { value: 'MEDIUM', label: 'Trung bình' }, { value: 'LOW', label: 'Thấp' }]} />
          </Form.Item>
        </Space.Compact>
        <Space.Compact block style={{ gap: 12, display: 'flex', flexWrap: 'wrap' }}>
          <Form.Item name="groupName" label="Nhóm công việc" style={{ flex: 1, minWidth: 160 }}>
            <Select allowClear options={cats.filter((c) => c.type === 'TASK_GROUP').map((c) => ({ value: c.name, label: c.name }))} />
          </Form.Item>
          <Form.Item name="unit" label="Đơn vị/Bộ phận" style={{ flex: 1, minWidth: 160 }}>
            <Select allowClear options={cats.filter((c) => c.type === 'TEAM').map((c) => ({ value: c.name, label: c.name }))} />
          </Form.Item>
          <Form.Item name="startDate" label="Ngày bắt đầu" style={{ flex: 1, minWidth: 140 }}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="dueDate" label="Hạn cuối" style={{ flex: 1, minWidth: 140 }}>
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </Space.Compact>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
        </Form.Item>

        {!task && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              Các mốc công việc <span style={{ fontWeight: 400, color: '#888' }}>(bỏ trống = 1 mốc giao cho người phụ trách)</span>
            </div>
            <Form.List name="milestones">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name }, i) => (
                    <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <span style={{ paddingTop: 6, width: 20 }}>{i + 1}.</span>
                      <Form.Item name={[name, 'content']} rules={[{ required: true, message: 'Nhập nội dung' }]} style={{ flex: 3, minWidth: 200 }}>
                        <Input placeholder="Nội dung mốc" />
                      </Form.Item>
                      <Form.Item name={[name, 'assigneeId']} style={{ flex: 2, minWidth: 180 }}>
                        <AssigneeSelect allowClear placeholder="Người thực hiện" />
                      </Form.Item>
                      <Form.Item name={[name, 'dueDate']} style={{ width: 140 }}>
                        <DatePicker format="DD/MM/YYYY" placeholder="Hạn" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[name, 'weight']} initialValue={1} style={{ width: 80 }} tooltip="Trọng số">
                        <InputNumber min={0} step={0.5} placeholder="Trọng số" style={{ width: '100%' }} />
                      </Form.Item>
                      <MinusCircleOutlined style={{ paddingTop: 9 }} onClick={() => remove(name)} />
                    </div>
                  ))}
                  <Button type="dashed" onClick={() => add({ weight: 1 })} icon={<PlusOutlined />} block>
                    Thêm mốc
                  </Button>
                </>
              )}
            </Form.List>
          </>
        )}
      </Form>
    </Modal>
  );
}
