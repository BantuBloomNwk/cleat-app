// Solana's client library was written for Node and reaches for a Buffer
// global that browsers do not have. Where one happened to exist the app worked;
// where it did not, every read of the chain threw and the screen fell back to
// sample data with nothing on it to say so. This is the shim, installed before
// anything imports the library rather than hoped for.
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
