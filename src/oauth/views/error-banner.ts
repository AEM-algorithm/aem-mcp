// Form error banner for the device-authorization / login exchange page.
//
// The handler (`login-exchange-handler.ts`) maps backend error codes
// to a typed `FormError`. The view renders a banner with the right
// tone (red for invalid credentials, amber for 2FA required, etc.)
// instead of a single hard-coded message.
//
// Pure-HTML output; no inline scripts. Style classes are scoped to
// the page (`.error`, `.info`) and match the rest of the view.

export type FormError =
  | { kind: 'invalidCredentials' }
  | { kind: 'twoFactorRequired' }
  | { kind: 'exchangeCodeInvalid' }
  | { kind: 'backendUnavailable' }
  | { kind: 'rateLimited' }
  | { kind: 'invalidInput' }
  | { kind: 'deviceCodeInvalid' }
  | { kind: 'deviceCodeExpired' }
  | { kind: 'custom'; message: string };

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ERROR_MESSAGES: Record<Exclude<FormError['kind'], 'custom'>, string> = {
  invalidCredentials: 'Invalid email or password.',
  twoFactorRequired: 'Enter your authenticator code.',
  exchangeCodeInvalid:
    'Authentication service returned an invalid code. Please try again.',
  backendUnavailable:
    'Authentication service is unavailable. Please try again shortly.',
  rateLimited: 'Too many attempts. Please wait a moment and try again.',
  invalidInput: 'Enter a valid email and password.',
  deviceCodeInvalid: 'Enter the valid device code shown by your agent.',
  deviceCodeExpired:
    'This device code has expired or is not valid. Enter the current code from your agent.',
};

export function renderErrorBanner(error: FormError | undefined): string {
  if (!error) return '';
  const message =
    error.kind === 'custom' ? error.message : ERROR_MESSAGES[error.kind];
  // Two-factor is an instructional prompt, not a failure: render it as
  // info (amber) so it does not look like an error.
  const tone = error.kind === 'twoFactorRequired' ? 'info' : 'error';
  return `<div class="${tone}" role="alert" data-testid="form-error" data-error-kind="${escape(error.kind)}">${escape(message)}</div>`;
}
