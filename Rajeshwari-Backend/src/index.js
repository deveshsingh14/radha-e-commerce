require("dotenv").config();

// ADDED: fail loudly at boot if a required env var is missing, instead
// of failing cryptically later — e.g. a missing CLOUDINARY_* var used
// to mean uploads silently threw "Upload failed" until you noticed the
// var was never set. Checked before requiring anything below, since
// several of those (e.g. config/cloudinary.js) read process.env at
// import time.
const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
];

const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);

if (missingEnvVars.length > 0) {
  // Deliberately plain console.error, not the pino logger: pino-pretty
  // runs its formatting on a worker thread, so a log call immediately
  // before process.exit() can get lost if the process exits before the
  // transport flushes. This message is too important to risk that.
  console.error(
    `Missing required environment variable(s): ${missingEnvVars.join(", ")}. ` +
    `Set them in .env (locally) or in the Render dashboard (production) before starting the server.`
  );
  process.exit(1);
}

// Error monitoring must start before express and the routes are loaded.
const { Sentry, enabled: sentryEnabled } = require("./instrument");

const express = require("express");
const cors = require("cors");

const productRoutes = require("./routes/productRoutes");
const authRoutes = require("./routes/authRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const cartRoutes = require("./routes/cartRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const orderRoutes = require("./routes/orderRoutes");
const userRoutes = require("./routes/userRoutes");
const pincodeRoutes = require("./routes/pincodeRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const prisma = require("./config/db");
const logger = require("./config/logger");
const errorHandler = require("./middleware/errorHandler");


const app = express();

// CHANGED: cors() with no options reflected every origin. Restricted to
// the actual deployed frontend + local dev server. `!origin` covers
// non-browser clients (curl, server-to-server, mobile apps) that don't
// send an Origin header at all — those were never something CORS could
// protect against anyway.
const ALLOWED_ORIGINS = [
  "https://deveshsingh14.github.io"
];

if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.push(
    "http://localhost:5500",
    "http://127.0.0.1:5500"
  );
}

app.use(cors({
  // CHANGED: reject with `false`, not an Error — an Error here reaches
  // Express's default error handler and returns a 500 (with a stack
  // trace outside production), when a disallowed origin should just
  // get no CORS headers and let the browser block it client-side.
  origin: (origin, callback) => {
    callback(null, !origin || ALLOWED_ORIGINS.includes(origin));
  }
}));
app.use(express.json());

app.use("/uploads", express.static("uploads"));

app.use("/products", productRoutes);
app.use("/auth", authRoutes);
app.use("/categories", categoryRoutes);
app.use("/cart", cartRoutes);
app.use("/wishlist", wishlistRoutes);
app.use("/orders", orderRoutes);
app.use("/users", userRoutes);
app.use("/pincode-restrictions", pincodeRoutes);
app.use("/notifications", notificationRoutes);


app.get("/", (req, res) => {
  res.send("Backend Working");
});

// ADDED: a real health check — the old GET / only proved the process
// was up, not whether it could actually reach the database.
app.get("/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      db: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(error);
    res.status(503).json({
      status: "error",
      db: "disconnected",
      timestamp: new Date().toISOString()
    });
  }
});

// ADDED: registered last, after every route — a safety net for
// whatever reaches Express without a route already having handled it
// (unawaited async errors, malformed JSON bodies, anything thrown by
// middleware), not a replacement for the try/catch blocks in the
// route files.
// Sentry's Express handler reports 5xx errors that reach Express (4xx are
// expected client mistakes), then hands over to our own errorHandler.
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app, {
    shouldHandleError: (err) => !err || !(Number(err.status || err.statusCode) < 500)
  });
}
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});