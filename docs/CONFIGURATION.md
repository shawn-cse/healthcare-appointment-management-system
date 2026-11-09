# Green Hospital System Configuration Guide

This document describes all environment variables, service integration parameters, database backends, and security flags supported by the Green Hospital system.

---

## 1. Environment Variable Reference

All configuration variables can be defined in a `.env` file at the root of the project or provided directly by the container orchestration environment.

| Variable Name | Type | Default | Description | Environment |
|---|---|---|---|---|
| `SECRET_KEY` | String | *Insecure local default* | Cryptographic signing key for sessions, CSRF, and tokens. | **Mandatory in Prod** |
| `DEBUG` | Boolean | `True` | Enables detailed stack traces and debug toolbar. Set `False` in Staging/Prod. | Dev / Staging / Prod |
| `ALLOWED_HOSTS` | Comma-separated | `localhost,127.0.0.1` | Whitelist of valid domain names and host headers. | **Mandatory in Prod** |
| `DATABASE_URL` | URL | None | Full 12-factor database connection string (e.g. `postgresql://...`). | Staging / Prod |
| `POSTGRES_DB` | String | None | PostgreSQL database name (used if `DATABASE_URL` is omitted). | Staging / Prod |
| `POSTGRES_USER` | String | `postgres` | PostgreSQL username. | Staging / Prod |
| `POSTGRES_PASSWORD` | String | None | PostgreSQL user password. | Staging / Prod |
| `POSTGRES_HOST` | String | `localhost` | PostgreSQL server hostname or container service name (`db`). | Staging / Prod |
| `POSTGRES_PORT` | Integer | `5432` | PostgreSQL listening port. | Staging / Prod |
| `PAYMENT_GATEWAY_PROVIDER` | String | `mock` | Active online payment provider: `sslcommerz` or `mock`. | All |
| `SSLCOMMERZ_STORE_ID` | String | None | Merchant Store ID assigned by SSLCOMMERZ. | Staging / Prod |
| `SSLCOMMERZ_STORE_PASS` | String | None | Merchant Store Password assigned by SSLCOMMERZ. | Staging / Prod |
| `SSLCOMMERZ_IS_SANDBOX` | Boolean | `True` | Toggle sandbox gateway (`sandbox.sslcommerz.com`) vs live gateway. | All |
| `PAYMENT_CHECKOUT_TIMEOUT_MINUTES` | Integer | `15` | Expiration window for unpaid online checkout sessions. | All |
| `EMAIL_BACKEND` | String | Console Backend | `django.core.mail.backends.console.EmailBackend` or SMTP backend. | Dev / Staging / Prod |
| `EMAIL_HOST` | String | None | SMTP mail server hostname. | Staging / Prod |
| `EMAIL_PORT` | Integer | `587` | SMTP port (typically 587 for TLS or 465 for SSL). | Staging / Prod |
| `EMAIL_USE_TLS` | Boolean | `True` | Enables STARTTLS encryption for outgoing email. | Staging / Prod |
| `EMAIL_HOST_USER` | String | None | SMTP authentication username. | Staging / Prod |
| `EMAIL_HOST_PASSWORD` | String | None | SMTP authentication password or app token. | Staging / Prod |
| `DEFAULT_FROM_EMAIL` | String | `webmaster@localhost` | Sender identity header for transactional emails. | All |
| `SMS_GATEWAY_PROVIDER` | String | `mock` | SMS dispatch provider: `mock`, `greenweb`, or `sslwireless`. | All |
| `SMS_API_KEY` | String | None | API credential for Bangladesh SMS provider. | Staging / Prod |
| `SMS_SENDER_ID` | String | `GreenHospital` | Approved sender mask registered with BTRC for SMS dispatch. | Staging / Prod |
| `SECURE_SSL_REDIRECT` | Boolean | `False` | Forces all HTTP traffic to redirect to HTTPS. | **Mandatory in Prod** |
| `SESSION_COOKIE_SECURE` | Boolean | `False` | Marks session cookie with `Secure` flag (HTTPS only). | **Mandatory in Prod** |
| `CSRF_COOKIE_SECURE` | Boolean | `False` | Marks CSRF token cookie with `Secure` flag (HTTPS only). | **Mandatory in Prod** |
| `SECURE_HSTS_SECONDS` | Integer | `0` | HTTP Strict Transport Security duration (e.g. `31536000`). | Prod |

---

## 2. Database Configuration

Green Hospital implements automatic multi-engine database support:

1. **Production / Staging (PostgreSQL):**
   When `DATABASE_URL` or `POSTGRES_DB` is supplied, Django connects via `django.db.backends.postgresql`. Connection pooling and atomic row locking (`select_for_update()`) are enforced for serial allocation and capacity checks.
2. **Local Development (SQLite):**
   When no PostgreSQL credentials are provided, Django defaults to `BASE_DIR / 'db.sqlite3'` without extra configuration.

---

## 3. Online Payment Gateway (SSLCOMMERZ)

### Sandbox Setup
1. Register for an SSLCOMMERZ sandbox merchant account at [https://developer.sslcommerz.com/](https://developer.sslcommerz.com/).
2. Set `.env` values:
   ```env
   PAYMENT_GATEWAY_PROVIDER=sslcommerz
   SSLCOMMERZ_STORE_ID=your_test_store_id
   SSLCOMMERZ_STORE_PASS=your_test_store_pass
   SSLCOMMERZ_IS_SANDBOX=True
   ```
3. Use SSLCOMMERZ sandbox test card credentials for testing (Visa, Mastercard, bKash, Nagad).

### Production Setup
1. Execute merchant agreement with SSLCOMMERZ and complete live KYC.
2. Update `.env` with live credentials and toggle sandbox mode off:
   ```env
   PAYMENT_GATEWAY_PROVIDER=sslcommerz
   SSLCOMMERZ_STORE_ID=live_production_store_id
   SSLCOMMERZ_STORE_PASS=live_production_store_password
   SSLCOMMERZ_IS_SANDBOX=False
   ```
> [!CAUTION]
> Never use live production merchant credentials in automated tests or local development environments.

---

## 4. Notifications Configuration

### Email Setup (SMTP)
For real transactional email delivery via Mailgun, SendGrid, or Google Workspace:
```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.mailgun.org
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=notifications@greenhospital.org
EMAIL_HOST_PASSWORD=your_secure_smtp_password
DEFAULT_FROM_EMAIL="Green Hospital <notifications@greenhospital.org>"
```

### SMS Gateway (Bangladesh Providers)
Green Hospital includes a provider abstraction supporting Bangladesh bulk SMS APIs:
- **Mock (`mock`):** Logs formatted SMS payloads to console and file; does not consume credits.
- **Greenweb (`greenweb`):** Connects to Greenweb Bangladesh HTTP SMS gateway.
- **SSL Wireless (`sslwireless`):** Connects to SSL Wireless SMS Push API.
```env
SMS_GATEWAY_PROVIDER=greenweb
SMS_API_KEY=gw_live_api_token_here
SMS_SENDER_ID=GreenHosp
```
