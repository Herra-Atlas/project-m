export type FieldType = 'text' | 'number' | 'select' | 'textarea';

export interface NodeField {
  key: string;
  label: string;
  type: FieldType;
  default?: string;
  options?: string[];
  icon?: string;
  compact?: boolean;
  monospace?: boolean;
  rows?: number;
  showWhen?: { field: string; equals: string | number };
}

export type NodeOutputType = 'text' | 'number' | 'boolean';

export interface NodeOutput {
  name: string;
  type: NodeOutputType;
  description: string;
}

export interface NodeTypeMeta {
  type: string;
  label: string;
  color: string;
  group: string;
  description: string;
  fields: NodeField[];
  outputs: NodeOutput[];
}

export interface EditorNode {
  id: string;
  type: string;
  x: number;
  y: number;
  fields: Record<string, string | number>;
}

export interface Connection {
  from: string;
  to: string;
}

export interface Macro {
  id: string;
  title: string;
  description: string;
  nodes: EditorNode[];
  connections: Connection[];
  icon?: string;
  madeByAi?: boolean;
}

export interface MacroData {
  nodes: Array<{ id: string; type: string; x: number; y: number; fields: Record<string, string | number> }>;
  connections: Array<{ from: string; to: string }>;
}