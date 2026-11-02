-- Anonymous analytics (events 90 days, unique views 3 days, permanent daily totals) + product view count. Additive.
-- AlterTable
ALTER TABLE "product" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "analytics_event" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "productId" INTEGER,
    "categoryName" TEXT,
    "term" TEXT,
    "resultCount" INTEGER,
    "pincode" TEXT,
    "page" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_view" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "visitorId" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "product_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_daily_stat" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "carts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_daily_stat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_event_type_createdAt_idx" ON "analytics_event"("type", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_event_productId_type_createdAt_idx" ON "analytics_event"("productId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_event_createdAt_idx" ON "analytics_event"("createdAt");

-- CreateIndex
CREATE INDEX "product_view_day_idx" ON "product_view"("day");

-- CreateIndex
CREATE UNIQUE INDEX "product_view_productId_visitorId_day_key" ON "product_view"("productId", "visitorId", "day");

-- CreateIndex
CREATE INDEX "product_daily_stat_day_idx" ON "product_daily_stat"("day");

-- CreateIndex
CREATE UNIQUE INDEX "product_daily_stat_productId_day_key" ON "product_daily_stat"("productId", "day");

