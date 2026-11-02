const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { clientIp } = require("../utils/clientIp");

// Per VISITOR, not per proxy: key on the real client IP (see clientIp).
// ipKeyGenerator groups IPv6 addresses by subnet so one device can't dodge
// the limit by rotating addresses.
const perVisitor = { keyGenerator: (req) => ipKeyGenerator(clientIp(req)) };

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  ...perVisitor,
  message: { message: "Too many login attempts. Please try again later." }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  ...perVisitor,
  message: { message: "Too many accounts created from this IP. Please try again later." }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  ...perVisitor,
  message: { message: "Too many password reset requests. Please try again later." }
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  ...perVisitor,
  message: { message: "Too many password reset attempts. Please try again later." }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  ...perVisitor,
  message: { message: "Too many upload attempts. Please try again later." }
});

module.exports = { perVisitor, loginLimiter, registerLimiter, forgotPasswordLimiter, resetPasswordLimiter, uploadLimiter };
