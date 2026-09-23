import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Select, Slider } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { Milestone, MilestoneMember } from '../types';
import { MILESTONE_STATUS_LABEL } from '../types';
import { AssigneeSelect } from './UserSelect';
import { isCancelled, useOutOfGroupGuard } from '../outOfGroup';

const toStr = (d?: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null);
const statusOptions = Object.entries(MILESTONE_STATUS_LABEL).map(([value, label]) => ({ value, label }));

/** Thêm / sửa mốc — dành cho người quản lý công việc */
export function MilestoneFormModal(props: { open: boolean; taskId: number; milestone?: Milestone | null; onClose: () => void }) {
  const { open, taskId, milestone, onClose } = props;
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const guard = useOutOfGroupGuard();

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
      return guard((extra) =>
        milestone ? api.put(`/milestones/${milestone.id}`, { ...body, ...extra }) : api.post(`/tasks/${taskId}/milestones`, { ...body, ...extra }),
      );
    },
    onSuccess: () => {
      message.success('Đã lưu mốc công việc');
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => !isCancelled(e) && message.error(e.message),
  });

  return (
    <Modal title={milestone ? `Sửa mốc ${milestone.seq}` : 'Thêm mốc / giao việc'} open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={save.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item name="content" label="Nội dung mốc" rules={[{ required: true }]}>
          <Input.TextArea autoSize={{ minRows: 2 }} />
        </Form.Item>
        <Form.Item
          name="assigneeId"
          label="Người chủ trì"
          tooltip="Người chịu trách nhiệm chính (vd Phó trưởng phòng). Người chủ trì có thể giao bổ sung cho nhân viên và đánh hoàn thành cả mốc."
        >
          <AssigneeSelect allowClear />
        </Form.Item>
        {!milestone && (
          <Form.Item
            name="memberIds"
            label="Người thực hiện (giao bổ sung, chọn nhiều)"
            tooltip="Mỗi người cập nhật phần việc của mình; tất cả xong thì mốc hoàn thành."
          >
            <AssigneeSelect multiple placeholder="Không bắt buộc" />
          </Form.Item>
        )}
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

/**
 * Cập nhật tiến độ.
 *  - scope "member": người thực hiện cập nhật phần việc của mình (part = phần của mình).
 *  - scope "milestone": người chủ trì / cấp quản lý cập nhật cả mốc. Mốc có nhiều người thực hiện thì
 *    % được tính tự động, chọn "Hoàn thành" = xác nhận hoàn thành cả mốc.
 */
export function ProgressModal(props: {
  open: boolean;
  milestone: Milestone | null;
  scope?: 'member' | 'milestone';
  part?: MilestoneMember | null;
  onClose: () => void;
}) {
  const { open, milestone, onClose } = props;
  const scope = props.scope ?? 'milestone';
  const cur = scope === 'member' ? props.part : milestone;
  const derived = scope === 'milestone' && !!milestone?.members.length;
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const status = Form.useWatch('status', form);

  useEffect(() => {
    if (open && cur) {
      form.setFieldsValue({
        status: cur.status,
        percent: cur.percent,
        note: cur.note,
        completedAt: cur.completedAt ? dayjs(cur.completedAt) : dayjs(),
      });
    }
  }, [open, cur, form]);

  const save = useMutation({
    mutationFn: (v: { status: string; percent: number; note?: string; completedAt?: Dayjs }) =>
      api.patch(`/milestones/${milestone!.id}/progress`, {
        scope,
        status: v.status,
        ...(derived ? {} : { percent: v.status === 'DONE' ? 100 : v.percent }),
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

  const left = milestone ? milestone.members.length - milestone.membersDone : 0;
  return (
    <Modal
      title={scope === 'member' ? 'Cập nhật phần việc của tôi' : derived ? 'Cập nhật cả mốc (chủ trì)' : 'Cập nhật tiến độ'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      destroyOnHidden
    >
      {milestone && <p style={{ color: '#555' }}>{milestone.content}</p>}
      {scope === 'member' && milestone && milestone.members.length > 1 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={`Mốc do ${milestone.members.length} người cùng thực hiện (${milestone.membersDone} người đã xong). Mốc hoàn thành khi tất cả đánh dấu xong.`}
        />
      )}
      {derived && (
        <Alert
          type={status === 'DONE' && left > 0 ? 'warning' : 'info'}
          showIcon
          style={{ marginBottom: 12 }}
          title={
            status === 'DONE' && left > 0
              ? `Còn ${left}/${milestone!.members.length} người chưa đánh dấu xong. Chọn "Hoàn thành" sẽ xác nhận hoàn thành cả mốc.`
              : `% mốc tự tính từ ${milestone!.members.length} người thực hiện (${milestone!.membersDone} đã xong).`
          }
        />
      )}
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
        {!derived && (
          <Form.Item name="percent" label="% hoàn thành">
            <Slider marks={{ 0: '0%', 25: '25%', 50: '50%', 75: '75%', 100: '100%' }} step={5} />
          </Form.Item>
        )}
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

/**
 * Giao bổ sung: người chủ trì mốc (Phó trưởng phòng) hoặc Trưởng phòng giao mốc cho NHIỀU nhân viên cùng thực hiện.
 * Mốc hoàn thành khi tất cả người thực hiện xong, hoặc khi chủ trì / cấp quản lý đánh hoàn thành.
 */
export function AddMembersModal(props: { milestone: Milestone | null; onClose: () => void }) {
  const { milestone, onClose } = props;
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const guard = useOutOfGroupGuard();

  useEffect(() => {
    if (milestone) {
      form.resetFields();
      form.setFieldsValue({ dueDate: milestone.dueDate ? dayjs(milestone.dueDate) : null });
    }
  }, [milestone, form]);

  const save = useMutation({
    mutationFn: (v: { userIds: number[]; dueDate?: Dayjs | null; note?: string }) =>
      guard((extra) =>
        api.post(`/milestones/${milestone!.id}/members`, { userIds: v.userIds, dueDate: toStr(v.dueDate), note: v.note || null, ...extra }),
      ),
    onSuccess: () => {
      message.success('Đã giao bổ sung');
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => !isCancelled(e) && message.error(e.message),
  });

  const exclude = milestone ? [...(milestone.assignee ? [milestone.assignee.id] : []), ...milestone.members.map((x) => x.user.id)] : [];
  return (
    <Modal title="Giao bổ sung người thực hiện" open={!!milestone} onCancel={onClose} onOk={() => form.submit()} okText="Giao việc" confirmLoading={save.isPending} destroyOnHidden>
      {milestone && (
        <>
          <p style={{ color: '#555', marginBottom: 4 }}>
            Mốc {milestone.seq}: {milestone.content}
          </p>
          {milestone.members.length > 0 && (
            <p style={{ fontSize: 13, color: '#888' }}>Đang thực hiện: {milestone.members.map((x) => x.user.fullName).join(', ')}</p>
          )}
        </>
      )}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="Có thể chọn nhiều người. Mốc hoàn thành khi tất cả đánh dấu xong, hoặc khi người chủ trì đánh hoàn thành."
      />
      <Form form={form} layout="vertical" onFinish={save.mutate}>
        <Form.Item name="userIds" label="Người thực hiện" rules={[{ required: true, message: 'Chọn ít nhất 1 người' }]}>
          <AssigneeSelect multiple excludeIds={exclude} placeholder="Chọn một hoặc nhiều nhân viên" />
        </Form.Item>
        <Form.Item name="dueDate" label="Hạn hoàn thành">
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="Chỉ đạo / ghi chú">
          <Input.TextArea autoSize={{ minRows: 2 }} placeholder="Yêu cầu cụ thể, phân công từng người..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
