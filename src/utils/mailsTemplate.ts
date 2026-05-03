import sendMail from "./sendMail";


export interface ReceiptMailData {
  email: string;
  parent_name: string;
  kid_name: string;
  course_name: string;
  amount: number;
  method: string;
  reference: string;
  date: string;
  description: string;
  receipt_number: string;
  status: "completed" | "pending" | "failed";
}

// ─── RECEIPT HTML TEMPLATE ───────────────────────────────────────────────────

export const buildReceiptHtml = (data: ReceiptMailData): string => {
  const statusClass = data.status;
  const statusLabel = data.status.charAt(0).toUpperCase() + data.status.slice(1);
  const formattedAmount = Number(data.amount).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedDate = new Date(data.date).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const statusColors: Record<string, string> = {
    completed: "background:#e8f5e9;color:#2e7d32;",
    pending:   "background:#fff8e1;color:#f57f17;",
    failed:    "background:#fce4ec;color:#c62828;",
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>AkiliCode Payment Receipt</title>
</head>
<body style="margin:0;padding:40px 16px;background-color:#f4f1fb;font-family:Arial,sans-serif;color:#1a1a2e;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- ── HEADER ── -->
        <tr>
          <td style="background:#3B1FA3;border-radius:16px 16px 0 0;padding:28px 40px 20px;text-align:center;">
            <!--LOGO_PLACEHOLDER-->
            <div style="font-size:22px;font-weight:700;color:#ffffff;">Akili<span style="color:#F5A623;">&lt;&gt;</span>Code</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;">Think · Code · Create · Grow</div>
          </td>
        </tr>

        <!-- ── SUCCESS BAND ── -->
        <tr>
          <td style="background:#2D1690;padding:14px 40px;text-align:center;">
            <div style="font-size:20px;font-weight:700;color:#ffffff;">Success</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.6);font-family:monospace;margin-top:2px;">Transaction ID : ${data.reference || data.receipt_number}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:2px;">Date : ${formattedDate}</div>
          </td>
        </tr>

        <!-- ── CHECK + AMOUNT ── -->
        <tr>
          <td style="background:#ffffff;padding:28px 40px 20px;text-align:center;border-bottom:2px dashed #e0d9f5;">
            <div style="width:72px;height:72px;border-radius:50%;background:#4CAF50;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
              <img src="https://img.icons8.com/ios-filled/50/ffffff/checkmark--v1.png" width="36" height="36" alt="✓" style="display:block;margin:18px auto 0;" />
            </div>
            <div style="font-size:12px;font-weight:700;color:#3B1FA3;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Payment to AkiliCode</div>
            <div style="font-size:44px;font-weight:700;color:#1a1a2e;line-height:1;">
              <span style="font-size:18px;font-weight:500;color:#3B1FA3;vertical-align:super;">KES</span>${formattedAmount}
            </div>
          </td>
        </tr>

        <!-- ── BODY ── -->
        <tr>
          <td style="background:#ffffff;padding:0 40px 32px;">

            <!-- FROM section title -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:13px;font-weight:700;color:#1a1a2e;padding:20px 0 10px;">From</td>
              </tr>
            </table>

            <!-- Account Name row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">Account Name</td>
                <td style="font-size:13px;font-weight:600;color:#1a1a2e;text-align:right;padding:10px 0;">${data.parent_name.toUpperCase()}</td>
              </tr>
            </table>

            <!-- Student row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:2px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">Student</td>
                <td style="font-size:13px;font-weight:600;color:#1a1a2e;text-align:right;padding:10px 0;">${data.kid_name}</td>
              </tr>
            </table>

            <!-- TRANSACTION DETAILS section title -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:13px;font-weight:700;color:#1a1a2e;padding:20px 0 10px;">Transaction Details</td>
              </tr>
            </table>

            <!-- To row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">To</td>
                <td style="font-size:13px;font-weight:600;color:#1a1a2e;text-align:right;padding:10px 0;">AkiliCode</td>
              </tr>
            </table>

            <!-- Course row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">Course</td>
                <td style="font-size:13px;font-weight:600;color:#1a1a2e;text-align:right;padding:10px 0;">${data.course_name}</td>
              </tr>
            </table>

            <!-- Method row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">Method</td>
                <td style="font-size:13px;font-weight:600;color:#1a1a2e;text-align:right;padding:10px 0;">${data.method}</td>
              </tr>
            </table>

            <!-- Reference row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">Reference</td>
                <td style="font-size:13px;font-weight:600;color:#3B1FA3;font-family:monospace;text-align:right;padding:10px 0;">${data.reference || "—"}</td>
              </tr>
            </table>

            <!-- Receipt No row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">Receipt No.</td>
                <td style="font-size:13px;font-weight:600;color:#3B1FA3;font-family:monospace;text-align:right;padding:10px 0;">${data.receipt_number}</td>
              </tr>
            </table>

            <!-- Status row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:2px dashed #e0d9f5;">
              <tr>
                <td style="font-size:13px;color:#6b6b8a;padding:10px 0;">Status</td>
                <td style="text-align:right;padding:10px 0;">
                  <span style="display:inline-block;padding:3px 12px;border-radius:99px;font-size:11px;font-weight:600;${statusColors[statusClass]}">${statusLabel}</span>
                </td>
              </tr>
            </table>

            <!-- Total row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:14px;font-weight:600;color:#1a1a2e;padding:16px 0 0;">Total Paid</td>
                <td style="font-size:18px;font-weight:700;color:#3B1FA3;text-align:right;padding:16px 0 0;">KES ${formattedAmount}</td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td style="background:#3B1FA3;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
            <div style="font-size:13px;color:rgba(255,255,255,0.75);line-height:1.6;">
              Thank you, <strong style="color:#F5A623;">${data.parent_name}</strong>!<br/>
              ${data.kid_name} is all set for class. Keep this receipt for your records.
            </div>
            <div style="margin-top:14px;font-size:11px;color:rgba(255,255,255,0.4);">
              <a href="#" style="color:rgba(255,255,255,0.55);text-decoration:none;">akilicode.com</a>
              &nbsp;·&nbsp;
              <a href="#" style="color:rgba(255,255,255,0.55);text-decoration:none;">support@akilicode.com</a>
            </div>
          </td>
        </tr>

        <!-- ── OUTER NOTE ── -->
        <tr>
          <td style="text-align:center;padding:20px 0;font-size:11px;color:#b0a8d0;">
            This is an automated receipt. Please do not reply to this email.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
};

