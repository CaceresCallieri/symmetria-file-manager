import { joinPath } from "@symmetria/fm-core/pane";

/** Parse local paths without interpreting URL escapes in ordinary filenames. */
export function pickerPath(value: string, directory: string, home: string): string {
  let path = value.trim();
  if (!path || /[\r\n\0]/.test(path)) throw new Error("Enter one local file or folder path.");
  if (/^file:/i.test(path) || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
    path = localFileUrlPath(path);
  }
  if (path === "~") path = home;
  else if (path.startsWith("~/")) path = joinPath(home, path.slice(2));
  if (!path.startsWith("/")) path = joinPath(directory, path);
  // Do not collapse '..': the filesystem resolves it after following symlinks.
  if (/[\r\n\0]/.test(path)) throw new Error("Enter one local file or folder path.");
  // parentOf uses single separators. Use the same spelling for reveal and
  // cursor comparison without changing symlink-sensitive dot segments.
  return `/${path
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .join("/")}`;
}

function localFileUrlPath(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "file:" || url.hostname || url.search || url.hash) {
    throw new Error("Use a local path or a file:// URL.");
  }
  return decodeURIComponent(url.pathname);
}
