/**
 * Importador de WooCommerce → Orthodonca.
 *
 * Lee el CSV de exportación de productos de WooCommerce e importa productos
 * simples y variables (con sus variantes) a la base de datos:
 *   - Mapea/crea Category y Subcategory desde la columna "Categorías".
 *   - Genera SKUs únicos cuando faltan.
 *   - Sube las imágenes a Cloudflare R2 (o conserva la URL original con --no-images).
 *   - Limpia el HTML de las descripciones.
 *   - Es idempotente por externalId (= ID de WooCommerce).
 *
 * Uso:
 *   node scripts/import-woocommerce.js
 *   node scripts/import-woocommerce.js --file "D:/ruta/export.csv"
 *   node scripts/import-woocommerce.js --limit 5 --no-images
 *   node scripts/import-woocommerce.js --dry-run
 *
 * Flags:
 *   --file <ruta>   CSV de entrada (por defecto el export en D:/Descargas).
 *   --limit N       procesa solo N productos padre/simples publicados.
 *   --dry-run       no escribe en BD; solo loguea lo que haría.
 *   --no-images     no sube imágenes a R2; usa la URL original del CSV.
 */
require('dotenv').config();
const { readFileSync } = require('fs');
const { extname } = require('path');
const { randomUUID } = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { parse } = require('csv-parse/sync');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// ---------------------------------------------------------------------------
// Configuración / argumentos
// ---------------------------------------------------------------------------

const DEFAULT_CSV = 'D:/Descargas/wc-product-export-23-6-2026-1782233584564.csv';

function parseArgs(argv) {
  const opts = { file: DEFAULT_CSV, limit: Infinity, dryRun: false, noImages: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') opts.file = argv[++i];
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10) || Infinity;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-images') opts.noImages = true;
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_URL,
} = process.env;

const prisma = new PrismaClient();

// Cliente R2 solo si vamos a subir imágenes.
let s3 = null;
let r2PublicBase = '';
if (!args.noImages) {
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET ||
    !R2_PUBLIC_URL
  ) {
    console.error(
      '❌ R2 no está completamente configurado en backend/.env (usa --no-images para omitir la subida).',
    );
    process.exit(1);
  }
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  r2PublicBase = R2_PUBLIC_URL.replace(/\/$/, '');
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// Resumen acumulado.
const stats = { simples: 0, variables: 0, variantes: 0, imagenes: 0, errores: 0 };

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

// Igual que el resto del proyecto (categories/blog/seed).
function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // elimina acentos/diacríticos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Convierte HTML en texto preservando párrafos y viñetas (<li> -> "• ").
function stripHtml(html) {
  if (!html) return '';
  let s = String(html);
  // Ruido entre etiquetas: "\n" literales, saltos reales y tabs -> espacio.
  s = s.replace(/\\r\\n|\\n|\\r/g, ' ').replace(/[\r\n\t]+/g, ' ');
  // Estructura -> saltos / viñetas.
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/(p|div|ul|ol|h[1-6])\s*>/gi, '\n');
  // Resto de etiquetas + entidades.
  s = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&hellip;/gi, '…');
  // Espacios y saltos.
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*\b(Shorten|Rewrite|Expand|Translate)\s+with\s+AI\s*$/i, '')
    .trim();
}

