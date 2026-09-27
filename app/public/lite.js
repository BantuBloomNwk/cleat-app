// Before first paint: is this a phone that should get the lighter rendering?
// A file rather than an inline script, because the content security policy
// allows no inline script. Low memory (4GB or less, which is what a Galaxy
// A13 reports), four cores or fewer, or data saver on. ?lite=1 or ?lite=0
// forces it either way and is remembered on this device.
(function () {
  try {
    var n = navigator, q = new URLSearchParams(location.search).get('lite'), s = null;
    try {
      if (q === '1' || q === '0') localStorage.setItem('cleat_lite', q);
      s = localStorage.getItem('cleat_lite');
    } catch (e) { /* storage off: detection alone decides */ }
    var weak = (n.deviceMemory && n.deviceMemory <= 4) || (n.hardwareConcurrency && n.hardwareConcurrency <= 4) ||
      (n.connection && n.connection.saveData);
    if (s === '1' || (s !== '0' && weak)) document.documentElement.classList.add('lite');
  } catch (e) { /* never block the page */ }
})();
