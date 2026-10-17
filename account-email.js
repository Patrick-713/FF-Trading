/** Transactional account mail. Tokens never appear in server logs or API responses. */
import { AppError } from './errors.js';

export async function sendAccountEmail(email, purpose, token) {
  const { RESEND_API_KEY, EMAIL_FROM, EMAIL_APP_ORIGIN } = process.env;
  if (!RESEND_API_KEY || !EMAIL_FROM || !EMAIL_APP_ORIGIN)
    throw new AppError(
      503,
      'EMAIL_UNAVAILABLE',
      'Account email is temporarily unavailable. Please try again later.',
    );
  const origin = new URL(EMAIL_APP_ORIGIN);
  if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1')
    throw new Error('Account email requires a secure public origin.');
  const link = new URL('/', origin);
  link.hash = new URLSearchParams({ action: purpose, token }).toString();
  const verification = purpose === 'verify';
  const subject = verification ? 'Verify your FF Trading email' : 'Reset your FF Trading password';
  const text = `${subject}\n\nOpen this link: ${link.href}\n\nThis link works once and expires in ${verification ? '24 hours' : '30 minutes'}. If you did not request it, you can ignore this email.`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new AppError(
      503,
      'EMAIL_UNAVAILABLE',
      'We could not send the account email. Please try again later.',
    );
}
