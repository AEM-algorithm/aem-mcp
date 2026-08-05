export class ToolPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolPolicyError';
  }
}
