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

describe("FolderService.updateFolder — cycle prevention", () => {
  it("rejects moving a folder under itself", async () => {
    const { folderService } = setup();
    const a = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "A"
    });

    await expect(
      folderService.updateFolder(a.id, OWNER_ID, { parentId: a.id })
    ).rejects.toMatchObject({ statusCode: 400, code: "BAD_REQUEST" });
  });

  it("rejects moving a folder under its direct child (A contains B; move A under B)", async () => {
    const { folderService, folders } = setup();
    const a = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "A"
    });
    const b = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: a.id,
      name: "B"
    });

    const snapshotBefore = JSON.parse(JSON.stringify(folders));

    await expect(
      folderService.updateFolder(a.id, OWNER_ID, { parentId: b.id })
    ).rejects.toMatchObject({ statusCode: 400, code: "BAD_REQUEST" });

    // Database state remains unchanged — the rejection happens before any
    // write, not as a rollback after one.
    expect(JSON.parse(JSON.stringify(folders))).toEqual(snapshotBefore);
  });

  it("rejects moving a folder under a deeper descendant (A > B > C; move A under C)", async () => {
    const { folderService, folders } = setup();
    const a = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "A"
    });
    const b = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: a.id,
      name: "B"
    });
    const c = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: b.id,
      name: "C"
    });

    const snapshotBefore = JSON.parse(JSON.stringify(folders));

    await expect(
      folderService.updateFolder(a.id, OWNER_ID, { parentId: c.id })
    ).rejects.toMatchObject({ statusCode: 400, code: "BAD_REQUEST" });

    expect(JSON.parse(JSON.stringify(folders))).toEqual(snapshotBefore);
  });

  it("still allows moving a folder to an unrelated existing folder in the same vault", async () => {
    const { folderService } = setup();
    const a = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "A"
    });
    const shelf = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "Shelf"
    });

    const moved = await folderService.updateFolder(a.id, OWNER_ID, {
      parentId: shelf.id
    });

    expect(moved.parentId).toBe(shelf.id);
  });

  it("does not hang or overflow the stack when searchContents traverses an already-cyclic chain (defense-in-depth)", async () => {
    // Simulates malformed/legacy data that predates the cycle check —
    // written directly to the fake store rather than through
    // updateFolder, which now refuses to create this state itself.
    const { folderService, folders } = setup();
    const a = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: null,
      name: "A"
    });
    const b = await folderService.createFolder(OWNER_ID, {
      vaultId: VAULT_ID,
      parentId: a.id,
      name: "B"
    });
    const aRow = folders.find((f) => f.id === a.id)!;
    aRow.parentId = b.id; // hand-crafted cycle: A -> B -> A

    const results = await folderService.searchContents(VAULT_ID, OWNER_ID, null, a.id);

    // Terminates (this line is reached at all) instead of stack-overflowing;
    // the exact contents don't matter as much as returning at all.
    expect(results).toBeDefined();
  });
});
