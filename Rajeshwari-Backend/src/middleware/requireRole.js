const prisma = require("../config/db");

// Role gate that trusts the DATABASE, not just the token. A JWT carries the
// role it was issued with (valid for 7 days) and could be forged if the
// signing secret ever leaked, so privileged routes also confirm the account
// still exists and still has an allowed role.
function requireRole(allowed, message) {
  return async function roleMiddleware(req, res, next) {
    try {
      const user = req.user;
      if (!user || !allowed.includes(user.role) || !Number.isInteger(user.id)) {
        return res.status(403).json({ message });
      }
      const current = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true } });
      if (!current || !allowed.includes(current.role)) {
        return res.status(403).json({ message });
      }
      req.user.role = current.role; // the current role from here on
      next();
    } catch (error) {
      res.status(500).json({ message: "Couldn't verify access" });
    }
  };
}

module.exports = requireRole;
