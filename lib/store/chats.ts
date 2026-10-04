import "server-only";
import { readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "../files";
import { isValidId } from "../ids";
import { chatsDir, isMissing, projectExists, ready, serialize, trashPath } from "./core";

// Conversations with Construct: <project>/construct/<chat>.json, written by
// lib/construct/session.ts. Opaque JSON here.

function chatFile(id: string, cid: string) {
  if (!isValidId(cid)) throw new Error(`invalid chat id: ${cid}`);
  return path.join(chatsDir(id), `${cid}.json`);
}

/** Every stored chat of a project, parsed; unreadable files are skipped. */
export async function readChats(id: string): Promise<unknown[]> {
  if (!isValidId(id)) return [];
  await ready();
  let names: string[];
  try {
    names = await readdir(chatsDir(id));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const chats = await Promise.all(
    names
      .filter((n) => n.endsWith(".json") && isValidId(n.slice(0, -5)))
      .map(async (n) => {
        try {
          return JSON.parse(await readFile(chatFile(id, n.slice(0, -5)), "utf8")) as unknown;
        } catch {
          return null;
        }
      }),
  );
  return chats.filter((c) => c !== null);
}

// The agent runs in a scratch folder named for the project, and Claude Code
// files its sessions under that path. The name is fixed the first time, so a
// renamed project's chats can still be resumed.
const agentHomeFile = (id: string) => path.join(chatsDir(id), "agent-home");

export async function pinAgentHome(id: string): Promise<string> {
  try {
    const name = (await readFile(agentHomeFile(id), "utf8")).trim();
    if (isValidId(name)) return name;
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  await writeAtomic(agentHomeFile(id), id);
  return id;
}

/** The name of Construct's working folder for this project. */
export function agentHome(id: string): Promise<string> {
  return serialize(async () => ((await projectExists(id)) ? pinAgentHome(id) : id));
}

/** Save a chat. False if the project no longer exists. */
export function writeChat(id: string, cid: string, data: unknown): Promise<boolean> {
  return serialize(async () => {
    if (!(await projectExists(id))) return false;
    await writeAtomic(chatFile(id, cid), JSON.stringify(data));
    return true;
  });
}

export function trashChat(id: string, cid: string): Promise<boolean> {
  return serialize(async () => {
    try {
      await rename(chatFile(id, cid), await trashPath(`${id}--construct--${cid}`, ".json"));
      return true;
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  });
}
