// Minimal HTML for the device-authorization / login exchange page.
//
// Phase 4. The form POSTs to `/oauth/authorize` with the user_code from
// `/oauth/device`, plus email/password (and optional TOTP). The handler
// (`login-exchange-handler.ts`) calls aem-backend, verifies the returned
// exchangeCode, and binds the verified userId to the device_code.
//
// Phase 5 follow-up: four provider buttons (Google, Metamask, Xverse, Auth0)
// are shown below the email/password form. Auth0 and Google link to their
// respective aem-backend login endpoints when available; Metamask and
// Xverse are deferred to a future wallet-signing spec.
//
// Phase 6 (2026-10-15): unify visual with aem-frontend login. Tokens
// mirror aem-frontend/src/pages/user/login/style.less:
//   - heading + primary button: #0A4777 (Navy)
//   - accent (icon prefix, link, focus ring): #048DC1
//   - input: 299px wide, 40px tall, 4px radius
//   - page background: white (no card chrome)
//   - social row: centered flex with icon-only round buttons
// The form also gains: a typed FormError so the banner is accurate, a
// "Remember this device" checkbox, Forgot-password and Sign-up links
// that route to the aem-frontend app (when configured), and a loading-
// state affordance (button disabled + aria-busy on submit).
//
// Style: inline CSS only (no external assets), CSP-safe. The form has
// a single inline onsubmit handler that sets aria-busy on the submit
// button; the rest of the page is script-free.

import { renderErrorBanner, type FormError } from './error-banner';
import {
  renderFormFields,
  type FormFieldOptions,
} from './form-fields';
import { renderProviderButtons } from './provider-buttons';

export type { FormError } from './error-banner';

