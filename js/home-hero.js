// DURU KOREAN — home page: the picture as tall as the five ways in
//
// The owner (2026-10-05): the folding-screen picture's top and bottom
// line up with the top of "Your Learning Path" and the foot of the last
// card. The cards' column has a set width, so its height does not depend
// on the picture; the picture (square) then takes that height. Below the
// two-column width (home-v2.css) the picture sits above the cards at
// full width and this does nothing.
(function () {
  var grid = document.querySelector('.home-v2 .hero-grid');
  if (!grid) return;
  var text = grid.querySelector('.hero-text');
  var img = grid.querySelector('.hero-scene');
  if (!text || !img) return;
  var wide = window.matchMedia('(min-width: 1260px)');

  function fit() {
    if (!wide.matches) { img.style.height = ''; return; }
    // As tall as the cards, never wider than the room left beside them.
    var cs = getComputedStyle(grid);
    var room = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) -
               text.getBoundingClientRect().width - parseFloat(cs.columnGap || 0);
    var h = Math.min(text.getBoundingClientRect().height, room);
    img.style.height = Math.max(0, Math.floor(h)) + 'px';
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(text);
  if (wide.addEventListener) wide.addEventListener('change', fit);
  window.addEventListener('load', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  fit();
})();
