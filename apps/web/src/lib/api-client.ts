import { loadWebEnv } from "@vaultdrop/config";
import type {
  AuthResponse,
  UserDTO,
  VaultDTO
} from "@vaultdrop/types";

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

export type ShareExpiryOption = "never" | "24h" | "7d" | "30d";

export interface ShareDTO {
  id: string;
  token: string;
  fileId: string;
  expiresAt: string | null;
  hasPassword: boolean;
  createdAt: string;
}

export interface ShareMetadata {
  requiresPassword: boolean;
  expiresAt: string | null;
  file: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  } | null;
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

  create(name: string, token: string): Promise<{ vault: VaultDTO }> {
    return request<{ vault: VaultDTO }>("/vaults", {
      method: "POST",
      token,
      body: JSON.stringify({ name })
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

export const shareApi = {
  create(
    fileId: string,
    options: { expiresIn: ShareExpiryOption; password?: string },
    token: string
  ): Promise<{ share: ShareDTO }> {
    return request<{ share: ShareDTO }>(
      "/shares",
      {
        method: "POST",
        token,
        body: JSON.stringify({
          fileId,
          expiresIn: options.expiresIn,
          password: options.password || undefined
        })
      }
    );
  },

  getMetadata(
    shareToken: string,
    password?: string
  ): Promise<ShareMetadata> {
    const params = new URLSearchParams();

    if (password) {
      params.set("password", password);
    }

    const qs = params.toString();

    return request<ShareMetadata>(
      `/shares/${shareToken}${qs ? `?${qs}` : ""}`
    );
  },

  downloadUrl(shareToken: string, password?: string): string {
    const params = new URLSearchParams();

    if (password) {
      params.set("password", password);
    }

    const qs = params.toString();

    return `${env.NEXT_PUBLIC_API_URL}/shares/${shareToken}/download${qs ? `?${qs}` : ""}`;
  },

  previewUrl(shareToken: string, password?: string): string {
    const params = new URLSearchParams();

    if (password) {
      params.set("password", password);
    }

    const qs = params.toString();

    return `${env.NEXT_PUBLIC_API_URL}/shares/${shareToken}/preview${qs ? `?${qs}` : ""}`;
  }
};