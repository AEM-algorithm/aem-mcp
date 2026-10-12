// Minimal HTML for the device-authorization / login exchange page.
//
// Phase 4. The form POSTs to `/oauth/authorize` with the user_code from
// `/oauth/device`, plus email/password (and optional TOTP). The handler
// (`login-exchange-handler.ts`) calls aem-backend, verifies the returned
// exchangeCode, and binds the verified userId to the device_code.
//
// Style: inline CSS only (no external assets), CSP-safe (no inline scripts).

export type DeviceAuthorizationPageInput = {
  userCode: string;
  error?: string;
  twoFactorRequired?: boolean;
  emailPrefill?: string;
  // When set, this is an authorization_code + PKCE request
  // (Cursor). The form will hide the device-code display and post
  // authRequestId back to /oauth/authorize, which will mint a one-shot
  // code and 302-redirect to the client's redirect_uri.
  authRequestId?: string;
};

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderDeviceAuthorizationPage(input: DeviceAuthorizationPageInput): string {
  const { userCode, error, twoFactorRequired, emailPrefill, authRequestId } = input;
  const isAuthCodeFlow = typeof authRequestId === 'string' && authRequestId.length > 0;
  const codeAttr = escape(userCode);
  const authRequestIdAttr = isAuthCodeFlow ? escape(authRequestId) : '';
  const emailAttr = emailPrefill ? escape(emailPrefill) : '';
  const errorBlock = error
    ? `<div class="error" role="alert" data-testid="form-error">${escape(error)}</div>`
    : '';
  const totpBlock = twoFactorRequired
    ? `<label for="totp">Authenticator code<input id="totp" name="totp" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" required /></label>`
    : '';
  // Device flow shows the XXXX-XXXX code; auth_code flow does not (the
  // user has nothing to type — Cursor already knows the request via
  // the authRequestId hidden field).
  const codeBlock = isAuthCodeFlow
    ? ''
    : `<div class="code" aria-label="device code">${codeAttr}</div>`;
  const lead = isAuthCodeFlow
    ? 'Sign in to authorize the agent that opened this page.'
    : 'Confirm the code shown by your agent, then sign in with your account.';
  const heading = isAuthCodeFlow
    ? 'Authorize your agent'
    : 'Sign in to connect your agent';
  const hiddenAuthRequestIdField = isAuthCodeFlow
    ? `<input type="hidden" name="authRequestId" value="${authRequestIdAttr}" />`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${escape(heading)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f7f7f8; margin: 0; padding: 2rem 1rem; color: #111; }
  main { max-width: 28rem; margin: 0 auto; background: #fff; border: 1px solid #e3e3e6; border-radius: 8px; padding: 1.5rem 1.75rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
  p.lead { margin: 0 0 1.25rem; color: #555; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.5rem; letter-spacing: 0.15em; text-align: center; padding: 0.75rem; border: 1px dashed #c7c7cc; border-radius: 4px; margin: 0 0 1.25rem; background: #fafafa; }
  label { display: block; margin: 0 0 0.875rem; font-size: 0.875rem; color: #333; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 0.25rem; padding: 0.625rem 0.75rem; border: 1px solid #c7c7cc; border-radius: 6px; font-size: 1rem; }
  button { display: block; width: 100%; padding: 0.75rem 1rem; border: 0; border-radius: 6px; background: #111; color: #fff; font-size: 1rem; cursor: pointer; }
  button:focus { outline: 2px solid #0066ff; outline-offset: 2px; }
  .error { background: #ffe8e8; border: 1px solid #ffb3b3; color: #8a1212; padding: 0.625rem 0.75rem; border-radius: 6px; margin: 0 0 1rem; font-size: 0.875rem; }
</style>
</head>
<body>
<main>
  <h1>${escape(heading)}</h1>
  <p class="lead">${escape(lead)}</p>
  ${codeBlock}
  ${errorBlock}
  <form method="POST" action="/oauth/authorize" autocomplete="off">
    ${hiddenAuthRequestIdField}
    <label for="email">Email<input id="email" name="email" type="email" autocomplete="username" value="${emailAttr}" required /></label>
    <label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required /></label>
    ${totpBlock}
    <button type="submit">Authorize</button>
  </form>
</main>
</body>
</html>`;
}

export function renderAuthorizationSuccessPage(userCode: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Connected</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #f7f7f8; margin: 0; padding: 2rem 1rem; color: #111; }
  main { max-width: 28rem; margin: 0 auto; background: #fff; border: 1px solid #e3e3e6; border-radius: 8px; padding: 1.5rem 1.75rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0; color: #555; }
</style>
</head>
<body>
<main>
  <h1>Agent connected</h1>
  <p>You can close this window and return to your agent. Code <strong>${escape(userCode)}</strong> is now authorized.</p>
</main>
</body>
</html>`;
}
