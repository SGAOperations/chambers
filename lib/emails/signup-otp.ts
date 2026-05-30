import { resend } from '@/lib/resend'
import { buildEmailHtml } from './utils'

export async function sendSignupOtpEmail({ to, otp }: { to: string; otp: string }) {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: 'Your Chambers Signup Code',
    text: `You requested to create a Chambers account — the official room and event booking platform for the Northeastern Student Government Association.

Use the code below to verify your email and complete your signup.

Signup Code: ${otp}

This code expires in 24 hours. If you did not request this, you can safely ignore this email.

For access issues, contact sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">You requested to create a Chambers account — the official room and event booking platform for the Northeastern Student Government Association.</p>
      <p style="margin:0 0 16px;">Use the code below to verify your email and complete your signup.</p>
      <p style="margin:0 0 16px;font-size:22px;font-weight:bold;letter-spacing:4px;">${otp}</p>
      <p style="margin:0;color:#666;font-size:13px;">This code expires in 24 hours. If you did not request this, you can safely ignore this email.</p>
    `, 'For access issues, contact <a href="mailto:sgaOperations@northeastern.edu" style="color:#c8102e;">sgaOperations@northeastern.edu</a>.'),
  })
}
