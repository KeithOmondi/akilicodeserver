import nodemailer from 'nodemailer';
import env from '../config/env';

interface MailOptions {
  email: string;
  subject: string;
  message: string;
  html?: string;
}

const createTransporter = () =>
  nodemailer.createTransport({
    service: 'gmail', // This automatically sets host to smtp.gmail.com
    auth: {
      user: env.EMAIL_USER, // Your full gmail address
      pass: env.EMAIL_PASS, // Your 16-character App Password
    },
  });

export const sendEmail = async (options: MailOptions) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `AkiliCode <${env.EMAIL_USER}>`, // Best to use EMAIL_USER to avoid spam filters
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email] Sent: ${info.messageId}`);
  } catch (error) {
    console.error('[Email Error]', error);
    throw error; // Re-throw so your controller's catch block can handle it
  }
};