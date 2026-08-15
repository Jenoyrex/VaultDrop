import { describe, expect, it } from "vitest";
import { FolderService } from "./folder.service.js";
import { createFakePrisma } from "../test-support/fake-prisma.js";

const OWNER_ID = "owner-1";
const VAULT_ID = "vault-1";

function setup() {
  const { prisma, folders, forceNextUniqueViolation } = createFakePrisma([
    { id: VAULT_ID, ownerId: OWNER_ID, name: "My Vault" }
  ]);
  const folderService = new FolderService(prisma);
  return { prisma, folders, folderService, forceNextUniqueViolation };
}

describe("FolderService.createFolder — P2002 race handling", () => {
  it("creates a legacy folder normally when there is no conflict", async () => {
    const { folderService } = setup();

    const folder = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "Photos"
    });

    expect(folder.name).toBe("Photos");
  });

  it("returns a clean 409 via the findFirst pre-check when the name already exists", async () => {
    const { folderService } = setup();
    await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "Photos"
    });

    await expect(
      folderService.createFolder(OWNER_ID, {
        vaultId: VAULT_ID,
        parentId: null,
        name: "Photos"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });

  it("translates a P2002 race on create to a 409 conflict (race path, not the pre-check)", async () => {
    const { folderService, forceNextUniqueViolation } = setup();

    // No colliding row exists, so the findFirst pre-check passes — the
    // conflict is only surfaced because the DB create itself is forced to
    // throw P2002, simulating a concurrent create that landed first.
    forceNextUniqueViolation("folder.create");

    await expect(
      folderService.createFolder(OWNER_ID, {
        vaultId: VAULT_ID,
        parentId: null,
        name: "Photos"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });
});

describe("FolderService.updateFolder — P2002 race handling", () => {
  it("renames a legacy folder normally when there is no conflict", async () => {
    const { folderService } = setup();
    const folder = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "Photos"
    });

    const renamed = await folderService.updateFolder(folder.id, OWNER_ID, {
      name: "Vacation Photos"
    });

    expect(renamed.name).toBe("Vacation Photos");
  });

  it("translates a P2002 race on rename to a 409 conflict — updateFolder has no findFirst pre-check of its own, so this is the only thing that turns the collision into a clean 409 instead of an unhandled error", async () => {
    const { folderService, forceNextUniqueViolation } = setup();
    await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "Photos"
    });
    const other = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "Documents"
    });

    forceNextUniqueViolation("folder.update");

    await expect(
      folderService.updateFolder(other.id, OWNER_ID, { name: "Photos" })
    ).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });
});
