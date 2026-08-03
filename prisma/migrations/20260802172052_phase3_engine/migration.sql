-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN     "rollbackOfVersion" INTEGER;

-- CreateIndex
CREATE INDEX "Deployment_status_idx" ON "Deployment"("status");
