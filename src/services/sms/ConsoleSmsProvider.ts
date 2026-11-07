import { SmsProvider } from './SmsProvider';

/** Development / test provider: prints the message instead of sending it. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  /** Last message per number, so tests can read the code. */
  static outbox: { to: string; message: string }[] = [];

  async send(to: string, message: string): Promise<void> {
    // Production: never keep or print codes. With no real SMS provider, phone sign-in simply cannot be completed.
    if (process.env.NODE_ENV === 'production') {
      console.warn('📵 SMS not sent: SMS_PROVIDER is not configured for production.');
      return;
    }
    ConsoleSmsProvider.outbox.push({ to, message });
    if (process.env.NODE_ENV !== 'test') console.log(`📱 [SMS → ${to}] ${message}`);
  }
}