// ─── SEND RECEIPT EMAIL ──────────────────────────────────────────────────────

export const sendReceiptEmail = async (data: ReceiptMailData): Promise<void> => {
  const html = buildReceiptHtml(data);

  await sendMail({
    // Changed 'email' to 'to'
    to: data.email,
    subject: `Payment Receipt — ${data.receipt_number}`,
    // Changed 'message' to 'text'
    text: `Hi ${data.parent_name}, your payment of KES ${data.amount} for ${data.kid_name} (${data.course_name}) has been received. Receipt No: ${data.receipt_number}.`,
    html,
  });
};

// ─── VERIFICATION LINK TEMPLATE ──────────────────────────────────────────────

export interface VerificationLinkData {
  email: string;
  name: string;
  url: string;
}

export const buildVerificationLinkHtml = (data: VerificationLinkData): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
    body { background-color: #f4f1fb; font-family: 'Poppins', sans-serif; padding: 40px 16px; }
    .wrapper { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; text-align: center; }
    .header { background: #3B1FA3; padding: 32px; }
    .brand-name { font-size: 22px; font-weight: 700; color: #ffffff; }
    .brand-name span { color: #F5A623; }
    .content { padding: 40px; }
    .button { 
      display: inline-block; 
      padding: 16px 32px; 
      background: #3B1FA3; 
      color: #ffffff !important; 
      text-decoration: none; 
      border-radius: 8px; 
      font-weight: 600; 
      margin: 24px 0;
      box-shadow: 0 4px 12px rgba(59, 31, 163, 0.2);
    }
    .footer { font-size: 12px; color: #9989c5; padding-bottom: 30px; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><div class="brand-name">Akili<span>&lt;&gt;</span>Code</div></div>
    <div class="content">
      <h2 style="color: #3B1FA3;">Almost there!</h2>
      <p>Hi ${data.name}, click the button below to verify your account and start coding.</p>
      <a href="${data.url}" class="button">Verify My Account</a>
      <p style="font-size: 12px; color: #9989c5;">This link expires in 24 hours.</p>
    </div>
    <div class="footer">&copy; AkiliCode</div>
  </div>
</body>
</html>`;
};

export interface ResetPasswordLinkData {
  email: string;
  name: string;
  url: string;
}

export const buildResetPasswordLinkHtml = (data: ResetPasswordLinkData): string => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
    body { background-color: #f4f1fb; font-family: 'Poppins', sans-serif; padding: 40px 16px; }
    .wrapper { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; text-align: center; }
    .header { background: #3B1FA3; padding: 32px; }
    .brand-name { font-size: 22px; font-weight: 700; color: #ffffff; }
    .brand-name span { color: #F5A623; }
    .content { padding: 40px; }
    .icon { width: 72px; height: 72px; border-radius: 50%; background: #f4f1fb; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; font-size: 32px; }
    .button {
      display: inline-block;
      padding: 16px 32px;
      background: #3B1FA3;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 24px 0;
      box-shadow: 0 4px 12px rgba(59, 31, 163, 0.2);
    }
    .warning { font-size: 12px; color: #e53e3e; margin-top: 8px; }
    .footer { font-size: 12px; color: #9989c5; padding: 20px 40px 30px; border-top: 1px solid #f0eafa; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="brand-name">Akili<span>&lt;&gt;</span>Code</div>
    </div>
    <div class="content">
      <div class="icon">🔐</div>
      <h2 style="color:#3B1FA3;margin-bottom:8px;">Reset Your Password</h2>
      <p style="color:#6b6b8a;font-size:14px;line-height:1.6;">
        Hi <strong>${data.name}</strong>, we received a request to reset your AkiliCode password.
        Click the button below to choose a new password.
      </p>
      <a href="${data.url}" class="button">Reset My Password</a>
      <p class="warning">⚠️ This link expires in 1 hour.</p>
      <p style="font-size:12px;color:#9989c5;margin-top:16px;">
        If you didn't request this, you can safely ignore this email. Your password will not change.
      </p>
    </div>
    <div class="footer">&copy; AkiliCode &nbsp;·&nbsp; support@akilicode.com</div>
  </div>
</body>
</html>`;
};


export interface PaymentReminderData {
  parent_name: string;
  kid_name: string;
  course_name: string;
  fee_amount: number;
  billing_cycle: string;
  next_payment_date: string;
}

export const buildPaymentReminderHtml = (data: PaymentReminderData): string => {
  const formattedAmount = Number(data.fee_amount).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const formattedDate = new Date(data.next_payment_date).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Payment Reminder</title>
</head>
<body style="margin:0;padding:40px 16px;background-color:#f4f1fb;font-family:Arial,sans-serif;color:#1a1a2e;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- Header -->
        <tr>
          <td style="background:#3B1FA3;border-radius:16px 16px 0 0;padding:28px 40px 20px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:#ffffff;">Akili<span style="color:#F5A623;">&lt;&gt;</span>Code</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;">Think · Code · Create · Grow</div>
          </td>
        </tr>

        <!-- Alert band -->
        <tr>
          <td style="background:#F5A623;padding:14px 40px;text-align:center;">
            <div style="font-size:13px;font-weight:700;color:#1a1a2e;text-transform:uppercase;letter-spacing:1px;">⏰ Payment Due in 7 Days</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:32px 40px;">
            <p style="font-size:15px;color:#1a1a2e;margin-bottom:24px;">
              Hi <strong>${data.parent_name}</strong>,
            </p>
            <p style="font-size:14px;color:#6b6b8a;line-height:1.6;margin-bottom:24px;">
              This is a friendly reminder that your <strong>${data.billing_cycle}</strong> payment 
              for <strong>${data.kid_name}</strong>'s enrollment in 
              <strong>${data.course_name}</strong> is due in <strong>7 days</strong>.
            </p>

            <!-- Due date box -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1fb;border-radius:12px;margin-bottom:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-size:13px;color:#6b6b8a;">Due Date</td>
                      <td style="font-size:13px;font-weight:700;color:#3B1FA3;text-align:right;">${formattedDate}</td>
                    </tr>
                    <tr><td colspan="2" style="padding:6px 0;border-bottom:1px dashed #e0d9f5;"></td></tr>
                    <tr>
                      <td style="font-size:13px;color:#6b6b8a;padding-top:12px;">Course</td>
                      <td style="font-size:13px;font-weight:700;color:#1a1a2e;text-align:right;padding-top:12px;">${data.course_name}</td>
                    </tr>
                    <tr><td colspan="2" style="padding:6px 0;border-bottom:1px dashed #e0d9f5;"></td></tr>
                    <tr>
                      <td style="font-size:13px;color:#6b6b8a;padding-top:12px;">Student</td>
                      <td style="font-size:13px;font-weight:700;color:#1a1a2e;text-align:right;padding-top:12px;">${data.kid_name}</td>
                    </tr>
                    <tr><td colspan="2" style="padding:6px 0;border-bottom:1px dashed #e0d9f5;"></td></tr>
                    <tr>
                      <td style="font-size:14px;font-weight:700;color:#1a1a2e;padding-top:12px;">Amount Due</td>
                      <td style="font-size:18px;font-weight:700;color:#3B1FA3;text-align:right;padding-top:12px;">KES ${formattedAmount}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="font-size:13px;color:#6b6b8a;line-height:1.6;">
              Please log in to your AkiliCode account to complete your payment and keep 
              <strong>${data.kid_name}</strong>'s enrollment active.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#3B1FA3;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;">
            <div style="font-size:13px;color:rgba(255,255,255,0.75);line-height:1.6;">
              Questions? Contact us at <strong style="color:#F5A623;">support@akilicode.com</strong>
            </div>
            <div style="margin-top:14px;font-size:11px;color:rgba(255,255,255,0.4);">
              <a href="#" style="color:rgba(255,255,255,0.55);text-decoration:none;">akilicode.com</a>
            </div>
          </td>
        </tr>

        <!-- Outer note -->
        <tr>
          <td style="text-align:center;padding:20px 0;font-size:11px;color:#b0a8d0;">
            This is an automated reminder. Please do not reply to this email.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
};