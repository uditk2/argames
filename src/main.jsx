import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';
import './index.css';
import { initGA } from './analytics/ga.js';
import { initPostHog } from './analytics/posthog.js';

// NOTE: the document <title> + meta description are owned per-route by the App
// router (src/config/seo-routes.js -> applyRouteHead), so they stay correct as
// the player navigates between /, /brawler and /dino-survival.

initGA();
initPostHog();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
