import { App, Input } from 'antd';
import { useCallback } from 'react';
import { ApiError } from './api';

export interface OutOfGroupExtra {
  confirmOutOfGroup?: boolean;
  outOfGroupReason?: string | null;
}

/** Người dùng bấm "Huỷ" ở hộp cảnh báo — không phải lỗi, không hiện thông báo */
export class Cancelled extends Error {}

export const isCancelled = (e: unknown): boolean => e instanceof Cancelled;

/**
 * Bọc một lệnh giao việc: nếu server trả 409 OUT_OF_GROUP (Phó trưởng phòng giao cho người ngoài nhóm)
 * thì hiện cảnh báo + ô lý do; người dùng xác nhận thì gửi lại kèm confirmOutOfGroup.
 */
export function useOutOfGroupGuard() {
  const { modal } = App.useApp();
  return useCallback(
    async <T,>(fn: (extra: OutOfGroupExtra) => Promise<T>): Promise<T> => {
      try {
        return await fn({});
      } catch (e) {
        if (!(e instanceof ApiError) || e.data.code !== 'OUT_OF_GROUP') throw e;
        const people = (e.data.people as { id: number; fullName: string; groupLead: string | null }[]) ?? [];
        let reason = '';
        const ok = await new Promise<boolean>((resolve) => {
          modal.confirm({
            title: 'Giao việc cho nhân sự ngoài nhóm phụ trách',
            width: 540,
            okText: 'Vẫn giao việc',
            cancelText: 'Huỷ',
            content: (
              <div>
                <p style={{ marginBottom: 8 }}>Những người sau không thuộc nhóm bạn phụ trách:</p>
                <ul style={{ paddingLeft: 20, marginTop: 0 }}>
                  {people.map((p) => (
                    <li key={p.id}>
                      <b>{p.fullName}</b> — {p.groupLead ? `nhóm ${p.groupLead}` : 'do Trưởng phòng quản lý trực tiếp'}
                    </li>
                  ))}
                </ul>
                <p style={{ color: '#d46b08' }}>Vẫn giao được, nhưng việc này sẽ được ghi nhận vào báo cáo giao việc ngoài nhóm và báo cho người quản lý nhóm đó.</p>
                <Input.TextArea placeholder="Lý do giao ngoài nhóm (nên ghi để tổng hợp báo cáo)" autoSize={{ minRows: 2 }} onChange={(ev) => (reason = ev.target.value)} />
              </div>
            ),
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!ok) throw new Cancelled();
        return fn({ confirmOutOfGroup: true, outOfGroupReason: reason.trim() || null });
      }
    },
    [modal],
  );
}
