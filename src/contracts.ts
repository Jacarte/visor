import type { NoteMetadata } from './model';
export interface IndexedNote { id: string; metadata: NoteMetadata | null; headings: { text: string; anchor: string }[]; blocks: string[] }
export interface FolderSnapshot { generation: number; revision: number; folder: string | null; notes: IndexedNote[]; issues: string[] }
import type { Root as HastRoot } from 'hast';
import type { ApprovedLink } from './links';
export type PreparedPreview = { kind: 'formatted'; tree: HastRoot; links: Record<string, ApprovedLink>; anchors: string[] } | { kind: 'plain'; reason: string };
export interface NoteBody { generation: number; revision: number; id: string; body: string; preview: PreparedPreview }
export interface VisorBridge {
  chooseFolder(): Promise<FolderSnapshot>;
  getSnapshot(): Promise<FolderSnapshot>;
  readNote(id: string, generation: number): Promise<NoteBody>;
  onUpdate(callback: (snapshot: FolderSnapshot) => void): () => void;
  openExternal(url: string): Promise<void>;
}
export const EMPTY_SNAPSHOT: FolderSnapshot = { generation: 0, revision: 0, folder: null, notes: [], issues: [] };
export function newerSnapshot(current: FolderSnapshot, incoming: FolderSnapshot): FolderSnapshot {
  return incoming.generation > current.generation || (incoming.generation === current.generation && incoming.revision > current.revision) ? incoming : current;
}
declare global { interface Window { visor: VisorBridge } }
