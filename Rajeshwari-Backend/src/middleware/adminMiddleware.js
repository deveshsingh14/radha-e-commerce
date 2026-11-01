// Admin-only routes (customer data, role changes, account deletion).
// Role is re-checked in the database on every request (see requireRole).
const requireRole = require("./requireRole");

module.exports = requireRole(["ADMIN"], "Admin access only");
