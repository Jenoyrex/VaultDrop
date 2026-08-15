// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RenameDialog from "./RenameDialog";

afterEach(() => {
  cleanup();
});

describe("RenameDialog", () => {
  it("initializes the input with the current name when it opens", () => {
    render(
      <RenameDialog
        open
        title="Rename File"
        initialName="photo"
        extension=".jpg"
        onClose={vi.fn()}
        onRename={vi.fn()}
      />
    );

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("photo");
  });

  it("submitting an unchanged name (extension included) does not call onRename", async () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <RenameDialog
        open
        title="Rename File"
        initialName="photo"
        extension=".jpg"
        onClose={onClose}
        onRename={onRename}
      />
    );

    await user.click(screen.getByRole("button", { name: /^rename$/i }));

    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submitting a genuinely changed name calls onRename with the full name (extension included)", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <RenameDialog
        open
        title="Rename File"
        initialName="photo"
        extension=".jpg"
        onClose={onClose}
        onRename={onRename}
      />
    );

    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "vacation");
    await user.click(screen.getByRole("button", { name: /^rename$/i }));

    expect(onRename).toHaveBeenCalledWith("vacation.jpg");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submitting an unchanged name with no extension (e.g. a folder) does not call onRename", async () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <RenameDialog
        open
        title="Rename Folder"
        initialName="Vacation Photos"
        onClose={onClose}
        onRename={onRename}
      />
    );

    await user.click(screen.getByRole("button", { name: /^rename$/i }));

    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite an in-progress edit when initialName changes while the dialog stays open", async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <RenameDialog
        open
        title="Rename File"
        initialName="Loading…"
        onClose={vi.fn()}
        onRename={onRename}
      />
    );

    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "My typed name");

    // Simulates the parent's display name finishing async resolution
    // (e.g. decryption completing) while the dialog is still open —
    // `open` itself does not change here.
    rerender(
      <RenameDialog
        open
        title="Rename File"
        initialName="report.pdf"
        onClose={vi.fn()}
        onRename={onRename}
      />
    );

    expect((input as HTMLInputElement).value).toBe("My typed name");
  });

  it("re-seeds the input from the latest initialName on a genuine open transition", () => {
    const { rerender } = render(
      <RenameDialog
        open={false}
        title="Rename File"
        initialName="Loading…"
        onClose={vi.fn()}
        onRename={vi.fn()}
      />
    );

    // Resolves while closed, then the dialog is opened.
    rerender(
      <RenameDialog
        open
        title="Rename File"
        initialName="report"
        extension=".pdf"
        onClose={vi.fn()}
        onRename={vi.fn()}
      />
    );

    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("report");
  });
});
