/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PdfPasswordForm } from "../src/components/preview/pdf/PdfPasswordForm.tsx";

afterEach(cleanup);

it("masks the password, submits it without trimming, and clears the field for retry", () => {
  const submitted: string[] = [];
  const onUnlock = (password: string) => submitted.push(password);
  const { rerender } = render(
    <PdfPasswordForm incorrect={false} focusInput={false} onUnlock={onUnlock} />,
  );
  const input = screen.getByLabelText("PDF password");
  expect(input.getAttribute("type")).toBe("password");
  fireEvent.change(input, { target: { value: " password " } });
  fireEvent.submit(screen.getByRole("form", { name: "Unlock PDF" }));
  expect(submitted).toEqual([" password "]);
  expect(screen.getByDisplayValue("")).toBe(input);

  rerender(<PdfPasswordForm incorrect focusInput={false} onUnlock={onUnlock} />);
  expect(screen.getByRole("alert").textContent).toContain("Incorrect password");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(input, { target: { value: "correct" } });
  fireEvent.submit(screen.getByRole("form", { name: "Unlock PDF" }));
  expect(submitted).toEqual([" password ", "correct"]);
});

it("keeps file navigation focused in the column and focuses the reader password field", () => {
  const navigation = document.createElement("button");
  document.body.append(navigation);
  navigation.focus();
  const { rerender } = render(
    <PdfPasswordForm incorrect={false} focusInput={false} onUnlock={() => undefined} />,
  );
  expect(document.activeElement).toBe(navigation);
  rerender(<PdfPasswordForm incorrect={false} focusInput onUnlock={() => undefined} />);
  expect(document.activeElement).toBe(screen.getByLabelText("PDF password"));
  navigation.remove();
});
