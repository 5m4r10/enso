// Links to the owner's other apps. They carry no Enso data except the project name (Keep label).
import { esc } from './format.js';

const ANDROID = /Android/i.test(navigator.userAgent);
const NEW_TAB = ' target="_blank" rel="noopener noreferrer"';

const svg = (d) => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const NOTE = svg('<path d="M3 2.5h10v7l-4 4H3zM13 9.5H9v4"/>');
const SHIELD = svg('<path d="M8 1.5l5 1.8v4.2c0 3.2-2 5.6-5 7-3-1.4-5-3.8-5-7V3.3z"/>');

/** The Keep label must be named exactly like the project. */
export const keepUrl = (label) => `https://keep.google.com/#label/${encodeURIComponent(label)}`;

export const keepLink = (label) =>
  `<a class="ext" href="${esc(keepUrl(label))}"${NEW_TAB} aria-label="Notas de ${esc(label)} en Google Keep">${NOTE}Keep</a>`;

// Android: /redirect-connector is the only https path Bitwarden's app accepts from a browser; without
// parameters it just opens the app. If the app is missing, the web vault opens.
const BITWARDEN_WEB = 'https://vault.bitwarden.com/';
const BITWARDEN_APP = 'intent://vault.bitwarden.com/redirect-connector.html#Intent;scheme=https;package=com.x8bit.bitwarden;' +
  `S.browser_fallback_url=${encodeURIComponent(BITWARDEN_WEB)};end`;

export const bitwardenLink = () => ANDROID
  ? `<a class="ext" href="${esc(BITWARDEN_APP)}" aria-label="Abrir Bitwarden">${SHIELD}Bitwarden</a>`
  : `<a class="ext" href="${BITWARDEN_WEB}"${NEW_TAB} aria-label="Abrir Bitwarden">${SHIELD}Bitwarden</a>`;
