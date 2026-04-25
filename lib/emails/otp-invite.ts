import { resend } from '@/lib/resend'

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
    html: `<p>Welcome to Chambers, the official room and event booking platform for the Northeastern Student Government Association.</p>
<p>Your account has been created. Use the one-time password below to <a href="${loginUrl}">log in</a> and complete your account setup.</p>
<p><strong>One-Time Password: ${otp}</strong></p>
<p>This password expires in 24 hours. Once you <a href="${loginUrl}">log in</a>, you will be prompted to set a permanent password before accessing the platform.</p>
<p>If your invite has expired or you did not request this, please contact a Chambers administrator at sgaOperations@northeastern.edu.</p>`,
  })
}
