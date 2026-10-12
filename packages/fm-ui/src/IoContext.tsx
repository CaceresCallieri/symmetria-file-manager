import { createContext, useContext } from "react";
import { defaultFileManagerIo } from "./bridge.ts";

/** Each mounted panel owns its filesystem connection, including pending work. */
export const FileManagerIoContext = createContext(defaultFileManagerIo);
export function useFileManagerIo() {
  return useContext(FileManagerIoContext);
}
