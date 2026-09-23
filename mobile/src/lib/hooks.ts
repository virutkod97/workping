import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { Category, UserBrief } from './types';

export const useAssignable = () =>
  useQuery({ queryKey: ['assignable'], queryFn: () => api.get<(UserBrief & { managerId: number | null })[]>('/users/assignable') });

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories') });

export const useUnread = () =>
  useQuery({ queryKey: ['unread'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
