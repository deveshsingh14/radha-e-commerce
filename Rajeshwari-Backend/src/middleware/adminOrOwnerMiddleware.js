// Admin or Owner routes (catalogue, orders, delivery areas).
// Role is re-checked in the database on every request (see requireRole).
const requireRole = require("./requireRole");

module.exports = requireRole(["ADMIN", "OWNER"], "Admin or Owner access only");
