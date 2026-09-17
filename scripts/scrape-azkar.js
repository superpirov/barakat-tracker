#!/usr/bin/env node
// Scrapes azkar.ru categories and builds Barakat JSON dataset
// Run: node scripts/scrape-azkar.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://azkar.ru';
const CATEGORIES = [
  { slug: 'morning', url: '/category/morning', id: 'morning', title: 'Утренние азкары' },
  { slug: 'evening', url: '/category/evening', id: 'evening', title: 'Вечерние азкары' },
  { slug: 'after_prayer', url: '/category/after_prayer', id: 'after_prayer', title: 'Азкары после намаза' },
  { slug: 'from_quran', url: '/category/from_quran', id: 'quran', title: 'Дуа из Корана' },
  { slug: 'against_oppressor', url: '/category/against_oppressor', id: 'protection', title: 'Дуа в защиту' },
  { slug: 'other1', url: '/category/other1', id: 'other1', title: 'Важные дуа часть 1' },
  { slug: 'other2', url: '/category/other2', id: 'other2', title: 'Важные дуа часть 2' },
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Barakat Scraper)' } }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanTranslation(raw) {
  // raw is innerHTML of text_translation with possible nested source div
  // we need to remove azkar__source div content already extracted separately, but keep text
  // also remove any html tags
  let t = raw.replace(/<div class="azkar__source">[\s\S]*?<\/div>/g, '');
  t = t.replace(/<br\s*\/?>/gi, ' ');
  t = stripTags(decodeEntities(t));
  // remove extra "10 раз" like repetitions that may be inside? Already handled via count, but clean
  return t.trim();
}

function parseCategory(html) {
  const duas = [];
  // split by azkar blocks: <div class="azkar" id="azkar-...">
  const reBlock = /<div class="azkar" id="azkar-[^"]+">([\s\S]*?)(?=<div class="azkar" id="azkar-|\n\s*<\/div>\s*\n\s*<\/div>\s*<!-- end list -->|<div class="container">)/g;
  // simpler: match each azkar block via regex for whole structure
  const blockRegex = /<div class="azkar" id="azkar-(\d+)">([\s\S]*?)<div class="socials">/g;
  let m;
  while ((m = blockRegex.exec(html)) !== null) {
    const azkarId = m[1];
    const inner = m[2];

    const titleM = inner.match(/<div class="title">\s*([\s\S]*?)\s*<\/div>/);
    let title = titleM ? stripTags(decodeEntities(titleM[1])) : `Азкар ${azkarId}`;
    title = title.replace(/\s+/g, ' ').trim();

    const arabicM = inner.match(/<div class="text_original">\s*([\s\S]*?)\s*<\/div>/);
    let arabic = arabicM ? stripTags(decodeEntities(arabicM[1])) : '';
    // keep line breaks for bismillah + verses? In source they have <br> or two lines. Our strip collapses; instead preserve newlines? Better to keep as decoded with line breaks
    if (arabicM) {
      let rawAr = arabicM[1];
      rawAr = rawAr.replace(/<br\s*\/?>/gi, '\n');
      rawAr = stripTags(decodeEntities(rawAr)).replace(/\s*\n\s*/g, '\n');
      // But stripTags already collapsed; let's do manual
      rawAr = decodeEntities(arabicM[1]).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
      rawAr = rawAr.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean).join('\n');
      arabic = rawAr;
    }

    const countM = inner.match(/<div class="azkar__count">\s*([\s\S]*?)\s*<\/div>/);
    let count = countM ? stripTags(decodeEntities(countM[1])) : null;

    const transM = inner.match(/<div class="text_translation">\s*([\s\S]*?)\s*<\/div>\s*(?:<div class="text_transcription"|<audio|<div class="socials)/);
    // The above may not capture correctly because nested div. Alternative: find text_translation block
    let translation = '';
    let source = '';
    const transBlockM = inner.match(/<div class="text_translation">([\s\S]*?)<\/div>\s*(?:<div class="text_transcription"|<audio)/);
    // Actually translation div closes before transcription, but source inside. So we capture up to transcription.
    let transBlock = null;
    const tb = inner.match(/<div class="text_translation">([\s\S]*?)<\/div>\s*<div class="text_transcription"/);
    const tb2 = inner.match(/<div class="text_translation">([\s\S]*?)<\/div>\s*<audio/);
    const tb3 = inner.match(/<div class="text_translation">([\s\S]*?)<\/div>\s*<div class="socials"/);
    if (tb) transBlock = tb[1];
    else if (tb2) transBlock = tb2[1];
    else if (tb3) transBlock = tb3[1];
    else {
      // fallback: find text_translation and extract up to next div
      const idx = inner.indexOf('text_translation');
      if (idx >= 0) {
        const sub = inner.substring(idx);
        const endIdx = sub.indexOf('text_transcription');
        if (endIdx >= 0) transBlock = sub.substring(0, endIdx);
      }
    }
    if (transBlock !== null) {
      const srcM = transBlock.match(/<div class="azkar__source">\s*([\s\S]*?)\s*<\/div>/);
      if (srcM) {
        source = stripTags(decodeEntities(srcM[1]));
        source = source.replace(/^\(|\)$/g, '').trim();
      }
      translation = cleanTranslation(transBlock);
      // If count present inside translation? Count is separate div before translation, not inside. So fine.
      // For some quran duas, translation may be empty? But usually present.
    } else {
      // No translation block? For ayat al-kursi maybe no source/transliteration pattern differs
      const srcM2 = inner.match(/<div class="azkar__source">\s*([\s\S]*?)\s*<\/div>/);
      if (srcM2) source = stripTags(decodeEntities(srcM2[1])).replace(/^\(|\)$/g, '').trim();
    }

    const transcrM = inner.match(/<div class="text_transcription">\s*([\s\S]*?)\s*<\/div>/);
    let transliteration = transcrM ? stripTags(decodeEntities(transcrM[1])) : '';
    transliteration = transliteration.replace(/\s+/g, ' ').trim();

    const audioM = inner.match(/<audio src="([^"]+)"/);
    let audio = audioM ? audioM[1] : null;

    duas.push({
      _azkarId: azkarId,
      title,
      arabic,
      translation,
      transliteration,
      source,
      count,
      audio,
    });
  }
  return duas;
}

