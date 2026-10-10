import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import { App } from './App';
import './styles.css';

// Chromium on Windows has no flag emoji glyphs and renders e.g. "UA" instead;
// load the bundled Twemoji flags font there (no-op where flags already work).
polyfillCountryFlagEmojis(FLAG_FONT_FAMILY, `${__APP_BASE_URL__}${FLAG_FONT_FILE}`);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
