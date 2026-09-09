export const sanitize = (s: string) => s.replace(/[\r\n\t]/g, ' ').trim()

// opsemaillogo.png, not sga-logo.png. There has never been an sga-logo.png:
// 390acfc added public/opsemaillogo.png and wrote this URL in the same commit,
// and the two simply did not match, so the footer logo in every transactional
// email has 404'd since. next.config.ts keeps opsemaillogo.png out of the
// service worker's precache on the grounds that it is "only ever referenced from
// transactional email HTML" -- which is what it was for, and now is.
const LOGO_URL = 'https://chambers.northeasternsga.com/opsemaillogo.png'
const OPS_EMAIL_HREF = 'mailto:sgaOperations@northeastern.edu'
const OPS_EMAIL_TEXT = 'sgaOperations@northeastern.edu'

export const STD_FOOTER_NOTE =
  `If you have questions, please reach out to <a href="${OPS_EMAIL_HREF}" style="color:#c8102e;">${OPS_EMAIL_TEXT}</a>.`

export function buildEmailHtml(bodyHtml: string, footerNote: string = STD_FOOTER_NOTE): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;">
        <tr><td style="padding:32px 32px 28px;color:#1a1a1a;font-size:14px;line-height:1.6;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #e0e0e0;">
          <p style="margin:0 0 16px;font-size:12px;color:#555;line-height:1.6;">${footerNote}</p>
          <img src="${LOGO_URL}" width="200" alt="SGA – Northeastern University" style="display:block;max-width:200px;" />
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
