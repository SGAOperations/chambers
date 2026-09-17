import { emailFrom, resend } from '@/lib/resend'
import { buildEmailHtml } from './utils'

/**
 * The password reset link (issue #136).
 *
 * Supabase Auth used to send this from its own template. Better Auth hands the
 * link to the app instead, so it now goes out through Resend like every other
 * Chambers email, and looks like them.
 */
export async function sendPasswordResetEmail({ to, url }: { to: string; url: string }) {
  await resend.emails.send({
    from: emailFrom(),
    to,
    subject: 'Reset your Chambers password',
    text: `Someone asked to reset the password for your Chambers account.

Set a new password here: ${url}

This link expires in 1 hour and works once. If you did not ask for this, you can ignore this email; your password has not changed.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">Someone asked to reset the password for your Chambers account.</p>
      <p style="margin:0 0 20px;"><a href="${url}" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;">Set a new password</a></p>
      <p style="margin:0;color:#666;font-size:13px;">This link expires in 1 hour and works once. If you did not ask for this, you can ignore this email; your password has not changed.</p>
    `),
  })
}
