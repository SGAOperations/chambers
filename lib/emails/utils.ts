export const sanitize = (s: string) => s.replace(/[\r\n\t]/g, ' ').trim()
