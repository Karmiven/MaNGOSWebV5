/* FIXED BY SECURITY AUDIT v2.0 — 2026 */
const nodemailer = require('nodemailer');

let transporter = null;

// [FIXED] Escape HTML in email content to prevent injection
function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const Mailer = {
  init() {
    if (process.env.SMTP_ENABLED !== 'true') return;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'ssl',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  },

  async send(to, subject, html) {
    if (!transporter) {
      console.warn('[Mailer] SMTP not configured, skipping email to', to);
      return false;
    }
    try {
      await transporter.sendMail({
        from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_EMAIL}>`,
        to, subject, html
      });
      return true;
    } catch (err) {
      console.error('[Mailer] Send error:', err.message);
      return false;
    }
  },

  async sendActivation(to, username, activationUrl) {
    // [FIXED] Escape username to prevent HTML injection in emails
    const safeUser = escapeHtml(username);
    const safeUrl = escapeHtml(activationUrl);
    return this.send(to, 'Account Activation',
      `<h2>Welcome, ${safeUser}!</h2>
       <p>Please activate your account by clicking the link below:</p>
       <p><a href="${safeUrl}">${safeUrl}</a></p>`
    );
  },

  async sendPasswordReset(to, username, newPassword) {
    const safeUser = escapeHtml(username);
    const safePass = escapeHtml(newPassword);
    return this.send(to, 'Password Reset',
      `<h2>Password Reset</h2>
       <p>Hello ${safeUser}, your password has been reset.</p>
       <p>Your new password is: <strong>${safePass}</strong></p>
       <p>Please change it after logging in.</p>`
    );
  }
};

Mailer.init();
module.exports = Mailer;
