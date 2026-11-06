// Turns the website in dist/ into the app's copy. The app has no analytics, its invite links point at the website, and
// without backend settings it hides online play rather than showing screens that can't connect.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const { siteUrl } = JSON.parse(readFileSync('app.config.json', 'utf8'));
let html = readFileSync('dist/index.html', 'utf8');
const strip = (pattern, label) => { if (!pattern.test(html)) throw new Error(`Could not find ${label} to remove`); html = html.replace(pattern, ''); };
strip(/ *<!-- Google Tag Manager -->[\s\S]*?<!-- End Google Tag Manager -->\n/, 'Tag Manager');
strip(/ *<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js[^\n]*\n/, 'gtag loader');
strip(/ *<script>window\.dataLayer=[^\n]*\n/, 'gtag setup');
strip(/ *<!-- Google Tag Manager \(noscript\) -->[\s\S]*?<!-- End Google Tag Manager \(noscript\) -->\n/, 'Tag Manager noscript');

const online = existsSync('dist/amplify_outputs.json') && Boolean(siteUrl);
const setup = `  <script>window.neonApp=true;${siteUrl ? `window.neonSiteUrl=${JSON.stringify(siteUrl)};` : ''}${online ? '' : "document.documentElement.classList.add('no-online');"}</script>\n`;
html = html.replace('  <link rel="stylesheet" href="styles.css">', `${setup}  <link rel="stylesheet" href="styles.css">`);
writeFileSync('dist/index.html', html);
if (/googletagmanager|dataLayer/.test(html)) throw new Error('Analytics still in the app build');
console.log(online ? 'App build: online play ON' : 'App build: online play OFF (needs siteUrl in app.config.json and amplify_outputs.json)');
if (readFileSync('dist/privacy.html', 'utf8').includes('__CONTACT_EMAIL__')) console.log('Warning: privacy.html still needs a contact email; do not upload this build');
