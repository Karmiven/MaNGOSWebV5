const http = require('http');
function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000' + url, { headers: { 'Accept': 'text/html' } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, location: res.headers.location }));
    }).on('error', reject);
  });
}

function extractMenuLinks(html) {
  const links = [];
  const regex = /class="menufiller"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    links.push(`${m[2]} -> ${m[1]}`);
  }
  return links;
}

function extractMenuSlugs(html) {
  const slugs = [];
  const regex = /id="(menu(?:news|account|gameguide|interactive|media|forums|community|support))"/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    if (!slugs.includes(m[1])) slugs.push(m[1]);
  }
  return slugs;
}

(async () => {
  const pages = ['/', '/server', '/server/online', '/support', '/auth/login'];
  for (const p of pages) {
    const r = await fetch(p);
    if (r.status >= 300 && r.status < 400) {
      console.log(`${p}: REDIRECT ${r.status} -> ${r.location}`);
      continue;
    }
    const links = extractMenuLinks(r.body);
    const slugs = extractMenuSlugs(r.body);
    console.log(`${p}: ${r.status} | Categories: ${slugs.join(', ')} | Links: ${links.length}`);
    links.forEach(l => console.log(`  ${l}`));
    console.log();
  }
  process.exit();
})();
