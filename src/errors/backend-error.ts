export class BackendError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'BackendError';
    this.statusCode = statusCode;
  }
}
