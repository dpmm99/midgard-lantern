function escapeHtml(str) {
  if (str === undefined) return "";
  return str.replace(/[&<>"'\/]/g, function (s) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;'
    }[s];
  });
}

{
    if (!globalThis.exports) globalThis.exports = {};
    exports.escapeHtml = escapeHtml;
}