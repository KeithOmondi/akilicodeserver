import axios from "axios";
import env from "../config/env";

/* ============================================================
   BREVO (plain HTTPS API; the old SDK pulled in the abandoned "request" library)
============================================================ */
const brevo = axios.create({
  baseURL: "https://api.brevo.com/v3",
  headers: { "api-key": env.BREVO_API_KEY, accept: "application/json", "content-type": "application/json" },
  timeout: 15000,
});

/* ============================================================
   TYPES
============================================================ */
interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

/* ============================================================
   CORE SEND MAIL FUNCTION
============================================================ */
export const sendMail = async ({
  to,
  subject,
  html,
  text,
  replyTo,
}: SendMailOptions) => {
  try {
    const recipients = Array.isArray(to) 
      ? to.map((email) => ({ email })) 
      : [{ email: to }];

    const emailData = {
      sender: {
        name: env.MAIL_FROM_NAME,
        email: env.MAIL_FROM_EMAIL,
      },
      to: recipients,
      subject,
      htmlContent: html,
      textContent: text || "Please enable HTML to view this email.",
      replyTo: replyTo ? { email: replyTo } : undefined,
    };

    const response = await brevo.post("/smtp/email", emailData);
    console.log(`[EMAIL SENT] ${Array.isArray(to) ? to.length + " recipients" : to.replace(/^(.).*(@.*)$/, "$1***$2")} | ID: ${response.data?.messageId || "N/A"}`);

    return response;
  } catch (err: any) {
    const errorMsg = err?.response?.data?.message || err.message;
    console.error(`[EMAIL ERROR] to ${to}:`, errorMsg);
    throw new Error(`Email sending failed: ${errorMsg}`);
  }
};

/* ============================================================
   SPECIFIC OTP HELPER
============================================================ */
export const sendOtpMail = async (email: string, otp: string, name: string) => {
  const subject = "Your Secure Login Code";
  const html = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
      <h2>Hello, ${name}</h2>
      <p>Use the code below to complete your login. This code will expire in 10 minutes.</p>
      <div style="background: #f4f4f4; padding: 15px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 5px;">
        ${otp}
      </div>
      <p style="margin-top: 20px; color: #666; font-size: 12px;">
        If you didn't request this, please contact your administrator.
      </p>
    </div>
  `;

  return await sendMail({ to: email, subject, html });
};

/* ============================================================
   VERIFY CONNECTION
============================================================ */
export const verifyMailConnection = async () => {
  try {
    await brevo.get("/account");
    console.log("[BREVO] Connected successfully");
  } catch (err: any) {
    console.error("[BREVO] Connection failed:", err.message || err);
    throw err;
  }
};

export default sendMail;