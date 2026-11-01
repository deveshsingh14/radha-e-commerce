// The master ("super") admin is the account whose email is ADMIN_EMAIL.
// It can't be demoted or deleted by other admins.
//
// Resolved to ONE account id (never by comparing emails case-insensitively
// at check time): registration doesn't normalise email case, so someone could
// register "Devesh141Singh@..." — that look-alike must NOT become protected.
//   1. exact email match with role ADMIN, else
//   2. the oldest ADMIN whose email matches ignoring case/surrounding spaces.
const logger = require("../config/logger");

let warned = false;

async function getSuperAdminId(prisma) {
  const email = String(process.env.ADMIN_EMAIL || "").trim();
  if (!email) {
    if (!warned) {
      logger.warn("ADMIN_EMAIL is not set: the master admin account is not protected from demotion/deletion.");
      warned = true;
    }
    return null;
  }
  const exact = await prisma.user.findFirst({ where: { email, role: "ADMIN" }, select: { id: true } });
  if (exact) return exact.id;
  const similar = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, role: "ADMIN" },
    orderBy: { id: "asc" },
    select: { id: true }
  });
  return similar ? similar.id : null;
}

module.exports = { getSuperAdminId, _resetWarning: () => { warned = false; } };
