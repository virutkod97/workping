import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'workping_token';
const SERVER_KEY = 'workping_server';

export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:4000/api';

let token: string | null = null;
let server = DEFAULT_SERVER;
let onUnauthorized: (() => void) | null = null;

export async function loadSession() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  server = (await SecureStore.getItemAsync(SERVER_KEY)) || DEFAULT_SERVER;
  return { token, server };
}

export async function setToken(t: string | null) {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function setServer(url: string) {
  server = url.trim().replace(/\/+$/, '') || DEFAULT_SERVER;
  await SecureStore.setItemAsync(SERVER_KEY, server);
}

export const getServer = () => server;
export const hasToken = () => !!token;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Không kết nối được máy chủ. Kiểm tra mạng hoặc địa chỉ máy chủ.');
  }
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* không phải JSON */
    }
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  delete: <T>(p: string, b?: unknown) => request<T>('DELETE', p, b),
};