// Divide un campo "a, b, c" en valores limpios y no vacíos.
function splitValues(field) {
  return String(field || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Valores de atributo: WooCommerce usa '|' (a veces ',') como separador.
function splitAttrValues(field) {
  return String(field || '')
    .split(/[|,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

// Parsea un precio que puede venir como "1.234,56", "1234,56" o "1234.56".
function parsePrice(field) {
  let s = String(field || '').trim();
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // coma decimal (es-ES)
  else s = s.replace(/,/g, ''); // coma como separador de miles
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// Primera imagen útil de una lista "url1, url2".
function firstImageUrl(field) {
  const list = splitValues(field);
  return list[0] || null;
}

// ---------------------------------------------------------------------------
// Imágenes → R2
// ---------------------------------------------------------------------------

const imageCache = new Map(); // url original -> url final

async function uploadImage(url) {
  if (!url) return null;
  if (args.noImages || args.dryRun) return url; // en dry-run no tocamos R2
  if (imageCache.has(url)) return imageCache.get(url);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    let ext = extname(new URL(url).pathname).toLowerCase();
    if (!MIME[ext]) ext = '.jpg'; // extensión por defecto si no la reconocemos
    const key = `products/${randomUUID()}${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: MIME[ext] || 'application/octet-stream',
      }),
    );

    const finalUrl = `${r2PublicBase}/${key}`;
    imageCache.set(url, finalUrl);
    stats.imagenes++;
    return finalUrl;
  } catch (e) {
    console.warn(`   ⚠ no se pudo subir la imagen ${url}: ${e.message}`);
    imageCache.set(url, url); // no reintentar la misma URL
    return url; // conserva la URL original
  }
}

// Sube una lista de imágenes "url1, url2" y devuelve array de URLs finales.
async function uploadImages(field) {
  const out = [];
  for (const url of splitValues(field)) {
    const u = await uploadImage(url);
    if (u) out.push(u);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Categorías / subcategorías
// ---------------------------------------------------------------------------

const categoryCache = new Map(); // slug -> id
const subcategoryCache = new Map(); // categoryId::slug -> id

// Resuelve (creando si hace falta) la categoría/subcategoría de un producto.
async function resolveCategory(rawCategorias) {
  // Toma la PRIMERA categoría: "A > B, C > D" -> "A > B".
  const first = String(rawCategorias || '').split(',')[0] || '';
  const parts = first.split('>').map((p) => p.trim()).filter(Boolean);
  const catName = parts[0];
  const subName = parts[1];

  if (!catName) return { categoryId: null, subcategoryId: null };

  // --- Categoría ---
  const catSlug = slugify(catName) || 'categoria';
  let categoryId = categoryCache.get(catSlug);
  if (!categoryId) {
    if (args.dryRun) {
      categoryId = `dry:cat:${catSlug}`;
    } else {
      let cat = await prisma.category.findUnique({ where: { slug: catSlug } });
      if (!cat) {
        cat = await prisma.category.create({
          data: { name: catName, slug: catSlug, order: 0 },
        });
      }
      categoryId = cat.id;
    }
    categoryCache.set(catSlug, categoryId);
  }

  // --- Subcategoría (opcional) ---
  let subcategoryId = null;
  if (subName) {
    const subSlug = slugify(subName) || 'subcategoria';
    const subKey = `${categoryId}::${subSlug}`;
    subcategoryId = subcategoryCache.get(subKey);
    if (!subcategoryId) {
      if (args.dryRun) {
        subcategoryId = `dry:sub:${subKey}`;
      } else {
        let sub = await prisma.subcategory.findUnique({
          where: { categoryId_slug: { categoryId, slug: subSlug } },
        });
        if (!sub) {
          sub = await prisma.subcategory.create({
            data: { name: subName, slug: subSlug, categoryId, order: 0 },
          });
        }
        subcategoryId = sub.id;
      }
      subcategoryCache.set(subKey, subcategoryId);
    }
  }

  return { categoryId, subcategoryId };
}

// ---------------------------------------------------------------------------
// SKUs únicos
// ---------------------------------------------------------------------------

const usedSkus = new Set(); // SKUs ya asignados en esta corrida

// Para idempotencia: si el producto ya existe (por externalId), reutiliza su SKU.
async function resolveSkuForImport(externalId, csvSku, name) {
  if (externalId && !args.dryRun) {
    const ex = await prisma.product.findFirst({
      where: { externalId },
      select: { sku: true },
    });
    if (ex) {
      usedSkus.add(ex.sku);
      return ex.sku;
    }
  }
  return uniqueSku(csvSku, name);
}

// Devuelve un SKU único: usa el del CSV si está libre; si no, lo desambigua.
async function uniqueSku(csvSku, name) {
  const provided = String(csvSku || '').trim();
  const base = provided || slugify(name) || 'producto';
  let candidate = base;
  let i = 2;
  for (;;) {
    if (!usedSkus.has(candidate) && !(await skuExistsInDb(candidate))) {
      usedSkus.add(candidate);
      return candidate;
    }
    candidate = `${base}-${i++}`;
  }
}

async function skuExistsInDb(sku) {
  if (args.dryRun) return false;
  const found = await prisma.product.findUnique({ where: { sku } });
  return Boolean(found);
}

// ---------------------------------------------------------------------------
// Atributos / variantes
// ---------------------------------------------------------------------------

// Lee los atributos del PADRE: [{ name, values: [...] }] (N = 1..3).
function parseParentAttributes(parent) {
  const attrs = [];
  for (let n = 1; n <= 3; n++) {
    const name = String(parent[`Nombre del atributo ${n}`] || '').trim();
    if (!name) continue;
    const values = splitAttrValues(parent[`Valor(es) del atributo ${n}`]);
    attrs.push({ name, values });
  }
  return attrs;
}

// Construye options {[attrName]: valor} para una VARIACIÓN, usando los
// nombres de atributo del PADRE y los valores propios de la variación.
function buildVariantOptions(parent, variation) {
  const options = {};
  for (let n = 1; n <= 3; n++) {
    const name = String(parent[`Nombre del atributo ${n}`] || '').trim();
    if (!name) continue;
    const value = String(variation[`Valor(es) del atributo ${n}`] || '').trim();
    if (!value) continue; // valor vacío = "cualquiera"; no lo fijamos
    options[name] = value;
  }
  return options;
}

// ---------------------------------------------------------------------------
// Persistencia de un producto (idempotente por externalId)
// ---------------------------------------------------------------------------

async function upsertProduct(data, variants) {
  if (args.dryRun) {
    console.log(
      `   [dry-run] ${data.hasVariants ? 'variable' : 'simple'} "${data.name}" ` +
        `(sku=${data.sku}, externalId=${data.externalId}, variantes=${variants.length})`,
    );
    return;
  }

  // Solo busca coincidencia si hay externalId (evita pisar productos sin ID).
  const existing = data.externalId
    ? await prisma.product.findFirst({ where: { externalId: data.externalId } })
    : null;

  if (existing) {
    // Actualiza el producto y re-crea sus variantes desde cero.
    await prisma.productVariant.deleteMany({ where: { productId: existing.id } });
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        ...data,
        variants: variants.length
          ? { create: variants }
          : undefined,
      },
    });
    console.log(`   ✓ actualizado "${data.name}"`);
  } else {
    await prisma.product.create({
      data: {
        ...data,
        variants: variants.length ? { create: variants } : undefined,
      },
    });
    console.log(`   ✓ creado "${data.name}"`);
  }
}

// ---------------------------------------------------------------------------
// Procesamiento de un producto SIMPLE
// ---------------------------------------------------------------------------

async function processSimple(row) {
  const name = String(row['Nombre'] || '').trim();
  const { categoryId, subcategoryId } = await resolveCategory(row['Categorías']);
  if (!categoryId) {
    console.warn(`   ⚠ "${name}" sin categoría; se omite.`);
    return;
  }

  const externalId = String(row['ID'] || '').trim() || null;
  const sku = await resolveSkuForImport(externalId, row['SKU'], name);
  const images = await uploadImages(row['Imágenes']);

  const data = {
    name,
    sku,
    description: stripHtml(row['Descripción']) || null,
    images,
    stock: parseInt(row['Inventario'], 10) || 0,
    hasVariants: false,
    attributes: undefined,
    price: parsePrice(row['Precio normal']),
    categoryId,
    subcategoryId,
    externalId,
  };

  await upsertProduct(data, []);
  stats.simples++;
}

// ---------------------------------------------------------------------------
// Procesamiento de un producto VARIABLE
// ---------------------------------------------------------------------------

async function processVariable(parent, variations) {
  const name = String(parent['Nombre'] || '').trim();
  const { categoryId, subcategoryId } = await resolveCategory(parent['Categorías']);
  if (!categoryId) {
    console.warn(`   ⚠ "${name}" sin categoría; se omite.`);
    return;
  }

  const externalId = String(parent['ID'] || '').trim() || null;
  const sku = await resolveSkuForImport(externalId, parent['SKU'], name);
  const parentImages = await uploadImages(parent['Imágenes']);
  const parentFirstImage = parentImages[0] || null;
  const description = stripHtml(parent['Descripción']) || null;

  // C5: un "variable" sin variaciones se trata como producto simple.
  if (variations.length === 0) {
    console.warn(`   ⚠ "${name}" es variable pero no tiene variaciones; se importa como simple.`);
    await upsertProduct(
      {
        name, sku, description, images: parentImages, stock: 0,
        hasVariants: false, attributes: undefined,
        price: parsePrice(parent['Precio normal']),
        categoryId, subcategoryId, externalId,
      },
      [],
    );
    stats.simples++;
    return;
  }

  let attributes = parseParentAttributes(parent);

  // Construye las variantes a partir de las variaciones hijas.
  const variants = [];
  for (let i = 0; i < variations.length; i++) {
    const v = variations[i];
    const options = buildVariantOptions(parent, v);
    const label = Object.keys(options).length
      ? Object.entries(options).map(([k, val]) => `${k}: ${val}`).join(' · ')
      : `Opción ${i + 1}`;
    const ownImage = await uploadImage(firstImageUrl(v['Imágenes']));
    variants.push({
      sku: String(v['SKU'] || '').trim() || null,
      label,
      options,
      price: parsePrice(v['Precio normal']),
      stock: parseInt(v['Inventario'], 10) || 0,
      image: ownImage || parentFirstImage,
    });
  }

  // Si tras agrupar solo queda 1 variante, un selector no aporta: lo tratamos
  // como producto simple con el precio de esa variante.
  if (variants.length === 1) {
    console.warn(`   ⚠ "${name}" tiene 1 sola variante; se importa como simple.`);
    await upsertProduct(
      {
        name, sku, description, images: parentImages,
        stock: variants[0].stock || 0, hasVariants: false, attributes: undefined,
        price: variants[0].price || parsePrice(parent['Precio normal']),
        categoryId, subcategoryId, externalId,
      },
      [],
    );
    stats.simples++;
    return;
  }

  // C6: si las variantes no son distinguibles por sus opciones (valores de
  // atributo vacíos o repetidos), usa un único atributo sintético "Presentación"
  // con una etiqueta única por variante, para que el selector funcione.
  const sigs = variants.map((v) => JSON.stringify(v.options));
  const allDistinct = new Set(sigs).size === variants.length;
  const anyEmpty = variants.some((v) => Object.keys(v.options).length === 0);
  if (!allDistinct || anyEmpty || attributes.length === 0) {
    const values = [];
    variants.forEach((v, i) => {
      let val = v.label && v.label !== `Opción ${i + 1}` ? v.label : `Opción ${i + 1}`;
      if (values.includes(val)) val = `${val} (${i + 1})`;
      values.push(val);
      v.options = { Presentación: val };
      v.label = val;
    });
    attributes = [{ name: 'Presentación', values }];
  }

  // I7: precio "desde" = mínimo de variantes con precio > 0.
  const positive = variants.map((v) => v.price).filter((p) => p > 0);
  const basePrice = positive.length ? Math.min(...positive) : 0;

  await upsertProduct(
    {
      name, sku, description, images: parentImages, stock: 0,
      hasVariants: true, attributes, price: basePrice,
      categoryId, subcategoryId, externalId,
    },
    variants,
  );
  stats.variables++;
  stats.variantes += variants.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`→ Leyendo CSV: ${args.file}`);
  if (args.dryRun) console.log('   (modo --dry-run: no se escribe en BD)');
  if (args.noImages) console.log('   (modo --no-images: se conservan las URLs originales)');

  const content = readFileSync(args.file, 'utf8');
  const rows = parse(content, {
    columns: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });

  // Valida encabezados esperados (export en español).
  if (!rows.length || !('Nombre' in rows[0]) || !('Tipo' in rows[0])) {
    console.error('❌ El CSV no tiene los encabezados esperados (Nombre/Tipo). ¿Export en otro idioma?');
    process.exit(1);
  }

  // Filtra padres/simples no publicados (Publicado === '-1'); las variaciones
  // se filtran a través de su padre, no se descartan aquí.
  const published = rows.filter((r) => {
    const tipo = String(r['Tipo'] || '').trim();
    if (tipo === 'variation') return true;
    return String(r['Publicado'] ?? '').trim() !== '-1';
  });

  // Índices de padres (simple|variable) por ID y por SKU.
  const byId = new Map();
  const bySku = new Map();
  const parents = []; // orden de aparición de padres/simples
  const variations = [];

  for (const r of published) {
    const tipo = String(r['Tipo'] || '').trim();
    if (tipo === 'simple' || tipo === 'variable') {
      const id = String(r['ID'] || '').trim();
      const sku = String(r['SKU'] || '').trim();
      if (id) byId.set(id, r);
      if (sku) bySku.set(sku, r);
      parents.push(r);
    } else if (tipo === 'variation') {
      variations.push(r);
    }
  }

  // Agrupa variaciones por su padre.
  const variationsByParentId = new Map(); // ID del padre -> [variaciones]
  for (const v of variations) {
    const superior = String(v['Superior'] || '').trim();
    let parent = null;
    if (superior.startsWith('id:')) {
      parent = byId.get(superior.slice(3).trim());
    } else {
      parent = bySku.get(superior);
    }
    if (!parent) {
      console.warn(`   ⚠ variación con padre desconocido "Superior=${superior}"; se omite.`);
      continue;
    }
    const pid = String(parent['ID'] || '').trim();
    if (!variationsByParentId.has(pid)) variationsByParentId.set(pid, []);
    variationsByParentId.get(pid).push(v);
  }

  // Procesa hasta --limit productos padre/simples.
  let processed = 0;
  for (const parent of parents) {
    if (processed >= args.limit) break;
    const tipo = String(parent['Tipo'] || '').trim();
    const name = String(parent['Nombre'] || '').trim();
    try {
      if (tipo === 'simple') {
        console.log(`→ [${processed + 1}] simple: ${name}`);
        await processSimple(parent);
      } else {
        const pid = String(parent['ID'] || '').trim();
        const childVariations = variationsByParentId.get(pid) || [];
        console.log(`→ [${processed + 1}] variable: ${name} (${childVariations.length} variaciones)`);
        await processVariable(parent, childVariations);
      }
    } catch (e) {
      stats.errores++;
      console.error(`   ✗ error en "${name}": ${e.message}`);
    }
    processed++;
  }

  console.log('\n──────────── Resumen ────────────');
  console.log(`  Productos simples : ${stats.simples}`);
  console.log(`  Productos variables: ${stats.variables}`);
  console.log(`  Variantes         : ${stats.variantes}`);
  console.log(`  Imágenes subidas  : ${stats.imagenes}`);
  console.log(`  Errores           : ${stats.errores}`);
  console.log('─────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('❌ Fallo del importador:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
