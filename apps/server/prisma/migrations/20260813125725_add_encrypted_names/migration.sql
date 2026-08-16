-- AlterTable
ALTER TABLE "files" ADD COLUMN     "encryptedName" TEXT,
ADD COLUMN     "nameIv" TEXT,
ALTER COLUMN "name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "folders" ADD COLUMN     "encrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "encryptedName" TEXT,
ADD COLUMN     "nameIv" TEXT,
ALTER COLUMN "name" DROP NOT NULL;
