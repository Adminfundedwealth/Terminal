/**
 * EMAIL SERVICE — Zoho SMTP via Nodemailer
 *
 * Reads the same SMTP_* environment variables used by the api-server:
 *   SMTP_HOST      (e.g. smtp.zoho.in)
 *   SMTP_PORT      (default: 465)
 *   SMTP_SECURE    (default: true — implicit TLS / port 465)
 *   SMTP_USER      (e.g. support@fundedwealth.com)
 *   SMTP_PASS      (Zoho app password)
 *   SMTP_FROM      (sender address, defaults to SMTP_USER)
 *   SMTP_FROM_NAME (display name, default: FundedWealth)
 *
 * Falls back to console-log mode if SMTP_HOST or SMTP_PASS is not set.
 */

import nodemailer from 'nodemailer';

const SMTP_HOST      = process.env.SMTP_HOST      ?? '';
const SMTP_PORT      = parseInt(process.env.SMTP_PORT ?? '465', 10);
const SMTP_SECURE    = process.env.SMTP_SECURE    !== 'false'; // default true
const SMTP_USER      = process.env.SMTP_USER      ?? '';
const SMTP_PASS      = process.env.SMTP_PASS      ?? '';
const SMTP_FROM      = process.env.SMTP_FROM      ?? SMTP_USER;
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME ?? 'FundedWealth';

const FROM_HEADER = `"${SMTP_FROM_NAME}" <${SMTP_FROM}>`;

let _transporter = null;

/**
 * Lazily build and cache the nodemailer transporter.
 * Returns null if SMTP is not configured (console fallback mode).
 */
function getTransporter() {
  if (_transporter) return _transporter;

  if (!SMTP_HOST || !SMTP_PASS) {
    return null;
  }

  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,         // true → implicit TLS on connect (port 465)
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10_000,
    greetingTimeout:   10_000,
    socketTimeout:     30_000,
  });

  return _transporter;
}

export class EmailService {
  /**
   * Send provisioning welcome email with trading account credentials.
   */
  static async sendProvisioningEmail({ to, name, plan, accountCode, credentials, initialBalance }) {
    const subject = `Your FundedWealth Trading Account is Ready — ${plan} Plan`;
    const html    = EmailService._buildProvisioningEmailHTML({ name, plan, accountCode, credentials, initialBalance });
    const text    = EmailService._buildProvisioningEmailText({ name, plan, accountCode, credentials, initialBalance });

    return EmailService._send({ to, subject, html, text });
  }

