export const MACHINES = ["local", "home"] as const;
export type Machine = (typeof MACHINES)[number];
export const MACHINE_NAMES = { local: "Local", home: "Vigilia Home" };

const query = new URLSearchParams(window.location.search);
export const currentMachine: Machine = query.get("machine") === "home" ? "home" : "local";
export function startingPath(fallback: string): string {
  return query.get("path") ?? sessionStorage.getItem(`machine-path:${currentMachine}`) ?? fallback;
}

function currentPath(): string {
  const parts = [...document.querySelectorAll(".atmo-crumbs .crumb")].map(
    (crumb) => crumb.textContent,
  );
  return parts.join("/").replace(/^\/\//, "/");
}

function rememberContext(): void {
  const path = currentPath();
  if (path !== "") sessionStorage.setItem(`machine-path:${currentMachine}`, path);
  const view = document
    .querySelector(".atmo-views [aria-pressed=true]")
    ?.getAttribute("aria-label");
  if (view !== null && view !== undefined) sessionStorage.setItem("machine-view", view);
}

// WORKAROUND: reload the isolated prototype to replace its one global bridge.
// This sample-data harness uses one global bridge; production uses forMachine.
// Remove the reload if the study adopts those contexts. Only the folder and view persist.
export function navigateMachine(machine: Machine): void {
  rememberContext();
  const next = new URL(window.location.href);
  next.searchParams.set("machine", machine);
  next.searchParams.delete("layout");
  next.searchParams.delete("path");
  window.location.assign(next.href);
}

export function restoreView(): void {
  const label = sessionStorage.getItem("machine-view");
  const buttons = document.querySelectorAll<HTMLButtonElement>(".atmo-views button");
  const button = [...buttons].find((candidate) => candidate.getAttribute("aria-label") === label);
  button?.click();
}
