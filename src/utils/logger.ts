type LogFields = Record<string, string | number | boolean | undefined>;

export function logInfo(event: string, fields: LogFields = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', event, ...fields }));
}

export function logError(event: string, fields: LogFields = {}): void {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'error', event, ...fields }));
}
