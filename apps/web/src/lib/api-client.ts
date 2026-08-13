import { loadWebEnv } from "@vaultdrop/config";
import type {
  AuthResponse,
  UserDTO,
  VaultDTO,
  VaultEncryptionEnvelope
} from "@vaultdrop/types";
import { prepareEncryptedUpload } from "@/lib/upload/encrypt-upload";

/**
 * `RequestInit["duplex"]` isn't in the TypeScript DOM lib bundled with our
 * TS version yet, though it's supported at runtime in current browsers —
 * required to stream a `ReadableStream` request body (see
 * `fileApi.uploadEncrypted`) without buffering it first.
 */
type RequestInitWithDuplex = RequestInit & { duplex?: "half" };

const env = loadWebEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL
});

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class UnsupportedBrowserError extends Error {
  constructor() {
    super(
      "This browser doesn't support streaming file uploads, which encrypted vaults require."
    );
    this.name = "UnsupportedBrowserError";
  }
}

let cachedStreamingBodySupport: boolean | null = null;

/**
 * Feature-detects whether `fetch` can stream a `ReadableStream` request
 * body (the standard `duplex`-getter probe). Encrypted uploads rely on
 * this to send ciphertext chunk-by-chunk without ever buffering the whole
 * encrypted file in memory first; there is no buffered fallback this
 * checkpoint, so an unsupported browser gets a clear error instead.
 */
function supportsStreamingRequestBody(): boolean {
  if (cachedStreamingBodySupport !== null) {
    return cachedStreamingBodySupport;
  }

  if (typeof Request === "undefined" || typeof ReadableStream === "undefined") {
    cachedStreamingBodySupport = false;
    return false;
  }

  let duplexAccessed = false;

  try {
    const hasContentType = new Request("https://example.com", {
      method: "POST",
      body: new ReadableStream(),
      get duplex() {
        duplexAccessed = true;
        return "half";
      }
    } as RequestInitWithDuplex).headers.has("Content-Type");

    cachedStreamingBodySupport = duplexAccessed && !hasContentType;
  } catch {
    cachedStreamingBodySupport = false;
  }

  return cachedStreamingBodySupport;
}

async function request<T>(
  path: string,
  init?: RequestInit & { token?: string | null }
): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }

  if (
    init?.body &&
    !(init.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => null)) as
    | T
    | ApiErrorBody
    | null;

  if (!response.ok) {
    const body = data as ApiErrorBody | null;

    throw new ApiError(
      response.status,
      body?.error?.code ?? "UNKNOWN_ERROR",
      body?.error?.message ?? "Something went wrong."
    );
  }

  return data as T;
}

export interface CheckUsernameResponse {
  exists: boolean;
}

export interface FileDTO {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  vaultId: string;
  folderId: string | null;
  storageProvider: string;
  storageKey: string;
  createdAt: string;
  updatedAt: string;
  encrypted: boolean;
  wrappedKeyCiphertext: string | null;
  wrappedKeyIv: string | null;
}

