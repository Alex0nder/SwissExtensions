/**
 * Swiss Extensions landing scripts.
 * Keeps tiny progressive enhancements only.
 */

(function () {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  function init() {
    // Smooth anchor navigation for internal CTA links.
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href || href.length < 2) return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }
})();
