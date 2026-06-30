// react-global.js — the ported design modules read `React` from the global scope
// (the original single-file prototype loaded React via a <script> tag). We expose
// it on window BEFORE any design module evaluates so their top-level
// `const { useState } = React` destructures resolve. Must be imported first.
import React from 'react';
import { createRoot } from 'react-dom/client';

window.React = React;
// Exposed for debugging / render smoke-tests (negligible cost; react-dom is bundled anyway).
window.__createRoot = createRoot;

export {};
