import env from '../../config/env';
import { SmsProvider } from './SmsProvider';
import { ConsoleSmsProvider } from './ConsoleSmsProvider';
import { AfricasTalkingProvider } from './AfricasTalkingProvider';

let provider: SmsProvider | null = null;

/** The single place that decides which SMS vendor is used. */
export const getSmsProvider = (): SmsProvider => {
  if (provider) return provider;
  provider =
    env.SMS_PROVIDER === 'africastalking'
      ? new AfricasTalkingProvider({
          username: env.AT_USERNAME,
          apiKey: env.AT_API_KEY,
          senderId: env.AT_SENDER_ID,
          environment: env.AT_ENV,
        })
      : new ConsoleSmsProvider();
  return provider;
};

/** For tests: inject a fake. */
export const setSmsProvider = (p: SmsProvider | null) => {
  provider = p;
};

export type { SmsProvider };
