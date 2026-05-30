export const sanitize = (s: string) => s.replace(/[\r\n\t]/g, ' ').trim()

const LOGO_URL = 'https://chambers.northeasternsga.com/sga-logo.png'
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
