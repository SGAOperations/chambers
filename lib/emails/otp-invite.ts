import { resend } from '@/lib/resend'
import { buildEmailHtml } from './utils'

export async function sendOtpInviteEmail({ to, otp }: { to: string; otp: string }) {
  const loginUrl = 'https://chambers.northeasternsga.com'

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: 'Welcome to Chambers \u2014 Your One-Time Password',
    text: `Welcome to Chambers, the official room and event booking platform for the Northeastern Student Government Association.

Your account has been created. Use the one-time password below to log in (${loginUrl}) and complete your account setup.

One-Time Password: ${otp}

This password expires in 24 hours. Once you log in, you will be prompted to set a permanent password before accessing the platform.

If your invite has expired or you did not request this, please contact a Chambers administrator at sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">Welcome to Chambers, the official room and event booking platform for the Northeastern Student Government Association.</p>
      <p style="margin:0 0 16px;">Your account has been created. Use the one-time password below to <a href="${loginUrl}" style="color:#c8102e;">log in</a> and complete your account setup.</p>
      <p style="margin:0 0 16px;font-size:22px;font-weight:bold;letter-spacing:4px;">${otp}</p>
      <p style="margin:0;color:#666;font-size:13px;">This password expires in 24 hours. Once you <a href="${loginUrl}" style="color:#c8102e;">log in</a>, you will be prompted to set a permanent password before accessing the platform.</p>
    `, 'If your invite has expired or you did not request this, please contact a Chambers administrator at <a href="mailto:sgaOperations@northeastern.edu" style="color:#c8102e;">sgaOperations@northeastern.edu</a>.'),
  })
}
