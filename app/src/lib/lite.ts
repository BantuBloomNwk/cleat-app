/** Whether this phone gets the lighter rendering. Set by /lite.js before paint. */
export const isLite = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('lite');
