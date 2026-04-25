-- OTP fields for one-time password invite flow.
-- Both nullable: NULL for existing/onboarded users, populated only for pending invites.

ALTER TABLE users
  ADD COLUMN otp_hash text,
  ADD COLUMN otp_expires_at timestamptz;
