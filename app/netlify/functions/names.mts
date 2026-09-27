// A person's primary .sol name, where they have set one. Read only.
//
// Identity in Cleat is the key, and it stays that way: this never asks for a
// name and never requires one. It only shows the name an owner already chose
// as their primary on Solana, which is an on-chain record they signed, so a
// sentence can read as "alex.sol" rather than "8JRD…xpWq". Names live on
// mainnet; the same key owns them there.
//
// Read straight from the chain rather than from a lookup service, which was
// returning errors: the favourite-domain account names the domain account,
// and its reverse-lookup record holds the text.
import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { getStore } from "@netlify/blobs";

const NAME_PROGRAM = new PublicKey("namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX");
const OFFERS_PROGRAM = new PublicKey("85iDfUvr3HJyLM2zcq5BXSiDvUWfw6cSE1FfNBo8Ap29");
const REVERSE_CLASS = new PublicKey("33m47vH6Eav6jr5Ry86XjhRft2jRBLDnDgPSHoquXi2Z");
const DAY = 24 * 60 * 60 * 1000;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });

const reverseKey = (domainAccount: PublicKey) => {
  const hashed = createHash("sha256").update("SPL Name Service" + domainAccount.toBase58()).digest();
  return PublicKey.findProgramAddressSync([hashed, REVERSE_CLASS.toBuffer(), Buffer.alloc(32)], NAME_PROGRAM)[0];
};

export default async (req: Request) => {
  const owners = (new URL(req.url).searchParams.get("owners") ?? "").split(",").filter(Boolean).slice(0, 40);
  const valid = owners.filter((o) => { try { new PublicKey(o); return true; } catch { return false; } });
  if (!valid.length) return json({ names: {} });

  const store = getStore("cleat-names");
  const out: Record<string, string | null> = {};
  const todo: string[] = [];
  for (const o of valid) {
    const hit = (await store.get(o, { type: "json" })) as { at: number; name: string | null } | null;
    if (hit && Date.now() - hit.at < DAY) out[o] = hit.name; else todo.push(o);
  }

  if (todo.length) {
    const url = (process.env.SOLANA_RPC_URL ?? "").replace("devnet", "mainnet");
    const conn = new Connection(url, "confirmed");
    try {
      const favs = todo.map((o) =>
        PublicKey.findProgramAddressSync([Buffer.from("favourite_domain"), new PublicKey(o).toBuffer()], OFFERS_PROGRAM)[0]);
      const favInfo = await conn.getMultipleAccountsInfo(favs);
      const domains = favInfo.map((a) => (a && a.data.length >= 33 ? new PublicKey(a.data.subarray(1, 33)) : null));
      const revKeys = domains.map((d) => (d ? reverseKey(d) : null));
      const revInfo = await conn.getMultipleAccountsInfo(revKeys.filter((k): k is PublicKey => !!k));
      let r = 0;
      for (let i = 0; i < todo.length; i++) {
        let name: string | null = null;
        if (revKeys[i]) {
          const a = revInfo[r++];
          if (a && a.data.length > 100) {
            const len = a.data.readUInt32LE(96);
            const text = a.data.subarray(100, 100 + len).toString("utf8").replace(/\0/g, "");
            if (/^[a-z0-9-]{1,63}$/i.test(text)) name = `${text}.sol`;
          }
        }
        out[todo[i]] = name;
        await store.setJSON(todo[i], { at: Date.now(), name });
      }
    } catch {
      for (const o of todo) if (!(o in out)) out[o] = null;
    }
  }
  return json({ names: out });
};

export const config = { path: "/api/names" };
