import axios from 'axios';
import { SmsProvider } from './SmsProvider';

interface Options {
  username: string;       // "sandbox" for the sandbox app
  apiKey: string;
  senderId?: string;      // not allowed in the sandbox
  environment: 'sandbox' | 'production';
}

/**
 * Africa's Talking SMS (https://developers.africastalking.com/docs/sms/sending/bulk).
 * Sandbox messages are only visible in the AT simulator, they never reach a real phone.
 */
export class AfricasTalkingProvider implements SmsProvider {
  readonly name = 'africastalking';
  constructor(private readonly opts: Options) {}

  async send(to: string, message: string): Promise<void> {
    const base =
      this.opts.environment === 'production'
        ? 'https://api.africastalking.com'
        : 'https://api.sandbox.africastalking.com';

    const body = new URLSearchParams({ username: this.opts.username, to, message });
    if (this.opts.senderId && this.opts.environment === 'production') body.set('from', this.opts.senderId);

    const res = await axios.post(`${base}/version1/messaging`, body.toString(), {
      headers: {
        apiKey: this.opts.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    });

    const recipient = res.data?.SMSMessageData?.Recipients?.[0];
    // statusCode 100 = Processed, 101 = Sent, 102 = Queued
    if (!recipient || ![100, 101, 102].includes(Number(recipient.statusCode))) {
      throw new Error(`Africa's Talking rejected the message: ${recipient?.status ?? 'no recipient'}`);
    }
  }
}
