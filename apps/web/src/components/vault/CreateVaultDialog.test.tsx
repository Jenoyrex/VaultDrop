// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RecoveryEnvelopeResponse, VaultDTO, VaultEncryptionEnvelope } from "@vaultdrop/types";

/**
 * `vi.mock` factories run before this file's own top-level code, so every
 * mock function referenced inside one must be created via `vi.hoisted`.
 */
const {
  authApiLogin,
  vaultApiCreate,
  vaultApiEnrollRecoveryKey,
  createVaultEnvelopeMock,
  createRecoveryEnvelopeMock,
  setVaultKeyMock,
  useAuthMock
} = vi.hoisted(() => ({
  authApiLogin: vi.fn(),
  vaultApiCreate: vi.fn(),
  vaultApiEnrollRecoveryKey: vi.fn(),
  createVaultEnvelopeMock: vi.fn(),
  createRecoveryEnvelopeMock: vi.fn(),
  setVaultKeyMock: vi.fn(),
  useAuthMock: vi.fn()
}));

// Only `authApi.login`/`vaultApi.create`/`vaultApi.enrollRecoveryKey` are
// swapped out — everything else (including the real `ApiError` class, so
// `err instanceof ApiError` inside the component keeps working) comes
// through from the real module.
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, login: authApiLogin },
    vaultApi: {
      ...actual.vaultApi,
      create: vaultApiCreate,
      enrollRecoveryKey: vaultApiEnrollRecoveryKey
    }
  };
});

// The real crypto implementation is exercised by vault-keys.test.ts /
// vault-keys.recovery.test.ts already; these component tests only need to
// verify CreateVaultDialog's own orchestration (call order, retry/skip
// state, disabled inputs), so real WebCrypto is deliberately not invoked
// here.
vi.mock("@/lib/vault-keys", () => ({
  createVaultEnvelope: createVaultEnvelopeMock,
  createRecoveryEnvelope: createRecoveryEnvelopeMock
}));

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: useAuthMock
}));

vi.mock("@/components/providers/vault-key-provider", () => ({
  useVaultKeys: () => ({
    getVaultKey: vi.fn(),
    isUnlocked: vi.fn(),
    unlockVault: vi.fn(),
    setVaultKey: setVaultKeyMock,
    lockVault: vi.fn(),
    lockAll: vi.fn()
  })
}));

// `vi.mock` is hoisted above these imports by vitest's transform.
import CreateVaultDialog from "./CreateVaultDialog";
import { ApiError } from "@/lib/api-client";

const FAKE_USER = { id: "user-1", username: "alice", createdAt: new Date().toISOString() };
const FAKE_DEK = { __brand: "fake-dek" } as unknown as CryptoKey;

const FAKE_VAULT_ENVELOPE: VaultEncryptionEnvelope = {
  encryptionVersion: 1,
  kekSalt: "fake-kek-salt",
  kekIterations: 600_000,
  kekHash: "SHA-256",
  wrappedDekCiphertext: "fake-wrapped-dek-ciphertext",
  wrappedDekIv: "fake-wrapped-dek-iv"
};

const FAKE_RECOVERY_ENVELOPE: RecoveryEnvelopeResponse = {
  recoveryWrappedDekCiphertext: "fake-recovery-wrapped-dek-ciphertext",
  recoveryWrappedDekIv: "fake-recovery-wrapped-dek-iv"
};

const FAKE_RECOVERY_KEY = "VDR1-FAKE-FAKE-FAKE-FAKE";

const FAKE_VAULT: VaultDTO = {
  id: "vault-1",
  name: "Test Vault",
  ownerId: FAKE_USER.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  encryptionVersion: FAKE_VAULT_ENVELOPE.encryptionVersion,
  kekSalt: FAKE_VAULT_ENVELOPE.kekSalt,
  kekIterations: FAKE_VAULT_ENVELOPE.kekIterations,
  kekHash: FAKE_VAULT_ENVELOPE.kekHash,
  wrappedDekCiphertext: FAKE_VAULT_ENVELOPE.wrappedDekCiphertext,
  wrappedDekIv: FAKE_VAULT_ENVELOPE.wrappedDekIv,
  hasRecoveryKey: false
};

