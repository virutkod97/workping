import { Select } from 'antd';
import { useAssignable } from '../hooks';
import { ROLE_LABEL } from '../types';

/** Chọn người nhận việc — chỉ hiện những người mình được phép giao (theo cấp) */
export function AssigneeSelect(props: { value?: number | null; onChange?: (v: number | null) => void; allowClear?: boolean; placeholder?: string }) {
  const { data = [], isLoading } = useAssignable();
  return (
    <Select
      showSearch={{ optionFilterProp: 'label' }}
      loading={isLoading}
      allowClear={props.allowClear}
      placeholder={props.placeholder ?? 'Chọn người'}
      value={props.value ?? undefined}
      onChange={(v) => props.onChange?.(v ?? null)}
      options={data.map((u) => ({
        value: u.id,
        label: `${u.fullName} — ${ROLE_LABEL[u.role]}${u.team ? ` (${u.team})` : ''}`,
      }))}
    />
  );
}
