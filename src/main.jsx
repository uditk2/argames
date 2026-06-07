import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';
import './index.css';
import { BRAND } from './config/brand.js';
import { initGA } from './analytics/ga.js';

// Externalized brand name drives the browser tab title too.
document.title = `${BRAND.name} — ${BRAND.tagline}`;

initGA();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
