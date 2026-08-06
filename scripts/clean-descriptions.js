/**
 * Normaliza las descripciones de productos ya importadas:
 *  - Convierte "\n"/"\r\n" literales en saltos de línea reales.
 *  - Limpia espacios alrededor de los saltos y colapsa líneas en blanco.
 *  - Elimina artefactos de IA al final ("Shorten with AI", etc.).
 *
 * Uso: node scripts/clean-descriptions.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalize(text) {
  return String(text || '')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*\b(Shorten|Rewrite|Expand|Translate)\s+with\s+AI\s*$/i, '')
    .trim();
}

async function main() {
  const prods = await prisma.product.findMany({
    where: { NOT: { description: null } },
    select: { id: true, description: true },
  });
  let changed = 0;
  for (const p of prods) {
    const next = normalize(p.description);
    if (next !== p.description) {
      await prisma.product.update({ where: { id: p.id }, data: { description: next } });
      changed++;
    }
  }
  console.log(`✅ Descripciones normalizadas: ${changed} de ${prods.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
