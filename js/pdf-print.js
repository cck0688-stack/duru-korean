// DURU KOREAN — print a PDF on the site: the file goes to the browser's own PDF viewer in a hidden
// frame (as on the blog and the resource page); phones open it in a tab to print from.
window.duruPrintPdf = function (url) {
  var touch = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var tab = touch ? window.open('', '_blank') : null;
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error('PDF ' + res.status);
    return res.blob();
  }).then(function (blob) {
    var local = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (tab) { tab.location.href = local; return; }
    var old = document.getElementById('duruPrintFrame');
    if (old) old.remove();
    var frame = document.createElement('iframe');
    frame.id = 'duruPrintFrame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = function () {
      setTimeout(function () {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); }
        catch (e) { window.open(local, '_blank'); }
      }, 300);
    };
    frame.src = local;
    document.body.appendChild(frame);
  }).catch(function () { if (tab) tab.close(); window.open(url, '_blank'); });
};
