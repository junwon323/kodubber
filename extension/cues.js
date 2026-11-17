/* Shared by the content script and the browser fixture. */
const Captions = (() => {
  function clean(text) {
    return text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function seconds(stamp) {
    return stamp.replace(',', '.').split(':').reduce((total, n) => total * 60 + Number(n), 0);
  }
  function vtt(raw) {
    const rows = [];
    for (const block of raw.replace(/\r/g, '').split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const i = lines.findIndex(s => s.includes('-->'));
      if (i < 0) continue;
      const m = lines[i].match(/^\s*((?:\d+:)?[0-5]?\d:[0-5]\d[.,]\d{3})\s+-->\s+((?:\d+:)?[0-5]?\d:[0-5]\d[.,]\d{3})(?:\s|$)/);
      if (m) rows.push({start: seconds(m[1]), end: seconds(m[2]), text: lines.slice(i + 1).join(' ')});
    }
    return normalize(rows);
  }
  function normalize(rows) {
    return rows.map(row => ({...row, text: clean(row.text)}))
      .filter(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.start >= 0 &&
        row.end > row.start && row.text && row.text.length <= 1200)
      .sort((a, b) => a.start - b.start);
  }
  function group(rows) {
    const grouped = [];
    for (const row of rows) {
      const previous = grouped.at(-1);
      if (previous && row.start - previous.end <= 0.5 && row.end - previous.start <= 8 &&
          previous.text.length + row.text.length < 900 && !/[.!?。？！]$/.test(previous.text)) {
        if (previous.text !== row.text) previous.text += ' ' + row.text;
        previous.end = Math.max(previous.end, row.end);
      } else grouped.push({...row});
    }
    return grouped;
  }
  function at(rows, time) {
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].start <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }
  return {vtt, normalize, group, at};
})();
