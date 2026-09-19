-- Run once per branch, AFTER enabling the Data API on it (issue #136).
--
-- The Data API connects as `authenticator` and switches into the role a
-- request's token names. Neon lets it switch into `anonymous` and
-- `authenticated`; this lets it switch into `chambers_server` too
-- (db/neon/0003_data_api_server_role.sql). Without it, every server request
-- fails with "permission denied to set role".
--
-- Not numbered with the schema files because `authenticator` only exists once
-- the Data API is enabled, which happens in the Neon console after the schema
-- is applied.

grant chambers_server to authenticator;
