import { resend } from '@/lib/resend'

export async function sendOtpInviteEmail({ to, otp }: { to: string; otp: string }) {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: 'Welcome to Chambers \u2014 Your One-Time Password',
    text: `Welcome to Chambers, the official room and event booking platform for the Northeastern Student Government Association.

Your account has been created. Use the one-time password below to log in and complete your account setup.

One-Time Password: ${otp}

This password expires in 24 hours. Once you log in, you will be prompted to set a permanent password before accessing the platform.

If your invite has expired or you did not request this, please contact an SGA administrator at sgaOperations@northeastern.edu.`,
  })
}
