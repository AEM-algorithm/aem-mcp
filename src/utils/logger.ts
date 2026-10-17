type LogFields = Record<string, string | number | boolean | undefined>;

export function logInfo(event: string, fields: LogFields = {}): void {
   
  console.log(JSON.stringify({ level: 'info', event, ...fields }));
}

export function logError(event: string, fields: LogFields = {}): void {
   
  console.error(JSON.stringify({ level: 'error', event, ...fields }));
}

export function logWarn(event: string, fields: LogFields = {}): void {

  console.warn(JSON.stringify({ level: 'warn', event, ...fields }));
}
