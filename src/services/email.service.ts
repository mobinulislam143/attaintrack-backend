import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../common/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Generic email service using nodemailer.
// Configure via SMTP_HOST / SMTP_USER / SMTP_PASS environment variables.
// ─────────────────────────────────────────────────────────────────────────────

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;

    if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
      throw new Error(
        'Email service is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });

    return this.transporter;
  }

  /**
   * Send a transactional email.
   *
   * @param options.to       Recipient email address
   * @param options.subject  Email subject line
   * @param options.html     HTML body
   * @param options.text     Optional plain-text fallback
   */
  async send(options: SendMailOptions): Promise<void> {
    const transport = this.getTransporter();
    await transport.sendMail({
      from: env.smtpFrom,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    logger.debug('EmailService', `Email sent to ${options.to}: ${options.subject}`);
  }

  /**
   * Send a password-reset email containing a one-time token link.
   */
  async sendPasswordReset(to: string, resetUrl: string, firstName: string): Promise<void> {
    await this.send({
      to,
      subject: 'Reset your password',
      html: passwordResetTemplate(firstName, resetUrl),
      text: `Reset your password: ${resetUrl}`,
    });
  }

  /**
   * Send an email-verification link to a newly registered user.
   */
  async sendEmailVerification(to: string, verifyUrl: string, firstName: string): Promise<void> {
    await this.send({
      to,
      subject: 'Verify your email address',
      html: emailVerificationTemplate(firstName, verifyUrl),
      text: `Verify your email: ${verifyUrl}`,
    });
  }

  /**
   * Send a welcome email after successful verification.
   */
  async sendWelcome(to: string, firstName: string): Promise<void> {
    await this.send({
      to,
      subject: 'Welcome! Your account is ready',
      html: welcomeTemplate(firstName),
    });
  }
}

export const emailService = new EmailService();

// ─────────────────────────────────────────────────────────────────────────────
// Email templates — inline to keep zero external dependencies.
// Replace with a proper templating engine (Handlebars, MJML) in production.
// ─────────────────────────────────────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .header { background: #0f172a; padding: 32px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 24px; font-weight: 700; }
    .body { padding: 40px; color: #374151; line-height: 1.6; }
    .body p { margin: 0 0 16px; }
    .button { display: inline-block; background: #0f172a; color: #fff !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; margin: 8px 0 24px; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h1>Enterprise Boilerplate</h1></div>
    <div class="body">${content}</div>
    <div class="footer">This is an automated message — please do not reply.</div>
  </div>
</body>
</html>`;
}

function passwordResetTemplate(firstName: string, resetUrl: string): string {
  return baseTemplate(`
    <p>Hi ${firstName},</p>
    <p>We received a request to reset your password. Click the button below to choose a new one:</p>
    <a class="button" href="${resetUrl}">Reset Password</a>
    <p>This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>
  `);
}

function emailVerificationTemplate(firstName: string, verifyUrl: string): string {
  return baseTemplate(`
    <p>Hi ${firstName},</p>
    <p>Thanks for signing up! Please verify your email address to activate your account:</p>
    <a class="button" href="${verifyUrl}">Verify Email</a>
    <p>This link expires in <strong>24 hours</strong>.</p>
  `);
}

function welcomeTemplate(firstName: string): string {
  return baseTemplate(`
    <p>Hi ${firstName},</p>
    <p>Your email has been verified and your account is ready to use.</p>
    <p>Welcome aboard!</p>
  `);
}
