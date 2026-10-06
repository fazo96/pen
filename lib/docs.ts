import "server-only";

// The library on disk (see lib/store/core.ts for the layout), as the routes,
// Construct and the exports use it. Each part lives in lib/store/; they all
// share one queue, so a read-compare-write never interleaves with another.

export { GLOBAL, isOwnerId, isValidId } from "./ids";
export type { Doc, DocMeta, EntryMeta, VersionMeta } from "./types";
export { MAX_BYTES, projectExists, readDoc, versionOf, type WriteResult } from "./store/core";
export { createDoc, listDocs, type RenameResult, renameDoc, trashDoc, writeDoc } from "./store/projects";
export { deleteVersion, importVersion, listVersions, readVersion, renameVersion, restoreVersion, saveVersion } from "./store/history";
export { createEntry, listCodex, moveEntry, readEntry, renameEntry, trashEntry, writeEntry } from "./store/codex";
export { readSpots, writeSpot } from "./store/spots";
export { type CoverExt, coverExtOf, MAX_COVER_BYTES, readCover, removeCover, writeCover } from "./store/cover";
export { agentHome, readChats, trashChat, writeChat } from "./store/chats";
