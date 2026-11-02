const express = require("express");
const { z } = require("zod");

const prisma = require("../config/db");
const logger = require("../config/logger");

const authMiddleware =
  require("../middleware/authMiddleware");

const adminOrOwnerMiddleware =
  require("../middleware/adminOrOwnerMiddleware");

const { validateBody } = require("../middleware/validate");
const { fieldTemplateField } = require("../utils/productFields");

const router = express.Router();

// isJewellery decides which storefront section a category belongs to:
// true  -> the Jewellery & Bangles page (jewellery.html)
// false -> the main Radha E-Commerce feed (index.html)
const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(60, "Category name is too long"),
  isJewellery: z.boolean().optional()
});

// isJewellery and/or fieldTemplate (extra product field labels, e.g.
// ["Purity", "Weight"]; null clears it). At least one must be sent.
const categoryUpdateSchema = z.object({
  isJewellery: z.boolean({ message: "isJewellery must be true or false" }).optional(),
  fieldTemplate: fieldTemplateField.optional()
}).strict().refine(b => b.isJewellery !== undefined || b.fieldTemplate !== undefined,
  { message: "Nothing to update" });



// CREATE CATEGORY
router.post(
  "/",
  authMiddleware,
  adminOrOwnerMiddleware,
  validateBody(categoryCreateSchema),
  async (req, res) => {

    try {

      const { name, isJewellery } = req.body;

      const existingCategory =
        await prisma.category.findUnique({

          where: { name }

        });

      if (existingCategory) {

        return res.status(400).json({

          message:
            "Category already exists"

        });

      }

      const category =
        await prisma.category.create({

          data: { name, isJewellery: isJewellery ?? false }

        });

      res.json(category);

    } catch (error) {

      logger.error(error);

      res.status(500).json({

        message:
          "Failed to create category"

      });

    }

  }
);



// GET ALL CATEGORIES
router.get(
  "/",
  async (req, res) => {

    try {

      const categories =
        await prisma.category.findMany({

          orderBy: {
            createdAt: "desc"
          }

        });

      res.json(categories);

    } catch (error) {

      logger.error(error);

      res.status(500).json({

        message:
          "Failed to fetch categories"

      });

    }

  }
);



// UPDATE CATEGORY SECTION (jewellery or not)
// only the fields that were sent; an empty list means "no template"
function categoryUpdateData(body) {
  const data = {};
  if (body.isJewellery !== undefined) data.isJewellery = body.isJewellery;
  if (body.fieldTemplate !== undefined) data.fieldTemplate = body.fieldTemplate || [];
  return data;
}

router.patch(
  "/:id",
  authMiddleware,
  adminOrOwnerMiddleware,
  validateBody(categoryUpdateSchema),
  async (req, res) => {

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid category id" });
    }

    try {

      const category = await prisma.category.update({
        where: { id },
        data: categoryUpdateData(req.body)
      });

      res.json(category);

    } catch (error) {

      if (error && error.code === "P2025") {
        return res.status(404).json({ message: "Category not found" });
      }

      logger.error(error);
      res.status(500).json({ message: "Failed to update category" });

    }

  }
);



// DELETE CATEGORY
router.delete(
  "/:id",
  authMiddleware,
  adminOrOwnerMiddleware,
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);

      await prisma.productCategory.deleteMany({

        where: {
          categoryId: id
        }

      });

      await prisma.category.delete({

        where: { id }

      });

      res.json({

        message:
          "Category deleted"

      });

    } catch (error) {

      logger.error(error);

      res.status(500).json({

        message:
          "Failed to delete category"

      });

    }

  }
);

module.exports = router;
module.exports.schemas = { categoryCreateSchema, categoryUpdateSchema };
