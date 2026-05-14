import { resend } from '@/lib/resend'

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
    html: `<p>You requested to create a Chambers account — the official room and event booking platform for the Northeastern Student Government Association.</p>
<p>Use the code below to verify your email and complete your signup.</p>
<p><strong>Signup Code: ${otp}</strong></p>
<p>This code expires in 24 hours. If you did not request this, you can safely ignore this email.</p>
<p>For access issues, contact <a href="mailto:sgaOperations@northeastern.edu">sgaOperations@northeastern.edu</a>.</p>`,
  })
}
