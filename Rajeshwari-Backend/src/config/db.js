const { PrismaClient } = require("@prisma/client");

// costPrice is the shop's buying price: ADMIN/OWNER only. It is left out of
// EVERY query by default (including products nested in carts, wishlists
// and orders). Admin routes opt back in with ADMIN_PRODUCT_OMIT.
const prisma = new PrismaClient({
  omit: { product: { costPrice: true } }
});

module.exports = prisma;
