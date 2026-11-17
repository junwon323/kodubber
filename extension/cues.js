/* Shared by the content script and the browser fixture. */
const Captions = (() => {
  function stripMarkup(text) {
    return text.replace(/(^|[^\w])\*\*\s*([^*]+?)\s*\*\*(?=$|[^\w])/g, (_, before, inner) => before + inner.trim())
      .replace(/(^|[^\w])__\s*([^_]+?)\s*__(?=$|[^\w])/g, (_, before, inner) => before + inner.trim())
      .replace(/`([^`]+)`/g, '$1').replace(/^\s*[*_`]{2,}\s*$/, '');
  }
  function clean(text) {
    return stripMarkup(text).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
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
      // Short subtitle gaps are not necessarily sentence boundaries. Give an
      // unfinished sentence room to finish, without spanning long real pauses.
      const finished = previous && /[.!?。？！]["”’)]?$/.test(previous.text);
      const gap = previous ? row.start - previous.end : Infinity;
      const span = previous ? row.end - previous.start : Infinity;
      const continuation = !finished && gap <= 1.5 && span <= 40;
      const shortSentence = finished && gap <= 0.5 &&
        previous.end - previous.start < 6 && span <= 12;
      if (previous && (continuation || shortSentence) &&
          previous.text.length + row.text.length < 1100) {
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
