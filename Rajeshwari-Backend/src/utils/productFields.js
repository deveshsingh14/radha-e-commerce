// Product fields shared by create, update and CSV upload.
const { z } = require("zod");

const ADMIN_PRODUCT_OMIT = { costPrice: false }; // admin routes: include costPrice

const blankToNull = v => (typeof v === "string" && v.trim() === "") ? null : v;

// optional money: "" / null clears it; otherwise a number
const optionalMoney = (msg, allowZero) => z.preprocess(blankToNull,
  (allowZero ? z.coerce.number().nonnegative(msg) : z.coerce.number().positive(msg)).nullable().optional());

const optionalText = (max, label) => z.preprocess(v => {
  v = blankToNull(v);
  return typeof v === "string" ? v.trim() : v;
}, z.string().max(max, `${label} is too long (max ${max})`).nullable().optional());

// "Gold; Bridal, Kundan" or ["gold", "bridal"] -> ["gold","bridal","kundan"]
function normalizeTags(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return [];
  const list = Array.isArray(v) ? v : String(v).split(/[;,]/);
  const out = [];
  for (const t of list) {
    const s = String(t).trim().toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
const tagsField = z.preprocess(normalizeTags,
  z.array(z.string().max(30, "Each tag must be 30 characters or less")).max(20, "At most 20 tags").optional());

// [{label, value}] ; blank values dropped; labels unique (case-insensitive)
function normalizeAttributes(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return [];
  if (!Array.isArray(v)) return v; // let zod reject it
  const seen = new Set();
  const out = [];
  for (const a of v) {
    const ok = x => x === undefined || x === null || typeof x === "string" || typeof x === "number";
    if (!a || typeof a !== "object" || !ok(a.label) || !ok(a.value)) { out.push(a); continue; }
    const label = String(a.label ?? "").trim();
    const value = String(a.value ?? "").trim();
    if (!label || !value) continue;
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label, value });
  }
  return out;
}
const attributesField = z.preprocess(normalizeAttributes, z.array(z.object({
  label: z.string().max(40, "Field name is too long (max 40)"),
  value: z.string().max(200, "Field value is too long (max 200)")
}).strict()).max(30, "At most 30 extra fields").optional());

const productFields = {
  mrp: optionalMoney("MRP must be a positive number"),
  costPrice: optionalMoney("Cost price must not be negative", true),
  brand: optionalText(60, "Brand"),
  sku: optionalText(40, "SKU"),
  size: optionalText(60, "Size"),
  color: optionalText(60, "Colour"),
  material: optionalText(60, "Material"),
  tags: tagsField,
  attributes: attributesField
};

// Selling above the printed MRP is not allowed (Legal Metrology rules).
function pricingError(price, mrp) {
  if (mrp === null || mrp === undefined || price === null || price === undefined) return null;
  if (Number(mrp) < Number(price)) return `Selling price (₹${price}) can't be more than the MRP (₹${mrp})`;
  return null;
}

// "Category template": a list of field labels.
const fieldTemplateField = z.preprocess(v => {
  if (v === null || v === "") return null;
  if (!Array.isArray(v)) return v;
  const out = [];
  for (const l of v) {
    if (typeof l !== "string") return v; // let zod reject non-text entries
    const s = l.trim();
    if (s && !out.some(o => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}, z.array(z.string().max(40, "Field name is too long (max 40)")).max(20, "At most 20 template fields").nullable());

module.exports = { ADMIN_PRODUCT_OMIT, productFields, pricingError, normalizeTags, normalizeAttributes, fieldTemplateField };
