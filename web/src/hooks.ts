import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Category, UserBrief, User } from './types';

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });

export const useAssignable = () =>
  useQuery({ queryKey: ['assignable'], queryFn: () => api.get<(UserBrief & { managerId: number | null })[]>('/users/assignable') });

export const useUsers = (status: 'ACTIVE' | 'ALL' = 'ACTIVE') =>
  useQuery({ queryKey: ['users', status], queryFn: () => api.get<User[]>(`/users?status=${status}`) });

export const fmtDate = (s: string | null | undefined) => {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
