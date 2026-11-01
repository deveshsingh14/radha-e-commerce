-- Area/city/state for each serviceable pincode (checkout locks city/state to it). Additive.
-- AlterTable
ALTER TABLE "serviceable_pincode" ADD COLUMN     "area" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "state" TEXT;

