# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Email security concerns to: **INSERT_YOUR_EMAIL_HERE**.

You should receive a response within 72 hours. If the issue is confirmed,
we will work with you on a fix and coordinate disclosure timing.

## Scope

In scope:

- Code execution from an AI-generated macro that exceeds its declared
  permissions (e.g. pixel-scan reading beyond the requested region).
- Auto-update mechanism being tricked into installing a malicious build
  (signature forgery, downgrade attacks).
- API key or settings-file leakage via the filesystem.

Out of scope:

- Macros the user themselves authored and ran with full permissions.
- Self-hosted third-party AI endpoints (out of our control).

## Disclosure

We follow a 90-day coordinated disclosure timeline. Critical issues may be
expedited.