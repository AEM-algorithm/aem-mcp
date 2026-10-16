// Email / Password / TOTP fields for the device-authorization page.
//
// The fields mirror the aem-frontend login page visually (label-above
// inputs, 4px radius, focus ring in #048DC1). 2FA mode adds a TOTP
// field with `inputmode="numeric"` and `pattern` to nudge mobile
// keyboards and disable alpha input.

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type FormFieldOptions = {
  emailPrefill: string;
  twoFactorRequired?: boolean;
  rememberDevice?: boolean;
  frontendUrl?: string;
};

export function renderFormFields(opts: FormFieldOptions): string {
  const emailPrefill = escape(opts.emailPrefill);
  const showTotp = opts.twoFactorRequired === true;

  const emailField = `
<label class="field" for="email">
  <span class="label">Email</span>
  <input id="email" name="email" type="email" autocomplete="username" value="${emailPrefill}" required />
</label>`;

  const passwordField = `
<label class="field" for="password">
  <span class="label">Password</span>
  <input id="password" name="password" type="password" autocomplete="current-password" required />
</label>`;

  const totpField = showTotp
    ? `
<label class="field" for="totp">
  <span class="label">Authenticator code</span>
  <input id="totp" name="totp" type="text" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" minlength="6" maxlength="6" required />
</label>`
    : '';

  return `${emailField}${passwordField}${totpField}`;
}
