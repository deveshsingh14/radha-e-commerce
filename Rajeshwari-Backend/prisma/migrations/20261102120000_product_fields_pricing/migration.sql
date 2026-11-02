-- AlterTable
ALTER TABLE "category" ADD COLUMN     "fieldTemplate" JSONB;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "costPrice" DOUBLE PRECISION,
ADD COLUMN     "material" TEXT,
ADD COLUMN     "mrp" DOUBLE PRECISION,
ADD COLUMN     "size" TEXT,
ADD COLUMN     "sku" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "product_sku_key" ON "product"("sku");

