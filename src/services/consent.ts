import consentText from '../content/consent.json';

/**
 * The consent wording lives in ONE editable file: src/content/consent.json.
 * It is versioned; every consent stored in the database records the version the parent
 * accepted, together with the exact items shown. See the README note inside that file.
 */
export const CONSENT_VERSION: string = consentText.version;
export const CONSENT_ITEMS: { key: string; text: string }[] = consentText.items;

export const consentDocument = () => ({
  version: CONSENT_VERSION,
  title: consentText.title,
  items: CONSENT_ITEMS,
  draft: consentText.draft,
});