export interface FolderDTO {
  id: string;
  name: string;
  vaultId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderContentsResponse {
  folder: FolderDTO | null;
  subfolders: FolderDTO[];
  files: FileDTO[];
}

export interface PathSegment {
  id: string;
  name: string;
}

export interface FolderSearchResult extends FolderDTO {
  path: PathSegment[];
}

export interface FileSearchResult extends FileDTO {
  path: PathSegment[];
}

export interface SearchResponse {
  folders: FolderSearchResult[];
  files: FileSearchResult[];
}

export const authApi = {
  checkUsername(username: string): Promise<CheckUsernameResponse> {
    return request<CheckUsernameResponse>(
      `/auth/check-username?username=${encodeURIComponent(username)}`
    );
  },

  register(username: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },

  login(username: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },

  logout(token: string): Promise<void> {
    return request<void>("/auth/logout", {
      method: "POST",
      token
    });
  },

  me(token: string): Promise<{ user: UserDTO }> {
    return request<{ user: UserDTO }>("/auth/me", {
      token
    });
  }
};

export const vaultApi = {
  list(token: string): Promise<{ vaults: VaultDTO[] }> {
    return request<{ vaults: VaultDTO[] }>("/vaults", {
      token
    });
  },

  /**
   * Fetches a single vault, including the zero-knowledge encryption
   * metadata (KDF params + KEK-wrapped DEK) needed to unlock it — null
   * on every encryption field for a legacy, unencrypted vault. The
   * server scopes this to the authenticated owner; there is no public
   * vault-lookup path.
   */
  get(vaultId: string, token: string): Promise<{ vault: VaultDTO }> {
    return request<{ vault: VaultDTO }>(`/vaults/${vaultId}`, {
      token
    });
  },

  /**
   * `encryption`, when supplied, is the client-generated zero-knowledge
   * envelope (wrapped DEK + KDF params) for a new encrypted vault — see
   * `lib/crypto/vault-keys.ts`. Omit it to create a legacy plaintext
   * vault, unchanged from before this checkpoint.
   */
  create(
    name: string,
    token: string,
    encryption?: VaultEncryptionEnvelope
  ): Promise<{ vault: VaultDTO }> {
    return request<{ vault: VaultDTO }>("/vaults", {
      method: "POST",
      token,
      body: JSON.stringify({ name, encryption })
    });
  },

  delete(vaultId: string, token: string): Promise<void> {
    return request<void>(`/vaults/${vaultId}`, {
      method: "DELETE",
      token
    });
  }
};

export const folderApi = {
  list(
    vaultId: string,
    token: string
  ): Promise<{ folders: FolderDTO[] }> {
    return request<{ folders: FolderDTO[] }>(
      `/folders?vaultId=${vaultId}`,
      {
        token
      }
    );
  },

  /**
   * Wraps GET /folders/contents — returns the current folder (or null for
   * vault root), its direct subfolders, and the files that live directly
   * inside it. This is the single source of truth for the folder explorer.
   */
  contents(
    vaultId: string,
    folderId: string | null,
    token: string
  ): Promise<FolderContentsResponse> {
    const params = new URLSearchParams({ vaultId });

    if (folderId) {
      params.set("folderId", folderId);
    }

    return request<FolderContentsResponse>(
      `/folders/contents?${params.toString()}`,
      {
        token
      }
    );
  },

  create(
    vaultId: string,
    name: string,
    token: string,
    parentId?: string | null
  ): Promise<{ folder: FolderDTO }> {
    return request<{ folder: FolderDTO }>(
      "/folders",
      {
        method: "POST",
        token,
        body: JSON.stringify({
          vaultId,
          name,
          parentId
        })
      }
    );
  },

  rename(
    folderId: string,
    name: string,
    token: string
  ): Promise<{ folder: FolderDTO }> {
    return request<{ folder: FolderDTO }>(
      `/folders/${folderId}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ name })
      }
    );
  },

  /**
   * Recursive search. At vault root (folderId null) searches the whole
   * vault; inside a folder, searches only that folder's descendants.
   * Each result carries `path` — the ancestor chain — so the UI can
   * show where a match lives when it isn't in the currently open folder.
   */
  search(
    vaultId: string,
    query: string,
    folderId: string | null,
    token: string
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({ vaultId, query });

    if (folderId) {
      params.set("folderId", folderId);
    }

    return request<SearchResponse>(
      `/folders/search?${params.toString()}`,
      {
        token
      }
    );
  }
};

export const fileApi = {
  async upload(
    vaultId: string,
    file: File,
    token: string,
    folderId?: string | null
  ) {
    const formData = new FormData();
    formData.append("file", file);

    const params = new URLSearchParams({ vaultId });

    if (folderId) {
      params.set("folderId", folderId);
    }

    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/files/upload?${params.toString()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: formData
      }
    );

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    return response.json();
  },

  /**
   * Encrypts `file` client-side (fresh per-file key, wrapped by
   * `vaultDek`) and streams the ciphertext to `POST
   * /files/upload-encrypted` as the raw request body — never as multipart
   * form data, and never buffered whole in memory first. `vaultDek` must
   * already be unwrapped (see `useVaultKeys().getVaultKey`); this
   * function never derives or unwraps it itself.
   */
  async uploadEncrypted(
    vaultId: string,
    file: File,
    vaultDek: CryptoKey,
    token: string,
    folderId?: string | null
  ): Promise<{ file: FileDTO }> {
    if (!supportsStreamingRequestBody()) {
      throw new UnsupportedBrowserError();
    }

    const { ciphertextStream, envelope } = await prepareEncryptedUpload(
      file,
      vaultDek
    );

    const params = new URLSearchParams({
      vaultId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      encryptionVersion: String(envelope.encryptionVersion),
      wrappedKeyCiphertext: envelope.wrappedKeyCiphertext,
      wrappedKeyIv: envelope.wrappedKeyIv
    });

    if (folderId) {
      params.set("folderId", folderId);
    }

    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/files/upload-encrypted?${params.toString()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream"
        },
        body: ciphertextStream,
        duplex: "half"
      } as RequestInitWithDuplex
    );

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    return response.json();
  },

  list(
    vaultId: string,
    token: string
  ): Promise<{ files: FileDTO[] }> {
    return request<{ files: FileDTO[] }>(
      `/files?vaultId=${vaultId}`,
      {
        token
      }
    );
  },

  download(fileId: string, token: string) {
    return fetch(
      `${env.NEXT_PUBLIC_API_URL}/files/${fileId}/download`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
  },

  preview(fileId: string, token: string) {
    return fetch(
      `${env.NEXT_PUBLIC_API_URL}/files/${fileId}/preview`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
  },

  delete(
    fileId: string,
    token: string
  ): Promise<void> {
    return request<void>(
      `/files/${fileId}`,
      {
        method: "DELETE",
        token
      }
    );
  },

  rename(
    fileId: string,
    name: string,
    token: string
  ): Promise<{ file: FileDTO }> {
    return request<{ file: FileDTO }>(
      `/files/${fileId}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({ name })
      }
    );
  }
};