/** Resolves/rejects on demand — used to inspect UI state while an async call is still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(<CreateVaultDialog onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated };
}

async function typeNameAndPassword(
  user: ReturnType<typeof userEvent.setup>,
  { name = "My Vault", password = "correct-horse-battery-staple" } = {}
) {
  await user.type(screen.getByPlaceholderText("Personal Vault"), name);
  await user.type(screen.getByPlaceholderText("Account password"), password);
  return { name, password };
}

describe("CreateVaultDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAuthMock.mockReturnValue({
      status: "authenticated",
      user: FAKE_USER,
      accessToken: "access-token-abc",
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn()
    });

    authApiLogin.mockResolvedValue({ user: FAKE_USER, accessToken: "freshly-issued-token-xyz" });
    createVaultEnvelopeMock.mockResolvedValue({ dek: FAKE_DEK, envelope: FAKE_VAULT_ENVELOPE });
    vaultApiCreate.mockResolvedValue({ vault: FAKE_VAULT });
    createRecoveryEnvelopeMock.mockResolvedValue({
      recoveryKey: FAKE_RECOVERY_KEY,
      envelope: FAKE_RECOVERY_ENVELOPE
    });
    vaultApiEnrollRecoveryKey.mockResolvedValue({ vault: { ...FAKE_VAULT, hasRecoveryKey: true } });
  });

  afterEach(() => {
    cleanup();
  });

  it("verifies the password via authApi.login before ever calling vaultApi.create", async () => {
    const user = userEvent.setup();
    renderDialog();

    await typeNameAndPassword(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(vaultApiCreate).toHaveBeenCalled());

    expect(authApiLogin).toHaveBeenCalledTimes(1);
    expect(authApiLogin.mock.invocationCallOrder[0]!).toBeLessThan(
      vaultApiCreate.mock.invocationCallOrder[0]!
    );
  });

  it('wrong password shows "Incorrect password." and never creates a vault or performs vault crypto', async () => {
    authApiLogin.mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Invalid username or password"));

    const user = userEvent.setup();
    renderDialog();

    await typeNameAndPassword(user, { password: "totally-wrong" });
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText("Incorrect password.")).toBeDefined();
    expect(vaultApiCreate).not.toHaveBeenCalled();
    // No vault crypto should run either — verification failing must abort
    // before any key material is derived.
    expect(createVaultEnvelopeMock).not.toHaveBeenCalled();
  });

  it("correct password creates the vault using the exact same password value that was verified", async () => {
    const user = userEvent.setup();
    renderDialog();

    const { password } = await typeNameAndPassword(user, { password: "my-real-account-password" });
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(vaultApiCreate).toHaveBeenCalled());

    expect(authApiLogin).toHaveBeenCalledWith(FAKE_USER.username, password);
    expect(createVaultEnvelopeMock).toHaveBeenCalledWith(password);
  });

  it("creates a legacy-free, ciphertext-only vault: no plaintext recovery key, DEK, or KEK is ever sent to the server", async () => {
    const user = userEvent.setup();
    renderDialog();

    await typeNameAndPassword(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(vaultApiEnrollRecoveryKey).toHaveBeenCalled());

    // vaultApi.create only ever receives the opaque envelope produced by
    // (mocked) createVaultEnvelope — never the DEK object or the password.
    expect(vaultApiCreate).toHaveBeenCalledWith("My Vault", "access-token-abc", FAKE_VAULT_ENVELOPE);

    // vaultApi.enrollRecoveryKey only ever receives the opaque envelope —
    // never the human-readable recovery key string.
    expect(vaultApiEnrollRecoveryKey).toHaveBeenCalledWith(
      FAKE_VAULT.id,
      FAKE_RECOVERY_ENVELOPE,
      "access-token-abc"
    );
    const enrollArgs = vaultApiEnrollRecoveryKey.mock.calls[0]!;
    expect(JSON.stringify(enrollArgs)).not.toContain(FAKE_RECOVERY_KEY);
  });

  it("disables the name/password inputs and the submit button while the operation is loading", async () => {
    const loginGate = deferred<{ user: typeof FAKE_USER; accessToken: string }>();
    authApiLogin.mockReturnValue(loginGate.promise);

    const user = userEvent.setup();
    renderDialog();

    await typeNameAndPassword(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect((screen.getByPlaceholderText("Personal Vault") as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByPlaceholderText("Account password") as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: /creating/i }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: /cancel/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    loginGate.resolve({ user: FAKE_USER, accessToken: "freshly-issued-token-xyz" });

    await waitFor(() => expect(vaultApiCreate).toHaveBeenCalled());
  });

  it("does not issue duplicate vault-creation or recovery-enrollment requests when Create is clicked again while the first attempt is still in flight", async () => {
    // Held pending deliberately — the second click below happens while
    // this is still unresolved, so this genuinely exercises concurrent/
    // in-flight behavior rather than two separate, sequential, completed
    // operations.
    const loginGate = deferred<{ user: typeof FAKE_USER; accessToken: string }>();
    authApiLogin.mockReturnValue(loginGate.promise);

    const user = userEvent.setup();
    renderDialog();

    await typeNameAndPassword(user);

    await user.click(screen.getByRole("button", { name: /^create$/i }));

    const creatingButton = await screen.findByRole("button", { name: /creating/i });
    expect((creatingButton as HTMLButtonElement).disabled).toBe(true);

    // Second click while authApi.login is still pending — the disabled
    // button must make this a no-op, not a second concurrent handleCreate
    // run.
    await user.click(creatingButton);

    expect(authApiLogin).toHaveBeenCalledTimes(1);

    loginGate.resolve({ user: FAKE_USER, accessToken: "freshly-issued-token-xyz" });

    await waitFor(() => expect(vaultApiEnrollRecoveryKey).toHaveBeenCalled());

    expect(vaultApiCreate).toHaveBeenCalledTimes(1);
    expect(createRecoveryEnvelopeMock).toHaveBeenCalledTimes(1);
    expect(vaultApiEnrollRecoveryKey).toHaveBeenCalledTimes(1);
  });

  it("successful recovery enrollment on the first attempt completes normally", async () => {
    const user = userEvent.setup();
    const { onCreated, onClose } = renderDialog();

    await typeNameAndPassword(user);
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(FAKE_RECOVERY_KEY)).toBeDefined();
    expect(createRecoveryEnvelopeMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /done/i }));

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("when recovery-key enrollment fails", () => {
    beforeEach(() => {
      vaultApiEnrollRecoveryKey.mockRejectedValueOnce(new Error("network error"));
    });

    it("keeps the dialog open (does not close or report completion) and retains the generated recovery envelope", async () => {
      const user = userEvent.setup();
      const { onCreated, onClose } = renderDialog();

      await typeNameAndPassword(user);
      await user.click(screen.getByRole("button", { name: /^create$/i }));

      expect(await screen.findByText(/couldn.t set up a recovery key/i)).toBeDefined();
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(createRecoveryEnvelopeMock).toHaveBeenCalledTimes(1);
    });

    it("Retry resends the identical envelope and never regenerates the recovery key/envelope", async () => {
      vaultApiEnrollRecoveryKey.mockResolvedValueOnce({ vault: { ...FAKE_VAULT, hasRecoveryKey: true } });

      const user = userEvent.setup();
      renderDialog();

      await typeNameAndPassword(user);
      await user.click(screen.getByRole("button", { name: /^create$/i }));

      await screen.findByText(/couldn.t set up a recovery key/i);
      expect(vaultApiEnrollRecoveryKey).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: /^retry$/i }));

      await waitFor(() => expect(vaultApiEnrollRecoveryKey).toHaveBeenCalledTimes(2));

      // Recovery material generated exactly once across the failure AND
      // the retry — never regenerated.
      expect(createRecoveryEnvelopeMock).toHaveBeenCalledTimes(1);

      // Both enrollment attempts submitted the exact same envelope.
      const [firstCallArgs, secondCallArgs] = vaultApiEnrollRecoveryKey.mock.calls;
      expect(firstCallArgs![1]).toBe(FAKE_RECOVERY_ENVELOPE);
      expect(secondCallArgs![1]).toBe(FAKE_RECOVERY_ENVELOPE);

      // Retry succeeding transitions to the "recovery key saved" screen
      // with the same, unchanged key.
      expect(await screen.findByText(FAKE_RECOVERY_KEY)).toBeDefined();
    });

    it("disables Retry while a retry request is in flight, and a second click cannot issue a duplicate enrollment request", async () => {
      // The outer beforeEach already queued the initial failure via
      // mockRejectedValueOnce; this queues the retry's response as a
      // deliberately-unresolved gate, so the assertions below observe
      // genuine in-flight state, not an already-settled retry.
      const retryGate = deferred<{ vault: VaultDTO }>();
      vaultApiEnrollRecoveryKey.mockReturnValueOnce(retryGate.promise);

      const user = userEvent.setup();
      renderDialog();

      await typeNameAndPassword(user);
      await user.click(screen.getByRole("button", { name: /^create$/i }));

      await screen.findByText(/couldn.t set up a recovery key/i);
      expect(vaultApiEnrollRecoveryKey).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("button", { name: /^retry$/i }));

      const retryingButton = await screen.findByRole("button", { name: /retrying/i });
      expect((retryingButton as HTMLButtonElement).disabled).toBe(true);

      // Second click while the retry's own enrollRecoveryKey call is still
      // unresolved — must not issue a third request.
      await user.click(retryingButton);
      expect(vaultApiEnrollRecoveryKey).toHaveBeenCalledTimes(2);

      retryGate.resolve({ vault: { ...FAKE_VAULT, hasRecoveryKey: true } });

      expect(await screen.findByText(FAKE_RECOVERY_KEY)).toBeDefined();
      expect(createRecoveryEnvelopeMock).toHaveBeenCalledTimes(1);
    });

    it("Skip is disabled until the user explicitly acknowledges there is no recovery key", async () => {
      const user = userEvent.setup();
      const { onCreated, onClose } = renderDialog();

      await typeNameAndPassword(user);
      await user.click(screen.getByRole("button", { name: /^create$/i }));

      await screen.findByText(/couldn.t set up a recovery key/i);

      const skipButton = screen.getByRole("button", {
        name: /continue without a recovery key/i
      }) as HTMLButtonElement;
      expect(skipButton.disabled).toBe(true);

      await user.click(skipButton);
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      const acknowledgement = screen.getByRole("checkbox");
      await user.click(acknowledgement);
      expect(skipButton.disabled).toBe(false);

      await user.click(skipButton);
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("clearly communicates that the vault will continue without a recovery key", async () => {
      const user = userEvent.setup();
      renderDialog();

      await typeNameAndPassword(user);
      await user.click(screen.getByRole("button", { name: /^create$/i }));

      await screen.findByText(/couldn.t set up a recovery key/i);
      expect(
        screen.getByText(/no way for anyone, including us, to recover this vault/i)
      ).toBeDefined();
      expect(
        screen.getByText(/this vault has no recovery key, and i could lose access to it permanently/i)
      ).toBeDefined();
    });
  });
});
