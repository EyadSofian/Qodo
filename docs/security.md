# Security Notes

## Implemented controls

- bcrypt password hashing;
- signed HttpOnly session cookie;
- production Secure cookie;
- login failure throttling and generic credential errors;
- server-side permission and resource checks;
- organization and department task boundaries;
- user-specific score/review-note masking;
- SSO issuer and required audience verification;
- upload size/count limits and safe filenames;
- inline MIME allowlist, forced download and sandbox CSP;
- CSV formula-injection neutralization;
- administrator-last-account protection;
- audited assignment, review, task and export actions.

## Open P0 work

- replace permanent task/user deletion with retention-aware soft deletion;
- make the audit store append-only with before/after and correlation IDs;
- add explicit CSRF/origin verification if iframe cookies are enabled;
- complete tenant tests across every non-task route and scheduler;
- add private object storage, malware scanning and expiring signed links;
- split coarse manager permissions by action;
- add bounded/paginated database queries;
- add transactional repository operations for multi-record workflows;
- add session revocation, key rotation and security-event monitoring.

External clients or guests must not be enabled before internal/client comment
and asset visibility is modeled and tested.
