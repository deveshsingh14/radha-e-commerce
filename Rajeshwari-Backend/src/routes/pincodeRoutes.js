const express = require("express");

const prisma = require("../config/db");
const logger = require("../config/logger");

const authMiddleware = require("../middleware/authMiddleware");
const adminOrOwnerMiddleware = require("../middleware/adminOrOwnerMiddleware");

const { z } = require("zod");
const { validateBody } = require("../middleware/validate");

const router = express.Router();

const PINCODE_PATTERN = /^\d{6}$/;

// optional place details: trimmed, empty -> null
const placeField = z.string().trim().max(80).optional().nullable()
  .transform(v => (v ? v : null));
const areaSchema = z.object({ area: placeField, city: placeField, state: placeField });
const addSchema = areaSchema.extend({
  pincode: z.string().trim().regex(PINCODE_PATTERN, "A valid 6-digit pincode is required")
});

const toArea = p => ({ pincode: p.pincode, area: p.area || null, city: p.city || null, state: p.state || null });

// ---- PUBLIC: where do we deliver? (shown at checkout) ----
router.get("/areas", async (req, res) => {
  try {
    const setting = await prisma.pincodeRestriction.findUnique({ where: { id: 1 } });
    const enabled = setting ? setting.enabled : false;
    const rows = enabled ? await prisma.serviceablePincode.findMany({ orderBy: { pincode: "asc" } }) : [];
    res.json({ enabled, areas: rows.map(toArea) });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to load delivery areas" });
  }
});

// ---- GET restriction toggle + allow-list (admin/owner) ----
router.get("/", authMiddleware, adminOrOwnerMiddleware, async (req, res) => {
  try {
    const setting = await prisma.pincodeRestriction.findUnique({ where: { id: 1 } });
    const pincodes = await prisma.serviceablePincode.findMany({
      orderBy: { pincode: "asc" }
    });

    res.json({
      enabled: setting ? setting.enabled : false,
      pincodes: pincodes.map(p => p.pincode),
      areas: pincodes.map(toArea)
    });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to fetch pincode restriction settings" });
  }
});

// ---- TOGGLE the restriction on/off (admin/owner) ----
router.put("/toggle", authMiddleware, adminOrOwnerMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled must be true or false" });
    }

    const setting = await prisma.pincodeRestriction.upsert({
      where: { id: 1 },
      update: { enabled },
      create: { id: 1, enabled }
    });

    res.json({ enabled: setting.enabled });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to update the restriction toggle" });
  }
});

// ---- ADD a serviceable pincode (admin/owner) ----
router.post("/", authMiddleware, adminOrOwnerMiddleware, validateBody(addSchema), async (req, res) => {
  try {
    const { pincode, area, city, state } = req.body;
    const details = { area: area ?? null, city: city ?? null, state: state ?? null };
    const created = await prisma.serviceablePincode.upsert({
      where: { pincode },
      update: details,
      create: { pincode, ...details }
    });

    res.json(created);
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to add pincode" });
  }
});

// ---- EDIT a pincode's area / city / state (admin/owner) ----
router.put("/:pincode", authMiddleware, adminOrOwnerMiddleware, validateBody(areaSchema), async (req, res) => {
  const pincode = String(req.params.pincode || "");
  if (!PINCODE_PATTERN.test(pincode)) return res.status(400).json({ message: "Invalid pincode" });
  try {
    const { area, city, state } = req.body;
    const { count } = await prisma.serviceablePincode.updateMany({
      where: { pincode },
      data: { area: area ?? null, city: city ?? null, state: state ?? null }
    });
    if (count === 0) return res.status(404).json({ message: "Pincode not found" });
    res.json(toArea({ pincode, area, city, state }));
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to update pincode" });
  }
});

// ---- REMOVE a serviceable pincode (admin/owner) ----
router.delete("/:pincode", authMiddleware, adminOrOwnerMiddleware, async (req, res) => {
  try {
    await prisma.serviceablePincode.deleteMany({
      where: { pincode: req.params.pincode }
    });

    res.json({ message: "Pincode removed" });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to remove pincode" });
  }
});

module.exports = router;
module.exports.schemas = { addSchema, areaSchema };
