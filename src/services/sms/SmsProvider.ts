/**
 * The rest of the app only knows about this interface, so the SMS vendor can be
 * swapped (Africa's Talking -> Twilio, Celcom, ...) by writing one new class
 * and changing one line in ./index.ts.
 */
export interface SmsProvider {
  readonly name: string;
  /** Send one text message. `to` is E.164, e.g. +254712345678. Throws on failure. */
  send(to: string, message: string): Promise<void>;
}
