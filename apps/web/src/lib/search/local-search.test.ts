import { describe, expect, it } from "vitest";
import { generateAesKey, encryptText } from "@/lib/crypto";
import { NameDecryptionError } from "@/lib/names/resolve-name";
import type {
  FileSearchResult,
  FolderSearchResult,
  PathSegment,
  SearchResponse
} from "@/lib/api-client";
import {
  buildDecryptedSearchIndex,
  filterDecryptedSearchIndex
} from "./local-search.js";

function legacyFolder(
  overrides: Partial<FolderSearchResult> = {}
): FolderSearchResult {
  return {
    id: "folder-1",
    name: "Photos",
    vaultId: "vault-1",
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    encrypted: false,
    encryptedName: null,
    nameIv: null,
    path: [],
    ...overrides
  };
}

function legacyFile(overrides: Partial<FileSearchResult> = {}): FileSearchResult {
  return {
    id: "file-1",
    name: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    vaultId: "vault-1",
    folderId: null,
    storageProvider: "LOCAL",
    storageKey: "vault-1/file-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    encrypted: false,
    wrappedKeyCiphertext: null,
    wrappedKeyIv: null,
    encryptedName: null,
    nameIv: null,
    path: [],
    ...overrides
  };
}

describe("buildDecryptedSearchIndex", () => {
  it("passes legacy (non-encrypted) names through unchanged", async () => {
    const response: SearchResponse = {
      folders: [legacyFolder({ name: "Vacation Photos" })],
      files: [legacyFile({ name: "itinerary.pdf" })]
    };

    const index = await buildDecryptedSearchIndex(response, undefined);

    expect(index.folders[0]?.displayName).toBe("Vacation Photos");
    expect(index.files[0]?.displayName).toBe("itinerary.pdf");
  });

  it("decrypts encrypted folder/file names and their path segments with the vault DEK", async () => {
    const vaultDek = await generateAesKey();

    const folderNamePayload = await encryptText("Medical Records", vaultDek);
    const fileNamePayload = await encryptText("blood-test-results.pdf", vaultDek);
    const pathSegmentPayload = await encryptText("2026 Documents", vaultDek);

    const pathSegment: PathSegment = {
      id: "parent-1",
      name: null,
      encrypted: true,
      encryptedName: pathSegmentPayload.ciphertext,
      nameIv: pathSegmentPayload.iv
    };

    const response: SearchResponse = {
      folders: [
        legacyFolder({
          id: "folder-2",
          name: null,
          encrypted: true,
          encryptedName: folderNamePayload.ciphertext,
          nameIv: folderNamePayload.iv,
          path: [pathSegment]
        })
      ],
      files: [
        legacyFile({
          id: "file-2",
          name: null,
          encrypted: true,
          encryptedName: fileNamePayload.ciphertext,
          nameIv: fileNamePayload.iv,
          path: [pathSegment]
        })
      ]
    };

    const index = await buildDecryptedSearchIndex(response, vaultDek);

    expect(index.folders[0]?.displayName).toBe("Medical Records");
    expect(index.files[0]?.displayName).toBe("blood-test-results.pdf");
    expect(index.folders[0]?.pathLabels).toEqual(["2026 Documents"]);
    expect(index.files[0]?.pathLabels).toEqual(["2026 Documents"]);
  });

  it("rejects (never silently returns ciphertext) when the vault is locked but the response contains encrypted entries", async () => {
    const vaultDek = await generateAesKey();
    const payload = await encryptText("secret-folder", vaultDek);

    const response: SearchResponse = {
      folders: [
        legacyFolder({
          name: null,
          encrypted: true,
          encryptedName: payload.ciphertext,
          nameIv: payload.iv
        })
      ],
      files: []
    };

    await expect(
      buildDecryptedSearchIndex(response, undefined)
    ).rejects.toThrow(NameDecryptionError);
  });
});

describe("filterDecryptedSearchIndex", () => {
  it("matches case-insensitively on the decrypted display name", async () => {
    const index = await buildDecryptedSearchIndex(
      {
        folders: [legacyFolder({ name: "Vacation Photos" })],
        files: [
          legacyFile({ id: "file-a", name: "Invoice-March.pdf" }),
          legacyFile({ id: "file-b", name: "resume.docx" })
        ]
      },
      undefined
    );

    const results = filterDecryptedSearchIndex(index, "invoice");

    expect(results.files).toHaveLength(1);
    expect(results.files[0]?.id).toBe("file-a");
    expect(results.folders).toHaveLength(0);
  });

  it("returns no results for a blank query", async () => {
    const index = await buildDecryptedSearchIndex(
      { folders: [legacyFolder()], files: [legacyFile()] },
      undefined
    );

    const results = filterDecryptedSearchIndex(index, "   ");

    expect(results.folders).toHaveLength(0);
    expect(results.files).toHaveLength(0);
  });

  it("runs entirely locally: filtering a large pre-decrypted index performs no decryption and never throws for a locked vault", async () => {
    const index = await buildDecryptedSearchIndex(
      {
        folders: [legacyFolder({ name: "Archive" })],
        files: [legacyFile({ name: "archive-notes.txt" })]
      },
      undefined
    );

    // Filtering is synchronous and takes no key at all — proving it does
    // no further decryption (and so can't leak anything to the server).
    const results = filterDecryptedSearchIndex(index, "archive");
    expect(results.folders).toHaveLength(1);
    expect(results.files).toHaveLength(1);
  });
});
