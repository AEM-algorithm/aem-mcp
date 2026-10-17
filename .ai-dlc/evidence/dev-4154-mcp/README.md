# E2E smoke evidence

`scripts/e2e-oauth-smoke.sh` writes a per-run log to this directory.
The script cannot drive the user-side sign-in (a real human must type
the `user_code` into a browser), so the operator runs the script and
completes the form between steps 2 and 3.

A run produces one file `e2e-<UTC-timestamp>.log`. Each file contains:

- The device_code (hashed in the log; the plaintext only exists in the
  caller's environment and is shown to the user once)
- The user_code shown to the user
- The verification_uri the user was directed to
- The polling trace (status + error per attempt)
- The final access_token length
- The pairings list (count + the jti of the just-created pairing)
- The revoke call's response
- The post-revoke 401 confirmation

Reviewers can `cat .ai-dlc/evidence/dev-4154-mcp/e2e-*.log` to audit a
specific run.
