// Links to the owner's other apps. They carry no Enso data except the project name or its Keep note.
/* global isKeepNoteUrl */
import { esc } from './format.js';
import { brushIcon } from './enso.js';

const ANDROID = /Android/i.test(navigator.userAgent);
const NEW_TAB = ' target="_blank" rel="noopener noreferrer"';

const NOTE = brushIcon('note');
const SHIELD = brushIcon('shield');

// The Android app opens a note address but ignores labels (tested): without a note, the link goes to
// the label named like the project, which the app shows as its home.
export const keepUrl = (p) => isKeepNoteUrl(p.keep_url) ? p.keep_url : `https://keep.google.com/#label/${encodeURIComponent(p.name)}`;

export const keepLink = (p) =>
  `<a class="ext" href="${esc(keepUrl(p))}"${NEW_TAB} aria-label="Notas de ${esc(p.name)} en Google Keep">${NOTE}Keep</a>`;

// Android: /redirect-connector is the only https path Bitwarden's app accepts from a browser; without
// parameters it just opens the app. If the app is missing, the web vault opens.
const BITWARDEN_WEB = 'https://vault.bitwarden.com/';
const BITWARDEN_APP = 'intent://vault.bitwarden.com/redirect-connector.html#Intent;scheme=https;package=com.x8bit.bitwarden;' +
  `S.browser_fallback_url=${encodeURIComponent(BITWARDEN_WEB)};end`;

export const bitwardenLink = () => ANDROID
  ? `<a class="ext" href="${esc(BITWARDEN_APP)}" aria-label="Abrir Bitwarden">${SHIELD}Bitwarden</a>`
  : `<a class="ext" href="${BITWARDEN_WEB}"${NEW_TAB} aria-label="Abrir Bitwarden">${SHIELD}Bitwarden</a>`;
