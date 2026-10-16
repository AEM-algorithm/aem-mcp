// Social / wallet provider buttons rendered below the email/password
// form on the device-authorization page.
//
// Auth0 and Google link to aem-backend endpoints when a backendUrl is
// provided. MetaMask and Xverse are wallet-signing flows deferred to
// a follow-up spec; they are rendered as disabled buttons with a
// tooltip so the grid layout stays stable.

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Auth0 wordmark (cleaner than the dot placeholder used in earlier
// versions). Inline SVG keeps CSP `default-src 'none'` working.
const AUTH0_SVG = `
<svg class="provider-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="2" y="9" width="20" height="2" fill="#EB5424"/>
  <path d="M12 2 L7 11 L12 8 L17 11 Z" fill="#EB5424"/>
  <path d="M12 8 L7 11 L12 14 L17 11 Z" fill="#B14622"/>
  <path d="M7 11 L12 14 L12 22 Z" fill="#EB5424"/>
  <path d="M17 11 L12 14 L12 22 Z" fill="#B14622"/>
</svg>`;

const GOOGLE_SVG = `
<svg class="provider-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
</svg>`;

const METAMASK_SVG = `
<svg class="provider-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M20.1 3.6L14 7.5l1.6 1.1 3.8-2.8-1.6-1.1-2.5 1.8 2.5-1.8-1.6-1.1-6.4 4.6 2.1 1.5 2.9-2.1 2.1 1.5-2.9 2.1 2.3 1.6 6.6-4.8 1.3-.9 1.3-1.7-.1-.4z" fill="#E2761B"/>
  <path d="M3.9 20.4l2.5-1.4 2.2 1.6-6.2-8.4 1.5 8.2zM18 17.5l-2.6 1.5 1.5.9 1.1-2.4zM9 19.5l2.1-1.2-1.9-1.4.9-1.5-1.1 3.1zM5.4 12L7 14.1l-1.6 1.2 2.5 1.4L5.4 12zm6.7 1.6l-2.2-1.6 2.5 1.5-1.1 2.4 1.5-.9-.7-2.4zm-4.5 0l-.7 2.4 1.5.9-2.5-1.5 2.2 1.6-1.5-.9.7-2.4-.7-1.1z" fill="#E4761B"/>
</svg>`;

const XVERSE_SVG = `
<svg class="provider-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="12" cy="12" r="10" fill="#231F20"/>
  <path d="M16.5 8.5c0 1.5-1 2.5-2.5 3l1 3.5h-2l-.5-2h-2l1.5 3.5h-2l-2.5-8h2l1 3.5 1.5-3.5h1l1 3h-1l1 3.5h-2l-1-3.5h-.5l1.5 3.5h2l2-3.5-1-3.5h-2l-1.5 3.5.5-3.5h2l2-3.5z" fill="#fff"/>
</svg>`;

export function renderProviderButtons(backendUrl?: string): string {
  const auth0Href = backendUrl ? `${backendUrl}/api/auth0/login` : '#';
  const auth0Disabled = !backendUrl;
  const auth0Title = auth0Disabled
    ? 'title="Auth0 login will be available once configured"'
    : '';
  const auth0Class = auth0Disabled
    ? ' class="btn-provider disabled"'
    : ' class="btn-provider"';

  const googleHref = backendUrl ? `${backendUrl}/api/oauth/google/login` : '#';
  const googleDisabled = !backendUrl;
  const googleTitle = googleDisabled
    ? ' title="Coming soon — Google login is not yet available"'
    : '';
  const googleClass = googleDisabled
    ? ' class="btn-provider disabled"'
    : ' class="btn-provider"';

  const disabledTitle =
    ' title="Coming soon — use email/password for wallet login"';
  const disabledClass = ' class="btn-provider disabled"';

  return `
<div class="providers">
  <div class="providers-label">or sign in with</div>
  <div class="providers-grid">
    <a${auth0Class} data-provider="auth0" href="${escape(auth0Href)}"${auth0Disabled ? auth0Title : ''}${auth0Disabled ? ' aria-disabled="true" tabindex="-1"' : ''}>
      ${AUTH0_SVG}
    </a>
    <a${googleClass} data-provider="google" href="${escape(googleHref)}"${googleDisabled ? googleTitle : ''}${googleDisabled ? ' aria-disabled="true" tabindex="-1"' : ''}>
      ${GOOGLE_SVG}
    </a>
    <span${disabledClass} data-provider="metamask"${disabledTitle} aria-disabled="true" tabindex="-1" role="button">
      ${METAMASK_SVG}
    </span>
    <span${disabledClass} data-provider="xverse"${disabledTitle} aria-disabled="true" tabindex="-1" role="button">
      ${XVERSE_SVG}
    </span>
  </div>
</div>`;
}
