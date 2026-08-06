/**
 * Re-procesa las descripciones desde el CSV original de WooCommerce,
 * convirtiendo el HTML (<p>, <ul>, <li>, <br>) en texto con:
 *   - saltos de línea entre párrafos
 *   - viñetas "• " para los <li>
 * y actualiza cada producto por externalId (= ID de WooCommerce).
 *
 * Uso: node scripts/reprocess-descriptions.js [--file <ruta>]
 */
require('dotenv').config();
const { readFileSync } = require('fs');
const { PrismaClient } = require('@prisma/client');
const { parse } = require('csv-parse/sync');

const DEFAULT_CSV = 'D:/Descargas/wc-product-export-23-6-2026-1782233584564.csv';
const fileArg = process.argv.indexOf('--file');
const CSV = fileArg !== -1 ? process.argv[fileArg + 1] : DEFAULT_CSV;

const prisma = new PrismaClient();

// HTML → texto preservando párrafos y viñetas.
function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  // Ruido entre etiquetas: "\n" literales, saltos reales y tabs → espacio.
  s = s.replace(/\\r\\n|\\n|\\r/g, ' ').replace(/[\r\n\t]+/g, ' ');
  // Estructura → saltos / viñetas.
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/(p|div|ul|ol|h[1-6])\s*>/gi, '\n');
  // Resto de etiquetas.
  s = s.replace(/<[^>]*>/g, ' ');
  // Entidades comunes (los acentos ya vienen en UTF-8).
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&hellip;/gi, '…');
  // Espacios y saltos.
  s = s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*\b(Shorten|Rewrite|Expand|Translate)\s+with\s+AI\s*$/i, '')
    .trim();
  return s;
}

async function main() {
  const content = readFileSync(CSV, 'utf8');
  const rows = parse(content, {
    columns: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const id = String(r['ID'] || '').trim();
    const raw = r['Descripción'];
    if (!id || !raw) continue;
    const text = htmlToText(raw);
    if (!text) continue;
    const prod = await prisma.product.findFirst({ where: { externalId: id }, select: { id: true } });
    if (!prod) {
      skipped++;
      continue;
    }
    await prisma.product.update({ where: { id: prod.id }, data: { description: text } });
    updated++;
  }
  console.log(`✅ Descripciones re-procesadas con viñetas: ${updated} (sin coincidencia: ${skipped})`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
