// "Expand all" / "Collapse all" button for the FAQ page.
(function () {
  var btn = document.getElementById('faqToggleAll');
  if (!btn) return;
  var items = document.querySelectorAll('.faq details');
  function refreshLabel() {
    var allOpen = Array.prototype.every.call(items, function (d) { return d.open; });
    btn.textContent = allOpen ? 'Collapse all' : 'Expand all';
  }
  btn.addEventListener('click', function () {
    var expand = btn.textContent === 'Expand all';
    items.forEach(function (d) { d.open = expand; });
    refreshLabel();
  });
  items.forEach(function (d) { d.addEventListener('toggle', refreshLabel); });
  refreshLabel();
})();
