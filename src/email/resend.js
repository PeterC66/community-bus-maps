// Thin wrapper over Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
// No SDK dependency — it's one POST with a bearer token, and `fetch` is global in Node 24.

const API_URL = 'https://api.resend.com/emails';

export async function sendViaResend({ to, from, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('EMAIL_PROVIDER=resend but RESEND_API_KEY is not set');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend send failed: ${res.status} ${body}`.trim());
  }
  const data = await res.json().catch(() => ({}));
  return { sent: true, id: data.id };
}
