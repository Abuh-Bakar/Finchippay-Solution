const DB_NAME = "finchippay-contacts";
const DB_VERSION = 1;
const STORE_NAME = "contacts";

export interface Contact {
  id?: number;
  name: string;
  publicKey: string;
  federationAddress?: string;
  memo?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("publicKey", "publicKey", { unique: true });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("federationAddress", "federationAddress", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addContact(contact: Omit<Contact, "id" | "createdAt" | "updatedAt">): Promise<number> {
  const db = await openDB();
  const now = Date.now();
  const record: Contact = { ...contact, createdAt: now, updatedAt: now };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(record);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getAllContacts(): Promise<Contact[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.name.localeCompare(b.name)));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function updateContact(id: number, updates: Partial<Omit<Contact, "id" | "createdAt">>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { reject(new Error("Contact not found")); return; }
      const updated = { ...existing, ...updates, updatedAt: Date.now() };
      store.put(updated);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => { db.close(); resolve(); };
  });
}

export async function deleteContact(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function searchContacts(query: string): Promise<Contact[]> {
  const all = await getAllContacts();
  const q = query.toLowerCase();
  return all.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.publicKey.toLowerCase().includes(q) ||
    (c.federationAddress && c.federationAddress.toLowerCase().includes(q))
  );
}

export async function importContacts(contacts: Omit<Contact, "id" | "createdAt" | "updatedAt">[]): Promise<number> {
  let count = 0;
  for (const contact of contacts) {
    try { await addContact(contact); count++; } catch {}
  }
  return count;
}

export function parseCSV(content: string): Omit<Contact, "id" | "createdAt" | "updatedAt">[] {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  const publicKeyIdx = headers.indexOf("publickey");
  const memoIdx = headers.indexOf("memo");
  const federationIdx = headers.indexOf("federationaddress");
  if (nameIdx === -1 || publicKeyIdx === -1) return [];
  const contacts: Omit<Contact, "id" | "createdAt" | "updatedAt">[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) continue;
    contacts.push({
      name: cols[nameIdx],
      publicKey: cols[publicKeyIdx],
      memo: memoIdx >= 0 ? cols[memoIdx] : undefined,
      federationAddress: federationIdx >= 0 ? cols[federationIdx] : undefined,
    });
  }
  return contacts;
}

export function parseVCard(content: string): Omit<Contact, "id" | "createdAt" | "updatedAt">[] {
  const contacts: Omit<Contact, "id" | "createdAt" | "updatedAt">[] = [];
  const blocks = content.split(/(?=BEGIN:VCARD)/i);
  for (const block of blocks) {
    if (!block.toUpperCase().includes("BEGIN:VCARD")) continue;
    const fnMatch = block.match(/^FN[:;].*?:?([^\r\n]+)/im);
    const stellarMatch = block.match(/^X-STELLAR-ADDRESS[:;].*?:?([^\r\n]+)/im);
    const name = fnMatch ? fnMatch[1].trim() : "Imported Contact";
    const publicKey = stellarMatch ? stellarMatch[1].trim() : "";
    if (publicKey) {
      contacts.push({ name, publicKey });
    }
  }
  return contacts;
}

export function generateCSV(contacts: Contact[]): string {
  const header = "name,publicKey,memo,federationAddress";
  const rows = contacts.map(c => `${c.name},${c.publicKey},${c.memo || ""},${c.federationAddress || ""}`);
  return [header, ...rows].join("\n");
}

export function generateVCard(contacts: Contact[]): string {
  return contacts.map(c =>
    `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${c.name}\r\nX-STELLAR-ADDRESS:${c.publicKey}\r\n${c.memo ? `NOTE:${c.memo}\r\n` : ""}END:VCARD`
  ).join("\r\n");
}