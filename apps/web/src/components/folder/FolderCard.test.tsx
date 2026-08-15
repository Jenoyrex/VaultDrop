// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FolderDTO } from "@vaultdrop/types";

const {
  folderApiRename,
  encryptTextMock,
  useDisplayNameMock,
  getVaultKeyMock
} = vi.hoisted(() => ({
  folderApiRename: vi.fn(),
  encryptTextMock: vi.fn(),
  useDisplayNameMock: vi.fn(),
  getVaultKeyMock: vi.fn()
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    folderApi: { ...actual.folderApi, rename: folderApiRename }
  };
});

vi.mock("@/lib/crypto", () => ({
  encryptText: encryptTextMock
}));

vi.mock("@/hooks/useDisplayName", () => ({
  useDisplayName: useDisplayNameMock
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ accessToken: "access-token-abc" })
}));

vi.mock("@/components/providers/vault-key-provider", () => ({
  useVaultKeys: () => ({ getVaultKey: getVaultKeyMock })
}));

// `vi.mock` is hoisted above these imports by vitest's transform.
import FolderCard from "./FolderCard";

const FAKE_DEK = { __brand: "fake-dek" } as unknown as CryptoKey;

function makeFolder(overrides: Partial<FolderDTO> = {}): FolderDTO {
  return {
    id: "folder-1",
    name: "Vacation Photos",
    vaultId: "vault-1",
    parentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    encrypted: false,
    encryptedName: null,
    nameIv: null,
    ...overrides
  };
}

// FolderCard renders two buttons: [0] opens the folder (accessible name =
// the folder's display name), [1] is the icon-only rename trigger.
async function openRenameDialog(user: ReturnType<typeof userEvent.setup>) {
  const buttons = screen.getAllByRole("button");
  await user.click(buttons[1]!);
}

describe("FolderCard rename", () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getVaultKeyMock.mockReturnValue(FAKE_DEK);
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    alertSpy.mockRestore();
  });

  it("normal plaintext/legacy rename still works", async () => {
    useDisplayNameMock.mockReturnValue({ displayName: "Vacation Photos", error: null });
    folderApiRename.mockResolvedValue({ folder: makeFolder({ name: "Beach Trip" }) });

    const folder = makeFolder({ encrypted: false });
    const onRenamed = vi.fn();
    const user = userEvent.setup();

    render(<FolderCard folder={folder} onClick={vi.fn()} onRenamed={onRenamed} />);

    await openRenameDialog(user);
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Beach Trip");
    await user.click(screen.getByRole("button", { name: /^rename$/i }));

    expect(folderApiRename).toHaveBeenCalledWith(
      "folder-1",
      { name: "Beach Trip" },
      "access-token-abc"
    );
    expect(onRenamed).toHaveBeenCalledTimes(1);
  });

  it("normal encrypted rename still works", async () => {
    useDisplayNameMock.mockReturnValue({ displayName: "Vacation Photos", error: null });
    encryptTextMock.mockResolvedValue({ ciphertext: "new-ciphertext", iv: "new-iv" });
    folderApiRename.mockResolvedValue({
      folder: makeFolder({ encrypted: true, name: null, encryptedName: "new-ciphertext", nameIv: "new-iv" })
    });

    const folder = makeFolder({
      encrypted: true,
      name: null,
      encryptedName: "old-ciphertext",
      nameIv: "old-iv"
    });
    const onRenamed = vi.fn();
    const user = userEvent.setup();

    render(<FolderCard folder={folder} onClick={vi.fn()} onRenamed={onRenamed} />);

    await openRenameDialog(user);
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Beach Trip");
    await user.click(screen.getByRole("button", { name: /^rename$/i }));

    expect(encryptTextMock).toHaveBeenCalledWith("Beach Trip", FAKE_DEK);
    expect(folderApiRename).toHaveBeenCalledWith(
      "folder-1",
      { encryptedName: "new-ciphertext", nameIv: "new-iv" },
      "access-token-abc"
    );
    expect(onRenamed).toHaveBeenCalledTimes(1);
  });

  it("cannot silently overwrite a name that failed to resolve/decrypt", async () => {
    useDisplayNameMock.mockReturnValue({
      displayName: null,
      error: "Failed to decrypt name: wrong vault key or corrupted data"
    });

    const folder = makeFolder({
      encrypted: true,
      name: null,
      encryptedName: "old-ciphertext",
      nameIv: "old-iv"
    });
    const onRenamed = vi.fn();
    const user = userEvent.setup();

    render(<FolderCard folder={folder} onClick={vi.fn()} onRenamed={onRenamed} />);

    await openRenameDialog(user);
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Something Else");
    await user.click(screen.getByRole("button", { name: /^rename$/i }));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(encryptTextMock).not.toHaveBeenCalled();
    expect(folderApiRename).not.toHaveBeenCalled();
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
