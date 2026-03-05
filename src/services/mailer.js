const nodemailer = require('nodemailer');

let transporter = null;

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
    return this.send(to, 'Account Activation',
      `<h2>Welcome, ${username}!</h2>
       <p>Please activate your account by clicking the link below:</p>
       <p><a href="${activationUrl}">${activationUrl}</a></p>`
    );
  },

  async sendPasswordReset(to, username, newPassword) {
    return this.send(to, 'Password Reset',
      `<h2>Password Reset</h2>
       <p>Hello ${username}, your password has been reset.</p>
       <p>Your new password is: <strong>${newPassword}</strong></p>
       <p>Please change it after logging in.</p>`
    );
  }
};

Mailer.init();
module.exports = Mailer;