// Slugify for thematic sections
function slugifyCyrillic(str) {
  const map = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Sch', 'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
  };
  let t = str.split('').map(ch => map[ch] !== undefined ? map[ch] : ch).join('');
  t = t.toLowerCase();
  // keep letters, digits, spaces, hyphens
  t = t.replace(/[^a-z0-9\s-]/g, ' ');
  t = t.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  // truncate long
  if (t.length > 60) t = t.substring(0, 60).replace(/-$/,'');
  return t || 'section';
}

async function main() {
  console.log('Fetching azkar.ru categories...');
  const all = {};
  for (const cat of CATEGORIES) {
    const url = BASE + cat.url;
    console.log(` - ${cat.slug} ${url}`);
    const html = await fetch(url);
    const duas = parseCategory(html);
    console.log(`   -> ${duas.length} duas`);
    all[cat.slug] = { meta: cat, htmlLen: html.length, duas };
  }

  // Build sections
  const sections = [];

  // Helper to map raw duas to output duas with id
  function mapDua(raw, sectionId, idx) {
    const out = {
      id: `${sectionId}-${idx + 1}`,
      title: raw.title,
      arabic: raw.arabic,
      translation: raw.translation,
      transliteration: raw.transliteration,
      source: raw.source || '',
    };
    if (raw.count) out.count = raw.count;
    // keep audio optional
    if (raw.audio) out.audio = raw.audio;
    return out;
  }

  // Main categories: morning, evening, after_prayer, quran, protection
  for (const slug of ['morning','evening','after_prayer','from_quran','against_oppressor']) {
    const entry = all[slug];
    if (!entry) continue;
    const secId = entry.meta.id;
    const secTitle = entry.meta.title;
    const duas = entry.duas.map((d, i) => mapDua(d, secId, i));
    sections.push({ id: secId, title: secTitle, duas });
  }

  // Thematic: other1 + other2 split
  // Merge handling for ubornaya
  const thematicRaw = [...all['other1'].duas, ...all['other2'].duas];
  // Build map to merge indices 1 and 2 of ubornaya (positions 1,2 in other1)
  // Detect by title containing "при входе в уборную"
  const mergedSections = [];
  const used = new Set();
  for (let i = 0; i < thematicRaw.length; i++) {
    if (used.has(i)) continue;
    const cur = thematicRaw[i];
    if (cur.title.includes('при входе в уборную')) {
      // Find pair
      const isNum1 = cur.title.includes('№1');
      if (isNum1) {
        const nxt = thematicRaw[i+1];
        if (nxt && nxt.title.includes('при входе в уборную') && nxt.title.includes('№2')) {
          // Merge
          const secId = slugifyCyrillic('Зикр при входе в уборную');
          // Ensure uniqueness if collision
          let uniqId = secId;
          let c=1;
          while (mergedSections.some(s=>s.id===uniqId)) { uniqId = secId + '-' + (++c); }
          const duas = [
            { id: `${uniqId}-1`, title: cur.title, arabic: cur.arabic, translation: cur.translation, transliteration: cur.transliteration, source: cur.source || '', ...(cur.count?{count:cur.count}:{}), ...(cur.audio?{audio:cur.audio}:{}) },
            { id: `${uniqId}-2`, title: nxt.title, arabic: nxt.arabic, translation: nxt.translation, transliteration: nxt.transliteration, source: nxt.source || '', ...(nxt.count?{count:nxt.count}:{}), ...(nxt.audio?{audio:nxt.audio}:{}) },
          ];
          mergedSections.push({ id: uniqId, title: 'Зикр при входе в уборную', duas });
          used.add(i); used.add(i+1);
          continue;
        }
      } else if (cur.title.includes('№2')) {
        // Already handled as part of previous, skip (should be used)
        continue;
      }
    }
    // Normal single
    const baseSlug = slugifyCyrillic(cur.title.replace(/№\s*\d+/g,'').trim());
    let secId = baseSlug || `other-${i+1}`;
    // Ensure uniqueness
    let uniqId = secId;
    let counter = 1;
    while (mergedSections.some(s=>s.id===uniqId) || sections.some(s=>s.id===uniqId)) {
      counter++;
      uniqId = `${secId}-${counter}`;
    }
    const dua = {
      id: `${uniqId}-1`,
      title: cur.title,
      arabic: cur.arabic,
      translation: cur.translation,
      transliteration: cur.transliteration,
      source: cur.source || '',
      ...(cur.count?{count:cur.count}:{}),
      ...(cur.audio?{audio:cur.audio}:{})
    };
    mergedSections.push({ id: uniqId, title: cur.title, duas: [dua] });
    used.add(i);
  }

  // Add thematic sections to main sections
  for (const s of mergedSections) sections.push(s);

  // Output stats
  const totalDuas = sections.reduce((a,s)=>a+s.duas.length,0);
  console.log(`\nBuilt ${sections.length} sections, ${totalDuas} duas`);
  sections.forEach(s=>console.log(` - ${s.id} (${s.title}): ${s.duas.length} duas`));

  // Ensure output dir
  const outDir = path.join(__dirname, '..', 'public', 'azkar');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'azkar.json');
  const outFullPath = path.join(outDir, 'azkar.full.json');

  fs.writeFileSync(outPath, JSON.stringify(sections, null, 2), 'utf8');
  fs.writeFileSync(outFullPath, JSON.stringify(sections, null, 2), 'utf8');
  console.log(`\nSaved to ${outPath}`);
  console.log(`Saved to ${outFullPath}`);

  // Also copy to dist if exists
  const distDir = path.join(__dirname, '..', 'dist', 'azkar');
  if (fs.existsSync(path.join(__dirname, '..', 'dist'))) {
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'azkar.json'), JSON.stringify(sections, null, 2), 'utf8');
    fs.writeFileSync(path.join(distDir, 'azkar.full.json'), JSON.stringify(sections, null, 2), 'utf8');
    console.log(`Also copied to dist/azkar/`);
  }

  // Write summary file
  const summary = { sections: sections.length, duas: totalDuas, files: [outPath, outFullPath] };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
}

main().catch(e=>{ console.error(e); process.exit(1); });