export type DeviceAuthorizationPageInput = {
  userCode: string;
  error?: FormError;
  twoFactorRequired?: boolean;
  emailPrefill?: string;
  // When set, this is an authorization_code + PKCE request
  // (Cursor). The form will hide the device-code display and post
  // authRequestId back to /oauth/authorize, which will mint a one-shot
  // code and 302-redirect to the client's redirect_uri.
  authRequestId?: string;
  // Optional backend base URL (e.g. http://localhost:3000) used to build
  // provider login links. When omitted, provider buttons are rendered
  // as disabled.
  backendUrl?: string;
  // Optional aem-frontend base URL (e.g. http://localhost:8000) used
  // to build the Forgot Password and Sign Up links. When omitted, the
  // links are hidden.
  frontendUrl?: string;
  // Optional pre-checked state for the "Remember this device"
  // checkbox. Defaults to true (matches aem-frontend default).
  rememberDevice?: boolean;
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
  const {
    userCode,
    error,
    twoFactorRequired,
    emailPrefill,
    authRequestId,
    backendUrl,
    frontendUrl,
    rememberDevice = true,
  } = input;
  const isAuthCodeFlow = typeof authRequestId === 'string' && authRequestId.length > 0;
  const codeAttr = escape(userCode);
  const authRequestIdAttr = isAuthCodeFlow ? escape(authRequestId) : '';
  const emailAttr = emailPrefill ? escape(emailPrefill) : '';
  const errorBlock = renderErrorBanner(error);
  // Device flow shows the XXXX-XXXX code; auth_code flow does not (the
  // user has nothing to type — Cursor already knows the request via
  // the authRequestId hidden field).
  const codeBlock = isAuthCodeFlow
    ? ''
    : userCode
      ? `<div class="code" aria-label="device code">${codeAttr}</div>`
      : '';
  const lead = isAuthCodeFlow
    ? 'Sign in to authorize the agent that opened this page.'
    : userCode
      ? 'Confirm the code shown by your agent, then sign in with your account.'
      : 'Enter the code shown by your agent, then sign in with your account.';
  const heading = isAuthCodeFlow
    ? 'Authorize your agent'
    : 'Sign in to connect your agent';
  const hiddenAuthRequestIdField = isAuthCodeFlow
    ? `<input type="hidden" name="authRequestId" value="${authRequestIdAttr}" />`
    : '';
  const deviceCodeField = isAuthCodeFlow
    ? ''
    : userCode
      ? `<input type="hidden" name="user_code" value="${codeAttr}" />`
      : `<label for="user_code">Device code<input id="user_code" name="user_code" type="text" inputmode="text" autocomplete="off" placeholder="ABCD-EFGH" required /></label>`;

  const fieldOptions: FormFieldOptions = {
    emailPrefill: emailAttr,
    twoFactorRequired,
    rememberDevice,
    frontendUrl,
  };
  const formFields = renderFormFields(fieldOptions);

  const providerButtons = renderProviderButtons(backendUrl);
  const submitLabel = isAuthCodeFlow ? 'Continue' : 'Authorize';

  // Note on CSP: the inline `onsubmit` is the only script in the page.
  // It just toggles aria-busy on the submit button so assistive tech
  // announces the loading state. It does not make any network call
  // and is safe under the existing CSP which allows 'unsafe-inline'
  // styles; for scripts we rely on the same policy. See references.md
  // for the follow-up to introduce a per-route nonce.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${escape(heading)}</title>
<style>
  /* Tokens mirror aem-frontend/src/pages/user/login/style.less.
     Keep these in sync with the frontend login page. */
  :root {
    --jf-primary: #048DC1;     /* accent: link + icon prefix + focus */
    --jf-navy: #0A4777;        /* heading + primary button */
    --jf-text: rgba(0, 0, 0, 0.85);
    --jf-text-secondary: rgba(0, 0, 0, 0.45);
    --jf-text-muted: #707070;
    --jf-border: #d9d9d9;
    --jf-placeholder: #9e9e9e;
    --jf-card: #ffffff;
    --jf-bg: #ffffff;
    --jf-error-bg: #fff2f0;
    --jf-error-border: #ffccc7;
    --jf-error-text: rgba(0, 0, 0, 0.85);
    --jf-warn-bg: #fffbe6;
    --jf-warn-border: #ffe58f;
    --jf-warn-text: #874d00;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif; background: var(--jf-bg); margin: 0; padding: 2rem 1rem; color: var(--jf-text); line-height: 1.5; }
  main { width: 299px; margin: 0 auto; }
  @media screen and (max-width: 600px) { main { width: 95%; } }
  h1 { color: var(--jf-navy); font-size: 24px; font-weight: 700; line-height: 28px; margin: 0 0 28px; text-align: left; }
  p.lead { margin: 0 0 24px; color: var(--jf-text-secondary); font-size: 0.9375rem; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.5rem; letter-spacing: 0.15em; text-align: center; padding: 0.75rem; border: 1px dashed var(--jf-border); border-radius: 4px; margin: 0 0 1.5rem; background: #fafafa; }
  .field { display: block; margin: 0 0 16px; font-size: 0.875rem; color: var(--jf-text); }
  .field > .label { display: block; margin-bottom: 6px; }
  .field > input { display: block; width: 100%; box-sizing: border-box; height: 40px; padding: 0 12px; border: 1px solid var(--jf-border); border-radius: 4px; font-size: 14px; color: var(--jf-text); background: #fff; transition: border-color 0.15s, box-shadow 0.15s; }
  .field > input::placeholder { color: var(--jf-placeholder); font-weight: 500; }
  .field > input:focus { outline: none; border-color: var(--jf-primary); box-shadow: 0 0 0 2px rgba(4, 141, 193, 0.2); }
  .field-row { display: flex; justify-content: space-between; align-items: center; margin: 0 0 24px; font-size: 14px; }
  .field-row label { display: inline-flex; align-items: center; gap: 8px; color: var(--jf-text-muted); cursor: pointer; }
  .field-row input[type="checkbox"] { accent-color: var(--jf-primary); width: 18px; height: 18px; border-radius: 4px; }
  .field-row a { color: var(--jf-primary); font-weight: 500; text-decoration: none; }
  .field-row a:hover { text-decoration: underline; }
  .field-row a:focus { outline: 2px solid var(--jf-primary); outline-offset: 2px; }
  button.btn-primary { display: block; width: 100%; height: 40px; border: 0; border-radius: 4px; background: var(--jf-navy); color: #fff; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.15s, opacity 0.15s; }
  button.btn-primary:hover:not(:disabled) { background: #0c558a; }
  button.btn-primary:focus { outline: 2px solid var(--jf-primary); outline-offset: 2px; }
  button.btn-primary:disabled { opacity: 0.6; cursor: progress; }
  button.btn-secondary { display: block; width: 100%; height: 40px; border: 0; border-radius: 4px; background: #ffffff; color: var(--jf-navy); border: 1px solid var(--jf-navy); font-size: 14px; font-weight: 500; margin-top: 12px; cursor: pointer; }
  button.btn-secondary:hover { background: var(--jf-navy); color: #fff; }
  .signup-row { display: flex; justify-content: flex-end; align-items: center; margin: 16px 0 0; font-size: 14px; color: var(--jf-text-muted); gap: 8px; }
  .signup-row a { color: var(--jf-primary); font-weight: 500; text-decoration: none; }
  .signup-row a:hover { text-decoration: underline; }
  .error { background: var(--jf-error-bg); border: 1px solid var(--jf-error-border); color: var(--jf-error-text); padding: 10px 12px; border-radius: 4px; margin: 0 0 12px; font-size: 12px; width: 100%; }
  .info { background: var(--jf-warn-bg); border: 1px solid var(--jf-warn-border); color: var(--jf-warn-text); padding: 10px 12px; border-radius: 4px; margin: 0 0 12px; font-size: 12px; width: 100%; }

  /* Divider: "Or sign in with" sandwiched between two horizontal rules. */
  .divider { display: flex; align-items: center; margin: 40px 0; color: #222; font-size: 14px; font-weight: 500; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #d9d9d9; }
  .divider > span { padding: 0 12px; }

  /* Provider buttons (icon-only round buttons in a centered row). */
  .providers { margin-top: 16px; }
  .providers-grid { display: flex; justify-content: center; align-items: center; gap: 19px; }
  .btn-provider { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--jf-border); background: #fff; color: var(--jf-text); text-decoration: none; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
  .btn-provider:hover:not(.disabled) { background: #f5f5f5; border-color: #bfbfbf; }
  .btn-provider:focus { outline: 2px solid var(--jf-primary); outline-offset: 2px; }
  .btn-provider.disabled { color: #aaa; cursor: not-allowed; background: #f5f5f5; border-color: #e0e0e2; opacity: 0.6; }
  .btn-provider.disabled:hover { background: #f5f5f5; }
  .provider-icon { width: 20px; height: 20px; flex-shrink: 0; }
</style>
</head>
<body>
<main>
  <h1>${escape(heading)}</h1>
  <p class="lead">${escape(lead)}</p>
  ${codeBlock}
  ${errorBlock}
  <form method="POST" action="/oauth/authorize" autocomplete="off" onsubmit="this.querySelector('button.btn-primary').setAttribute('aria-busy','true');this.querySelector('button.btn-primary').disabled=true;">
    ${hiddenAuthRequestIdField}
    ${deviceCodeField}
    ${formFields}
    <div class="field-row">
      <label><input type="checkbox" name="rememberDevice" value="1" ${rememberDevice ? 'checked' : ''} /> Remember Me</label>
      ${frontendUrl ? `<a href="${escape(frontendUrl + '/user/reset-password')}" target="_blank" rel="noopener noreferrer">Forgot Password</a>` : ''}
    </div>
    <button type="submit" class="btn-primary">${escape(submitLabel)}</button>
    ${frontendUrl
      ? `<button type="button" class="btn-secondary" onclick="window.open('${escape(frontendUrl + '/user/register')}','_blank','noopener,noreferrer')">Sign Up</button>
         <div class="signup-row"><span>New User?</span></div>`
      : ''}
  </form>
  <div class="divider"><span>Or sign in with</span></div>
  ${providerButtons}
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
