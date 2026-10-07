// Sends the two emails Scout needs: "confirm your address" and "reset your password". Server only.
// Uses the Resend HTTP API: set RESEND_API_KEY, and MAIL_FROM to an address on a domain you verified at https://resend.com/domains.
import { env } from './env.js';

export const mailConfigured = () => !!env('RESEND_API_KEY');
const PROD = process.env.NODE_ENV === 'production';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fail = (message, status = 503) => Object.assign(new Error(message), { status, expose: true });

// → { sent: true } or, in local development only without a key, { sent: false, devLink } so the flow can be tried offline.
export async function sendLink({ to, name, kind, link }) {
  const verify = kind === 'verify';
  const subject = verify ? 'Confirm your email for Scout' : 'Reset your Scout password';
  const lead = verify ? 'Confirm this email address to finish creating your Scout account.' : 'Use the button below to choose a new password for your Scout account.';
  const note = verify ? 'This link works once and expires in 24 hours. If you didn’t sign up, ignore this email: nothing was created.' : 'This link works once and expires in 30 minutes. If you didn’t ask for it, ignore this email: your password has not changed.';
  const text = `Hi ${name || 'there'},\n\n${lead}\n\n${link}\n\n${note}\n\nScout`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;color:#212121"><h2 style="font-weight:500">Scout</h2><p>Hi ${esc(name || 'there')},</p><p>${lead}</p><p><a href="${esc(link)}" style="display:inline-block;background:#17171c;color:#fff;padding:12px 24px;border-radius:30px;text-decoration:none">${verify ? 'Confirm email' : 'Choose a new password'}</a></p><p style="color:#75758a;font-size:13px">${note}</p></div>`;
  if (!mailConfigured()) {
    if (PROD) throw fail('Email is not set up on this server yet.');
    console.log(`[dev] ${subject} for ${to}: ${link}`);
    return { sent: false, devLink: link };
  }
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env('MAIL_FROM') || 'Scout <onboarding@resend.dev>', to: [to], subject, html, text }),
    });
  } catch (e) { console.error('email not sent (network):', e.message); throw fail('We couldn’t send the email right now. Please try again in a few minutes.'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`email not sent (Resend ${res.status}):`, body.message || body.name || '');   // the owner sees the reason in the server log, e.g. "domain is not verified"
    throw fail('We couldn’t send the email right now. Please try again in a few minutes.');
  }
  return { sent: true };
}
