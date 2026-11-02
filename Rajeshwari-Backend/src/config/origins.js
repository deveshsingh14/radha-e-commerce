// Browser origins allowed to call the API (CORS) and to send analytics.
const ALLOWED_ORIGINS = ["https://deveshsingh14.github.io"];

if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.push("http://localhost:5500", "http://127.0.0.1:5500");
}

module.exports = { ALLOWED_ORIGINS };
