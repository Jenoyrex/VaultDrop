"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDropzone } from "react-dropzone";
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  Upload,
  Loader2,
  FolderPlus,
  Vault as VaultIcon,
  Search,
  X
} from "lucide-react";

import { useAuth } from "@/components/providers/auth-provider";
import {
  fileApi,
  folderApi,
  type FileDTO,
  type FolderDTO,
  type SearchResponse
} from "@/lib/api-client";

import FileCard from "@/components/file/FileCard";
import FolderCard from "@/components/folder/FolderCard";
import FolderGrid from "@/components/folder/FolderGrid";
import CreateFolderDialog from "@/components/folder/CreateFolderDialog";

interface BreadcrumbEntry {
  id: string | null;
  name: string;
}

const VAULT_ROOT_CRUMB: BreadcrumbEntry = { id: null, name: "Vault" };

export default function VaultPage() {
  const params = useParams();
  const { accessToken } = useAuth();

  const vaultId = params.vaultId as string;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([
    VAULT_ROOT_CRUMB
  ]);

  const [subfolders, setSubfolders] = useState<FolderDTO[]>([]);
  const [files, setFiles] = useState<FileDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [showFolderDialog, setShowFolderDialog] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(
    null
  );
  const [searching, setSearching] = useState(false);
  const searchRequestIdRef = useRef(0);

  const currentFolderId =
    breadcrumbs[breadcrumbs.length - 1]?.id ?? null;

  const loadContents = useCallback(
    async (folderId: string | null) => {
      if (!accessToken) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const response = await folderApi.contents(
          vaultId,
          folderId,
          accessToken
        );

        setSubfolders(response.subfolders);
        setFiles(response.files);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [accessToken, vaultId]
  );

  // Reset to vault root whenever the vault itself changes (e.g. navigating
  // here from a different vault), then load its contents.
  useEffect(() => {
    setBreadcrumbs([VAULT_ROOT_CRUMB]);
  }, [vaultId]);

  useEffect(() => {
    loadContents(currentFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadContents, currentFolderId]);

  const runSearch = useCallback(async () => {
    const trimmed = searchQuery.trim();

    if (!trimmed || !accessToken) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    const requestId = ++searchRequestIdRef.current;

    try {
      setSearching(true);

      const results = await folderApi.search(
        vaultId,
        trimmed,
        currentFolderId,
        accessToken
      );

      if (requestId === searchRequestIdRef.current) {
        setSearchResults(results);
      }
    } catch (err) {
      console.error(err);

      if (requestId === searchRequestIdRef.current) {
        setSearchResults({ folders: [], files: [] });
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setSearching(false);
      }
    }
  }, [searchQuery, accessToken, vaultId, currentFolderId]);

  // Recursive search — scoped to whichever folder is currently open (or
  // the whole vault at root) — filters as the user types, debounced so
  // it doesn't re-query the backend on every keystroke.
  useEffect(() => {
    const trimmed = searchQuery.trim();

    if (!trimmed) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    const timeout = setTimeout(() => {
      runSearch();
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchQuery, currentFolderId, runSearch]);

  function openFolder(folder: FolderDTO) {
    setBreadcrumbs((prev) => [
      ...prev,
      { id: folder.id, name: folder.name }
    ]);
  }

  function goToBreadcrumb(index: number) {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  }

  const uploadFiles = useCallback(
    async (filesToUpload: File[]) => {
      if (!accessToken || filesToUpload.length === 0) return;

      try {
        setUploading(true);

        await Promise.all(
          filesToUpload.map((file) =>
            fileApi.upload(
              vaultId,
              file,
              accessToken,
              currentFolderId
            )
          )
        );

        await loadContents(currentFolderId);
      } catch (err) {
        console.error(err);
        alert("Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [accessToken, vaultId, currentFolderId, loadContents]
  );

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const selected = event.target.files;

    if (!selected || selected.length === 0) return;

    await uploadFiles(Array.from(selected));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      uploadFiles(acceptedFiles);
    },
    [uploadFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true,
    multiple: true
  });

  async function createFolder(name: string) {
    if (!accessToken) return;

    await folderApi.create(
      vaultId,
      name,
      accessToken,
      currentFolderId ?? undefined
    );

    await loadContents(currentFolderId);
  }

  function formatPath(path: { id: string; name: string }[]): string {
    return ["Vault", ...path.map((segment) => segment.name)].join(" / ");
  }

  function openSearchResultFolder(
    folder: { id: string; name: string },
    path: { id: string; name: string }[]
  ) {
    setBreadcrumbs([
      VAULT_ROOT_CRUMB,
      ...path.map((segment) => ({
        id: segment.id,
        name: segment.name
      })),
      { id: folder.id, name: folder.name }
    ]);

    setSearchQuery("");
  }

  const isEmpty = subfolders.length === 0 && files.length === 0;

  const isSearching = searchQuery.trim().length > 0;
  const hasNoSearchResults =
    isSearching &&
    !searching &&
    searchResults !== null &&
    searchResults.folders.length === 0 &&
    searchResults.files.length === 0;

  return (
    <>
      <div className="space-y-8">

        <div className="flex items-center justify-between">

          <div className="flex items-center gap-4">

            <Link
              href="/dashboard"
              className="rounded-lg border p-2 hover:bg-accent"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>

            <div>
              <h1 className="text-3xl font-bold">
                Vault
              </h1>

              <p className="text-muted-foreground">
                Vault ID: {vaultId}
              </p>
            </div>

          </div>

          <div className="flex gap-3">

            <button
              onClick={() => setShowFolderDialog(true)}
              className="flex items-center gap-2 rounded-lg border px-5 py-3"
            >
              <FolderPlus className="h-5 w-5" />
              New Folder
            </button>

            <input
              hidden
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
            />

            <button
              disabled={uploading}
              onClick={() =>
                fileInputRef.current?.click()
              }
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-primary-foreground"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  Upload File
                </>
              )}
            </button>

          </div>

        </div>

        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;

            return (
              <div
                key={crumb.id ?? "root"}
                className="flex items-center gap-1"
              >
                {index > 0 && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}

                <button
                  onClick={() => goToBreadcrumb(index)}
                  disabled={isLast}
                  className={
                    isLast
                      ? "flex items-center gap-1 font-semibold text-foreground"
                      : "flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                  }
                >
                  {index === 0 && (
                    <VaultIcon className="h-4 w-4" />
                  )}
                  {crumb.name}
                </button>
              </div>
            );
          })}
        </nav>

        {!isEmpty && (
          <div className="relative max-w-md">

            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search this folder and its subfolders..."
              className="w-full rounded-lg border bg-background py-2.5 pl-9 pr-9 outline-none"
            />

            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            )}

          </div>
        )}

        <div
          {...getRootProps()}
          className="relative"
        >
          <input {...getInputProps()} />

          {isDragActive && (
            <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-primary/10 text-primary">
              <Upload className="h-10 w-10" />
              <p className="text-lg font-semibold">
                Drop files to upload
              </p>
            </div>
          )}

          {loading ? (

            <div className="flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin" />
            </div>

          ) : isSearching ? (

            searching ? (

              <div className="flex justify-center py-20">
                <Loader2 className="h-10 w-10 animate-spin" />
              </div>

            ) : hasNoSearchResults ? (

              <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed">

                <Search className="mb-5 h-16 w-16 text-primary" />

                <h2 className="text-2xl font-semibold">
                  No results found
                </h2>

                <p className="mt-2 text-muted-foreground">
                  Nothing matches &quot;{searchQuery}&quot; in this folder or its subfolders.
                </p>

              </div>

            ) : (

              <div className="space-y-8">

                {searchResults && searchResults.folders.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {searchResults.folders.map((folder) => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        onClick={() =>
                          openSearchResultFolder(folder, folder.path)
                        }
                        onRenamed={() => {
                          loadContents(currentFolderId);
                          runSearch();
                        }}
                        pathLabel={
                          folder.parentId !== currentFolderId
                            ? formatPath(folder.path)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}

                {searchResults && searchResults.files.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {searchResults.files.map((file) => (
                      <FileCard
                        key={file.id}
                        file={file}
                        onDeleted={() => {
                          loadContents(currentFolderId);
                          runSearch();
                        }}
                        onRenamed={() => {
                          loadContents(currentFolderId);
                          runSearch();
                        }}
                        pathLabel={
                          file.folderId !== currentFolderId
                            ? formatPath(file.path)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                )}

              </div>

            )

          ) : isEmpty ? (

            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed">

              <FolderOpen className="mb-5 h-16 w-16 text-primary" />

              <h2 className="text-2xl font-semibold">
                This folder is empty
              </h2>

              <p className="mt-2 text-muted-foreground">
                Create a folder or upload your first file.
              </p>

            </div>

          ) : (

            <div className="space-y-8">

              <FolderGrid
                folders={subfolders}
                onOpenFolder={openFolder}
                onRenamed={() => loadContents(currentFolderId)}
              />

              {files.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {files.map((file) => (
                    <FileCard
                      key={file.id}
                      file={file}
                      onDeleted={() => loadContents(currentFolderId)}
                      onRenamed={() => loadContents(currentFolderId)}
                    />
                  ))}
                </div>
              )}

            </div>

          )}

        </div>

      </div>

      <CreateFolderDialog
        open={showFolderDialog}
        onClose={() =>
          setShowFolderDialog(false)
        }
        onCreate={createFolder}
      />
    </>
  );
}