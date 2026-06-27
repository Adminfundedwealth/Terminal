/**
 * EMAIL SERVICE
 * 
 * Sends transactional emails for account provisioning.
 * Uses nodemailer with SMTP or API-based providers.
 * 
 * Supports:
 *   - Provisioning welcome email (credentials + getting started)
 *   - Retry notifications
 * 
 * Env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   EMAIL_FROM (sender address)
 *   EMAIL_PROVIDER ('smtp' | 'console')
 */

import crypto from 'crypto';

const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@fundedwealth.com';
const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || 'console';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

let transporter = null;

/**
 * Initialize SMTP transporter (lazy init on first send).
 */
async function getTransporter() {
  if (transporter) return transporter;

  if (EMAIL_PROVIDER === 'smtp' && SMTP_HOST) {
    try {
      const nodemailer = await import('nodemailer');
      transporter = nodemailer.default.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT),
        secure: parseInt(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      return transporter;
    } catch (err) {
      console.warn('[EmailService] nodemailer not available, falling back to console');
    }
  }

  return null;
}

export class EmailService {
  /**
   * Send provisioning welcome email with account credentials.
   */
  static async sendProvisioningEmail({ to, name, plan, accountCode, credentials, initialBalance }) {
    const subject = `Your FundedWealth Trading Account is Ready — ${plan} Plan`;
    const html = this._buildProvisioningEmailHTML({
      name, plan, accountCode, credentials, initialBalance,
    });
    const text = this._buildProvisioningEmailText({
      name, plan, accountCode, credentials, initialBalance,
    });

    return this._send({ to, subject, html, text });
  }

  /**
   * Internal send method. Routes to SMTP or console.
   */
  static async _send({ to, subject, html, text }) {
    try {
      const transport = await getTransporter();

      if (transport) {
        await transport.sendMail({
          from: `"FundedWealth" <${EMAIL_FROM}>`,
          to,
          subject,
          html,
          text,
        });
        console.log(`[EmailService] Email sent to ${to}: ${subject}`);
        return { sent: true };
      }

      // Console fallback (dev mode)
      console.log('═══════════════════════════════════════════');
      console.log('[EmailService] EMAIL (console mode)');
      console.log(`  To: ${to}`);
      console.log(`  Subject: ${subject}`);
      console.log(`  Body: ${text}`);
      console.log('═══════════════════════════════════════════');
      return { sent: true, mode: 'console' };
    } catch (err) {
      console.error(`[EmailService] Failed to send email to ${to}:`, err.message);
      return { sent: false, error: err.message };
    }
  }

  /**
   * Build HTML email for provisioning.
   */
  static _buildProvisioningEmailHTML({ name, plan, accountCode, credentials, initialBalance }) {
    const displayBalance = new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(initialBalance);

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; padding: 40px 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #141419; border-radius: 12px; padding: 40px; border: 1px solid #2a2a35;">
    <div style="text-align: center; margin-bottom: 30px;">
      <h1 style="color: #00d4aa; font-size: 24px; margin: 0;">FundedWealth</h1>
      <p style="color: #888; margin-top: 5px;">Trading Terminal</p>
    </div>

    <h2 style="color: #fff; font-size: 20px;">Welcome, ${name}!</h2>
    <p style="color: #ccc; line-height: 1.6;">
      Your <strong style="color: #00d4aa;">${plan} Challenge</strong> account has been provisioned and is ready for trading.
    </p>

    <div style="background: #1a1a22; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #333;">
      <h3 style="color: #00d4aa; margin-top: 0; font-size: 14px; text-transform: uppercase;">Account Details</h3>
      <table style="width: 100%; color: #ccc; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888;">Account Code</td><td style="text-align: right; font-weight: bold;">${accountCode}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Plan</td><td style="text-align: right;">${plan} Challenge</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Starting Balance</td><td style="text-align: right; color: #00d4aa; font-weight: bold;">${displayBalance}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Phase</td><td style="text-align: right;">Phase 1 — Evaluation</td></tr>
      </table>
    </div>

    <div style="background: #1c1a22; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #4a3d6b;">
      <h3 style="color: #a78bfa; margin-top: 0; font-size: 14px; text-transform: uppercase;">Login Credentials</h3>
      <table style="width: 100%; color: #ccc; font-size: 14px;">
        <tr><td style="padding: 6px 0; color: #888;">Login ID</td><td style="text-align: right; font-family: monospace; font-weight: bold; color: #fff;">${credentials.loginId}</td></tr>
        <tr><td style="padding: 6px 0; color: #888;">Password</td><td style="text-align: right; font-family: monospace; font-weight: bold; color: #fff;">${credentials.password}</td></tr>
      </table>
      <p style="color: #f59e0b; font-size: 12px; margin-bottom: 0; margin-top: 12px;">⚠️ Please change your password after first login.</p>
    </div>

    <div style="background: #1a1a22; border-radius: 8px; padding: 20px; margin: 20px 0; border: 1px solid #333;">
      <h3 style="color: #fff; margin-top: 0; font-size: 14px;">Challenge Rules</h3>
      <ul style="color: #ccc; font-size: 13px; line-height: 2; padding-left: 16px;">
        <li>Profit Target: <strong>8%</strong></li>
        <li>Max Drawdown: <strong>10%</strong></li>
        <li>Daily Loss Limit: <strong>5%</strong></li>
        <li>Minimum Trading Days: <strong>5</strong></li>
        <li>Trading Hours: <strong>9:15 AM — 3:30 PM</strong></li>
        <li>No overnight positions</li>
      </ul>
    </div>

    <div style="text-align: center; margin-top: 30px;">
      <a href="https://terminal.fundedwealth.com" style="display: inline-block; background: #00d4aa; color: #000; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">Open Terminal</a>
    </div>

    <p style="color: #666; font-size: 12px; text-align: center; margin-top: 30px;">
      If you have questions, contact support@fundedwealth.com<br>
      © ${new Date().getFullYear()} FundedWealth. All rights reserved.
    </p>
  </div>
</body>
</html>`;
  }

  /**
   * Build plain text email for provisioning.
   */
  static _buildProvisioningEmailText({ name, plan, accountCode, credentials, initialBalance }) {
    const displayBalance = new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(initialBalance);

    return `
Welcome to FundedWealth, ${name}!

Your ${plan} Challenge account is ready for trading.

━━━ ACCOUNT DETAILS ━━━
Account Code: ${accountCode}
Plan: ${plan} Challenge
Starting Balance: ${displayBalance}
Phase: Phase 1 — Evaluation

━━━ LOGIN CREDENTIALS ━━━
Login ID: ${credentials.loginId}
Password: ${credentials.password}

⚠️ Please change your password after first login.

━━━ CHALLENGE RULES ━━━
• Profit Target: 8%
• Max Drawdown: 10%
• Daily Loss Limit: 5%
• Minimum Trading Days: 5
• Trading Hours: 9:15 AM — 3:30 PM
• No overnight positions

Open Terminal: https://terminal.fundedwealth.com

Support: support@fundedwealth.com
    `.trim();
  }
}