  /**
   * Internal send method. Routes to Zoho SMTP or falls back to console.
   */
  static async _send({ to, subject, html, text }) {
    const transport = getTransporter();

    if (!transport) {
      // Console fallback when SMTP is not configured
      console.log('═══════════════════════════════════════════');
      console.log('[EmailService] EMAIL (console fallback — SMTP not configured)');
      console.log(`  To:      ${to}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Body:    ${text}`);
      console.log('═══════════════════════════════════════════');
      return { sent: true, mode: 'console' };
    }

    try {
      const info = await transport.sendMail({
        from:    FROM_HEADER,
        to,
        subject,
        html,
        text,
      });
      console.log(`[EmailService] Sent via Zoho SMTP ✓  to=${to}  messageId=${info.messageId}`);
      return { sent: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[EmailService] SMTP send failed to ${to}:`, err.message);
      return { sent: false, error: err.message };
    }
  }

  /**
   * Verify SMTP connection — call once at startup.
   */
  static async verifyConnection() {
    const transport = getTransporter();
    if (!transport) {
      console.warn('[EmailService] SMTP not configured — email delivery disabled (log-only mode)');
      return false;
    }
    try {
      await transport.verify();
      console.log(`[EmailService] Zoho SMTP connection verified ✓  host=${SMTP_HOST}:${SMTP_PORT}  user=${SMTP_USER}`);
      return true;
    } catch (err) {
      console.error(`[EmailService] SMTP connection FAILED:`, err.message);
      _transporter = null; // reset so next call retries
      return false;
    }
  }

  // ── Email templates ──────────────────────────────────────────────────────

  static _buildProvisioningEmailHTML({ name, plan, accountCode, credentials, initialBalance }) {
    const displayBalance = new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(initialBalance);

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0f;color:#e0e0e0;padding:40px 20px;">
  <div style="max-width:600px;margin:0 auto;background:#141419;border-radius:12px;padding:40px;border:1px solid #2a2a35;">
    <div style="text-align:center;margin-bottom:30px;">
      <h1 style="color:#00d4aa;font-size:24px;margin:0;">FundedWealth</h1>
      <p style="color:#888;margin-top:5px;">Trading Terminal</p>
    </div>
    <h2 style="color:#fff;font-size:20px;">Welcome, ${name}!</h2>
    <p style="color:#ccc;line-height:1.6;">
      Your <strong style="color:#00d4aa;">${plan} Challenge</strong> account has been provisioned and is ready for trading.
    </p>
    <div style="background:#1a1a22;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #333;">
      <h3 style="color:#00d4aa;margin-top:0;font-size:14px;text-transform:uppercase;">Account Details</h3>
      <table style="width:100%;color:#ccc;font-size:14px;">
        <tr><td style="padding:6px 0;color:#888;">Account Code</td><td style="text-align:right;font-weight:bold;">${accountCode}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Plan</td><td style="text-align:right;">${plan} Challenge</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Starting Balance</td><td style="text-align:right;color:#00d4aa;font-weight:bold;">${displayBalance}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Phase</td><td style="text-align:right;">Phase 1 — Evaluation</td></tr>
      </table>
    </div>
    <div style="background:#1c1a22;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #4a3d6b;">
      <h3 style="color:#a78bfa;margin-top:0;font-size:14px;text-transform:uppercase;">Login Credentials</h3>
      <table style="width:100%;color:#ccc;font-size:14px;">
        <tr><td style="padding:6px 0;color:#888;">Login ID</td><td style="text-align:right;font-family:monospace;font-weight:bold;color:#fff;">${credentials.loginId}</td></tr>
        <tr><td style="padding:6px 0;color:#888;">Password</td><td style="text-align:right;font-family:monospace;font-weight:bold;color:#fff;">${credentials.password}</td></tr>
      </table>
      <p style="color:#f59e0b;font-size:12px;margin-bottom:0;margin-top:12px;">⚠️ Please change your password after first login.</p>
    </div>
    <div style="background:#1a1a22;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #333;">
      <h3 style="color:#fff;margin-top:0;font-size:14px;">Challenge Rules</h3>
      <ul style="color:#ccc;font-size:13px;line-height:2;padding-left:16px;">
        <li>Profit Target: <strong>8%</strong></li>
        <li>Max Drawdown: <strong>10%</strong></li>
        <li>Daily Loss Limit: <strong>5%</strong></li>
        <li>Minimum Trading Days: <strong>5</strong></li>
        <li>Trading Hours: <strong>9:15 AM — 3:30 PM</strong></li>
        <li>No overnight positions</li>
      </ul>
    </div>
    <div style="text-align:center;margin-top:30px;">
      <a href="https://terminal.fundedwealth.com" style="display:inline-block;background:#00d4aa;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;">Open Terminal</a>
    </div>
    <p style="color:#666;font-size:12px;text-align:center;margin-top:30px;">
      Questions? Contact support@fundedwealth.com<br>
      © ${new Date().getFullYear()} FundedWealth. All rights reserved.
    </p>
  </div>
</body>
</html>`;
  }

  static _buildProvisioningEmailText({ name, plan, accountCode, credentials, initialBalance }) {
    const displayBalance = new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(initialBalance);

    return `
Welcome to FundedWealth, ${name}!

Your ${plan} Challenge account is ready for trading.

━━━ ACCOUNT DETAILS ━━━
Account Code:    ${accountCode}
Plan:            ${plan} Challenge
Starting Balance: ${displayBalance}
Phase:           Phase 1 — Evaluation

━━━ LOGIN CREDENTIALS ━━━
Login ID:  ${credentials.loginId}
Password:  ${credentials.password}

⚠️  Please change your password after first login.

━━━ CHALLENGE RULES ━━━
• Profit Target:       8%
• Max Drawdown:        10%
• Daily Loss Limit:    5%
• Min Trading Days:    5
• Trading Hours:       9:15 AM — 3:30 PM
• No overnight positions

Open Terminal: https://terminal.fundedwealth.com
Support:       support@fundedwealth.com
    `.trim();
  }
}
