import type { Server } from 'node:http';
export const server: Server;
export function storeReplay(dir: string, body: Buffer): Promise<{ entries: number; total: number }>;
export function storeClarte(dir: string, id: string, manifestJson: Buffer): Promise<{ file: string; bytes: number }>;
