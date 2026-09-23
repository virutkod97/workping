import { z, type ZodTypeAny } from 'zod';
import { badRequest } from './errors';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw badRequest(`${i.path.join('.') || 'dữ liệu'}: ${i.message}`);
  }
  return r.data;
}

export const idParam = z.coerce.number().int().positive();
export const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, 'định dạng YYYY-MM-DD')
  .nullable()
  .optional();
