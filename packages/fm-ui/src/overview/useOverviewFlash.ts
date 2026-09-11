import {
  computeFlash,
  type FlashResult,
  type FlashTransition,
  flashTransition,
} from "@symmetria/fm-core/flash";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type FlashScene, positionFlashLabels, readFlashScene } from "./flashTargets.ts";
import { measureFlashMatches } from "./flashTextGeometry.ts";
import type { OverviewPort } from "./useOverviewMode.ts";

interface FlashSession {
  readonly scene: FlashScene;
  readonly generation: string;
  readonly query: string;
  readonly prefix: string;
}
interface FlashOptions {
  readonly viewport: RefObject<HTMLDivElement | null>;
  readonly generation: string;
  readonly port: OverviewPort | undefined;
  readonly stopCamera: () => void;
  readonly select: (path: string) => void;
}
const EMPTY_TARGETS: readonly never[] = [];

export function useOverviewFlash(options: FlashOptions) {
  const { viewport, generation, port } = options;
  const [session, setSession] = useState<FlashSession | null>(null);
  const cancel = useCallback(() => setSession(null), []);
  const scene = session?.scene;
  const query = session?.query ?? "";
  const result = useMemo(
    () => computeFlash(query, scene?.targets ?? EMPTY_TARGETS),
    [query, scene],
  );
  const queries = useMemo(
    () => (scene ? measureFlashMatches(scene, result.matches, query) : []),
    [scene, result, query],
  );
  const labels = useMemo(
    () => (scene ? positionFlashLabels(scene, result.matches, queries) : []),
    [scene, result, queries],
  );
  const resolved = resolveVisibleLabels(result, labels !== null);
  const latest = useRef({ options, session, resolved });
  latest.current = { options, session, resolved };
  const onKey = useCallback(
    (event: KeyboardEvent) => handleFlashKey(event, latest.current, cancel, setSession),
    [cancel],
  );
  useFlashRegistration(port?.flash, session !== null, onKey);
  useFlashInvalidation(viewport, session, generation, cancel);
  return {
    active: session !== null,
    query: session?.query ?? "",
    prefix: session?.prefix ?? "",
    count: result.matches.length,
    empty: session?.scene.targets.length === 0,
    needsRefinement: resolved.needsRefinement,
    labels: labels ?? [],
    queries,
    matches: useMemo(() => new Set(result.matches.map((match) => match.path)), [result]),
    cancel,
    open: () => {
      options.stopCamera();
      const node = viewport.current;
      if (!node) return;
      node.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
      setSession({ scene: readFlashScene(node), generation, query: "", prefix: "" });
    },
  };
}

interface FlashCurrent {
  readonly options: FlashOptions;
  readonly session: FlashSession | null;
  readonly resolved: FlashResult;
}
function sceneIsCurrent(session: FlashSession, generation: string, node: HTMLElement | null) {
  return (
    node !== null &&
    session.generation === generation &&
    readFlashScene(node).token === session.scene.token
  );
}
function handleFlashKey(
  event: KeyboardEvent,
  current: FlashCurrent,
  cancel: () => void,
  update: (session: FlashSession) => void,
): boolean {
  const { session, options, resolved } = current;
  if (!session) return true;
  if (!sceneIsCurrent(session, options.generation, options.viewport.current)) {
    cancel();
    return true;
  }
  if (event.repeat || event.isComposing || MODIFIER_KEYS.has(event.key)) return true;
  if (isShortcut(event)) {
    cancel();
    return false;
  }
  const transition = flashTransition(session.query, session.prefix, event.key, resolved);
  applyTransition(transition, session, options, cancel, update);
  return true;
}
function applyTransition(
  transition: FlashTransition,
  session: FlashSession,
  options: FlashOptions,
  cancel: () => void,
  update: (session: FlashSession) => void,
) {
  switch (transition.kind) {
    case "cancel":
      cancel();
      break;
    case "query":
      update({ ...session, query: transition.query, prefix: "" });
      break;
    case "prefix":
      update({ ...session, prefix: transition.prefix });
      break;
    case "select":
      cancel();
      options.select(transition.path);
      options.viewport.current
        ?.closest<HTMLElement>('[role="dialog"]')
        ?.focus({ preventScroll: true });
      break;
  }
}
const MODIFIER_KEYS = new Set(["Control", "Alt", "Meta", "Shift", "AltGraph"]);
function isShortcut(event: KeyboardEvent) {
  return !event.getModifierState("AltGraph") && (event.ctrlKey || event.metaKey || event.altKey);
}
function useFlashRegistration(
  port: OverviewPort["flash"],
  active: boolean,
  onKey: (event: KeyboardEvent) => boolean,
) {
  const connect = port?.connect;
  const reportActive = port?.setActive;
  useEffect(() => connect?.(onKey), [connect, onKey]);
  useLayoutEffect(() => {
    reportActive?.(active);
  }, [reportActive, active]);
  useEffect(() => () => reportActive?.(false), [reportActive]);
}
function useFlashInvalidation(
  viewport: RefObject<HTMLDivElement | null>,
  session: FlashSession | null,
  generation: string,
  cancel: () => void,
) {
  useLayoutEffect(() => {
    if (session && !sceneIsCurrent(session, generation, viewport.current)) cancel();
  });
  const active = session !== null;
  useEffect(() => {
    if (!active) return;
    const outside = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !viewport.current?.closest('[role="dialog"]')?.contains(event.target)
      )
        cancel();
    };
    window.addEventListener("resize", cancel);
    document.addEventListener("focusin", outside);
    document.addEventListener("pointerdown", cancel, true);
    return () => {
      window.removeEventListener("resize", cancel);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("pointerdown", cancel, true);
    };
  }, [active, viewport, cancel]);
}

function resolveVisibleLabels(result: FlashResult, visible: boolean): FlashResult {
  return visible
    ? result
    : {
        ...result,
        needsRefinement: true,
        matches: result.matches.map((match) => ({ ...match, label: "" })),
      };
}
