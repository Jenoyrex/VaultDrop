-- AlterTable
ALTER TABLE "files" ADD COLUMN     "encrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wrappedKeyCiphertext" TEXT,
ADD COLUMN     "wrappedKeyIv" TEXT;

-- AlterTable
ALTER TABLE "vaults" ADD COLUMN     "encryptionVersion" INTEGER,
ADD COLUMN     "kekHash" TEXT,
ADD COLUMN     "kekIterations" INTEGER,
ADD COLUMN     "kekSalt" TEXT,
ADD COLUMN     "recoveryWrappedDekCiphertext" TEXT,
ADD COLUMN     "recoveryWrappedDekIv" TEXT,
ADD COLUMN     "wrappedDekCiphertext" TEXT,
ADD COLUMN     "wrappedDekIv" TEXT;
