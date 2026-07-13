type BackendEnvelope = {
  status?: string;
  data?: unknown;
  message?: string;
};

export function normalizeBackendResponse(body: unknown): unknown {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const envelope = body as BackendEnvelope;
  if (envelope.status === 'success' && 'data' in envelope) {
    return envelope.data;
  }

  return body;
}

export function extractBackendErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') {
    return fallback;
  }

  const record = body as { message?: string; error?: string };
  return record.message ?? record.error ?? fallback;
}
