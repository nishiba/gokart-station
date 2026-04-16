export class HttpError extends Error {
  readonly statusCode: number;
  readonly payload?: unknown;

  constructor(statusCode: number, message: string, payload?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}
