// Runs before the page paints: match IntelHQ's light/dark choice and tell the page if it's inside IntelHQ.
try { if (localStorage.getItem('ocs-theme') === 'light') document.documentElement.setAttribute('data-theme', 'light'); } catch (e) {}
if (window.self !== window.top) document.documentElement.classList.add('embedded');
