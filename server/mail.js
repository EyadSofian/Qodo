/**
 * Email — the one channel that reaches somebody who has not opened the app.
 *
 * Push notifications need the workspace installed and permission granted, and
 * the in-app bell needs the person to be looking. Neither is true of somebody
 * who has been away for a week, which is exactly who a pile of overdue tasks is
 * addressed to. So email is not a duplicate of push here; it is the fallback
 * for the case push cannot cover.
 *
 * Optional in exactly the same way push and Odoo are: with no SMTP configured
 * `sendMail` is a no-op that reports it did nothing, and every caller carries on
 * unchanged. A deployment without email is a deployment with one fewer channel,
 * not a broken one.
 *
 * Engosoft runs Zoho on a custom domain, so the defaults below are the `pro`
 * hosts that paid Zoho accounts need — the free `@zohomail.com` hosts are a
 * different name and mixing them up gives an authentication failure with no
 * useful message. The password must be an app-specific password, never the
 * account's own.
 */

import { createTransport } from 'nodemailer';

const CONFIG = () => ({
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
});

export function mailConfigured() {
  const { host, user, pass } = CONFIG();
  return Boolean(host && user && pass);
}

/** Which variable is missing, so a diagnostic can name it rather than say "error". */
export function mailMissingConfig() {
  const config = CONFIG();
  return ['host', 'user', 'pass']
    .filter((key) => !config[key])
    .map((key) => `SMTP_${key.toUpperCase()}`);
}

let transport = null;
let transportFor = '';

function getTransport() {
  const { host, port, user, pass } = CONFIG();
  const signature = `${host}:${port}:${user}`;
  if (transport && transportFor === signature) return transport;
  transport = createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards is
    // the other classic way an SMTP setup fails silently.
    secure: port === 465,
    auth: { user, pass },
  });
  transportFor = signature;
  return transport;
}

/**
 * Sends one message and never throws.
 *
 * A scheduled job walking a hundred people must not die on the one address that
 * bounces, so failures are reported in the return value and logged rather than
 * raised. The caller decides whether a failure matters; for a reminder it does
 * not.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) return { sent: false, reason: 'not_configured' };
  if (!to) return { sent: false, reason: 'no_recipient' };

  try {
    await getTransport().sendMail({
      from: CONFIG().from,
      to,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (error) {
    console.warn('[mail] send failed:', error?.message);
    return { sent: false, reason: error?.message || 'send_failed' };
  }
}

/**
 * The workspace's one email template.
 *
 * Deliberately plain: tables and inline styles because that is what mail
 * clients render predictably, right-to-left because that is the language it is
 * written in, and no images because a reminder that needs images loaded to make
 * sense is a reminder that arrives blank.
 */
export function renderEmail({ title, intro, rows, actionLabel, actionUrl, footer }) {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );

  const items = rows
    .map(
      (row) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #E6EDF5;font:600 14px/1.5 system-ui,sans-serif;color:#0B2545">
          ${escape(row.title)}
          ${row.meta ? `<div style="font:400 12px/1.5 system-ui,sans-serif;color:#7A8CA0;margin-top:3px">${escape(row.meta)}</div>` : ''}
        </td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html dir="rtl" lang="ar"><body style="margin:0;background:#F4F7FB;padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E6EDF5">
    <tr><td style="background:#0B2545;padding:18px 20px">
      <div style="font:800 17px/1.4 system-ui,sans-serif;color:#fff">${escape(title)}</div>
    </td></tr>
    <tr><td style="padding:18px 20px 6px;font:400 14px/1.7 system-ui,sans-serif;color:#33495E">
      ${escape(intro)}
    </td></tr>
    <tr><td style="padding:6px 6px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>
    </td></tr>
    ${
      actionUrl
        ? `<tr><td style="padding:18px 20px 22px">
             <a href="${escape(actionUrl)}" style="display:inline-block;background:#1D6FB8;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font:700 14px system-ui,sans-serif">${escape(actionLabel)}</a>
           </td></tr>`
        : ''
    }
    <tr><td style="padding:0 20px 20px;font:400 12px/1.6 system-ui,sans-serif;color:#8FA1B4">
      ${escape(footer)}
    </td></tr>
  </table>
</body></html>`;
}
