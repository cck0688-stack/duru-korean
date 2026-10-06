// DURU KOREAN — home page: the picture level with the five ways in
//
// The owner (2026-10-07): the folding-screen picture's top lines up with
// the top of the first card and its foot with the foot of Blog and
// Community — the heading above the cards stands on its own. The cards'
// column has a set width, so its height does not depend on the picture;
// the picture (square) then takes the cards' height and is moved down
// by the heading's. Below the two-column width (home-v2.css) the picture
// sits above the cards at full width and this does nothing.
(function () {
  var grid = document.querySelector('.home-v2 .hero-grid');
  if (!grid) return;
  var text = grid.querySelector('.hero-text');
  var cards = grid.querySelector('.lp-grid');
  var img = grid.querySelector('.hero-scene');
  if (!text || !cards || !img) return;
  var wide = window.matchMedia('(min-width: 1260px)');

  function fit() {
    if (!wide.matches) { img.style.height = ''; img.style.marginTop = ''; return; }
    var cs = getComputedStyle(grid);
    var room = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) -
               text.getBoundingClientRect().width - parseFloat(cs.columnGap || 0);
    var box = cards.getBoundingClientRect();
    var h = Math.floor(Math.min(box.height, room));
    img.style.height = Math.max(0, h) + 'px';
    // Level with the cards; centred on them if the room makes it shorter.
    img.style.marginTop = Math.max(0, Math.round(box.top - text.getBoundingClientRect().top + (box.height - h) / 2)) + 'px';
  }
  if (window.ResizeObserver) new ResizeObserver(fit).observe(text);
  if (wide.addEventListener) wide.addEventListener('change', fit);
  window.addEventListener('load', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  fit();
})();
