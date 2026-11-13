const nodemailer = require('nodemailer');

let transporter = null;

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const Mailer = {
  init() {
    if (process.env.SMTP_ENABLED !== 'true') return;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'ssl',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  },

  isEnabled() {
    return !!transporter;
  },

  async send(to, subject, html) {
    if (!transporter) {
      console.warn('[Mailer] SMTP not configured, skipping email to', to);
      return false;
    }
    try {
      const fromName = String(process.env.MAIL_FROM_NAME || '').replace(/["\r\n]/g, '');
      await transporter.sendMail({
        from: `"${fromName}" <${process.env.MAIL_FROM_EMAIL}>`,
        to, subject, html
      });
      return true;
    } catch (err) {
      console.error('[Mailer] Send error:', err.message);
      return false;
    }
  },

  async sendActivation(to, username, activationUrl) {
    const safeUser = escapeHtml(username);
    const safeUrl = escapeHtml(activationUrl);
    return this.send(to, 'Account Activation',
      `<h2>Welcome, ${safeUser}!</h2>
       <p>Please activate your account by clicking the link below:</p>
       <p><a href="${safeUrl}">${safeUrl}</a></p>`
    );
  },

  async sendPasswordResetLink(to, username, resetUrl) {
    const safeUser = escapeHtml(username);
    const safeUrl = escapeHtml(resetUrl);
    return this.send(to, 'Password Reset',
      `<h2>Password Reset</h2>
       <p>Hello ${safeUser}, we received a request to reset your password.</p>
       <p><a href="${safeUrl}">Choose a new password</a> (valid for one hour).</p>
       <p>If you did not ask for this, ignore this email, your password stays the same.</p>`
    );
  }
};

Mailer.init();
module.exports = Mailer;
