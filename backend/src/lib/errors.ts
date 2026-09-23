export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Chưa đăng nhập') => new HttpError(401, msg);
export const forbidden = (msg = 'Không có quyền thực hiện') => new HttpError(403, msg);
export const notFound = (msg = 'Không tìm thấy') => new HttpError(404, msg);
