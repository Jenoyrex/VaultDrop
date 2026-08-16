/**
 * Client-side search for an encrypted vault. The server cannot match a
 * query string against name ciphertext (see `FolderService.searchContents`
 * on the server, and `folderApi.search`'s `query: null` mode), so an
 * encrypted vault's client instead fetches the full, unfiltered,
 * subtree-scoped candidate set once per folder navigation, decrypts every
 * name in it with the unlocked vault DEK, and filters that decrypted
 * index locally on every keystroke with no further network round-trips.
 *
 * The decrypted names built here exist only as plain JS values in
 * whatever component state holds the returned index, for as long as that
 * state lives (cleared on folder navigation / component unmount). Nothing
 * in this module writes them to localStorage, sessionStorage, IndexedDB,
 * or any server-side cache — they are never persisted or sent anywhere.
 */
import type {
  FileSearchResult,
  FolderSearchResult,
  PathSegment,
  SearchResponse
} from "@/lib/api-client";
import { resolveDisplayName } from "@/lib/names/resolve-name";

export interface DecryptedFolderResult extends FolderSearchResult {
  displayName: string;
  pathLabels: string[];
}

export interface DecryptedFileResult extends FileSearchResult {
  displayName: string;
  pathLabels: string[];
}

export interface DecryptedSearchIndex {
  folders: DecryptedFolderResult[];
  files: DecryptedFileResult[];
}

async function resolvePathLabels(
  path: PathSegment[],
  vaultDek: CryptoKey | undefined
): Promise<string[]> {
  return Promise.all(
    path.map((segment) => resolveDisplayName(segment, vaultDek))
  );
}

/**
 * Decrypts every name in a raw (possibly unfiltered) `SearchResponse`.
 * Throws (via `resolveDisplayName`'s `NameDecryptionError`) if the vault
 * is locked or any entry fails to decrypt — callers should only invoke
 * this once the vault is confirmed unlocked.
 */
export async function buildDecryptedSearchIndex(
  response: SearchResponse,
  vaultDek: CryptoKey | undefined
): Promise<DecryptedSearchIndex> {
  const folders = await Promise.all(
    response.folders.map(async (folder) => ({
      ...folder,
      displayName: await resolveDisplayName(folder, vaultDek),
      pathLabels: await resolvePathLabels(folder.path, vaultDek)
    }))
  );

  const files = await Promise.all(
    response.files.map(async (file) => ({
      ...file,
      displayName: await resolveDisplayName(file, vaultDek),
      pathLabels: await resolvePathLabels(file.path, vaultDek)
    }))
  );

  return { folders, files };
}

/**
 * Case-insensitive substring filter over an already-decrypted index. Pure
 * and synchronous — no network calls, no re-derivation of subtree scope,
 * since the index passed in is assumed to already be scoped (by the
 * server's unfiltered subtree fetch) to the folder the user is searching.
 */
export function filterDecryptedSearchIndex(
  index: DecryptedSearchIndex,
  query: string
): DecryptedSearchIndex {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return { folders: [], files: [] };
  }

  return {
    folders: index.folders.filter((folder) =>
      folder.displayName.toLowerCase().includes(normalized)
    ),
    files: index.files.filter((file) =>
      file.displayName.toLowerCase().includes(normalized)
    )
  };
}
