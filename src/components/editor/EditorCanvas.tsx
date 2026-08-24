import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { EditorNode, Connection } from './types';
import { Node } from './Node';

interface EditorCanvasProps {
  nodes: EditorNode[];
  connections: Connection[];
  selectedNodeId: string | null;
  activeNodeId: string | null;
  knownVariables: string[];
  onNodesChange: (nodes: EditorNode[]) => void;
  onConnectionsChange: (connections: Connection[]) => void;
  onSelectNode: (id: string | null) => void;
  onAddNode: (type: string, x: number, y: number) => void;
}

const NODE_WIDTH = 210;
const PORT_OFFSET = 6;
const DEFAULT_NODE_HEIGHT = 80;
const SVG_EXTENT = 100000;

function portWorldPosition(node: EditorNode, port: 'in' | 'out', heights: Map<string, number>) {
  const height = heights.get(node.id) ?? DEFAULT_NODE_HEIGHT;
  return {
    x: port === 'out' ? node.x + NODE_WIDTH + PORT_OFFSET : node.x - PORT_OFFSET,
    y: node.y + height / 2,
  };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.4);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

type Op =
  | { type: 'none' }
  | { type: 'pan'; startX: number; startY: number; startPanX: number; startPanY: number }
  | { type: 'drag'; id: string; offsetX: number; offsetY: number; nodeX: number; nodeY: number }
  | { type: 'connect'; fromId: string; fromX: number; fromY: number };

export function EditorCanvas({
  nodes,
  connections,
  selectedNodeId,
  activeNodeId,
  knownVariables,
  onNodesChange,
  onConnectionsChange,
  onSelectNode,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  const [previewPos, setPreviewPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [connecting, setConnecting] = useState<{ fromId: string; fromX: number; fromY: number; toX: number; toY: number } | null>(null);
  const [highlightPort, setHighlightPort] = useState<{ nodeId: string; port: 'in' | 'out' } | null>(null);

  const opRef = useRef<Op>({ type: 'none' });
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  // Track each node's measured height so connection endpoints align with the visible ports
  const nodeHeightsRef = useRef<Map<string, number>>(new Map());
  const [, setHeightsTick] = useState(0);
  const onNodeHeightChange = useCallback((id: string, height: number) => {
    if (nodeHeightsRef.current.get(id) !== height) {
      nodeHeightsRef.current.set(id, height);
      setHeightsTick((t) => t + 1);
    }
  }, []);

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (sx - rect.left - pan.x) / zoom,
        y: (sy - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  // Auto-fit on mount: center the view on all nodes so macros loaded from
  // another PC (or panned off-screen) are immediately visible.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const padding = 100;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const h = nodeHeightsRef.current.get(n.id) ?? DEFAULT_NODE_HEIGHT;
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.y + h);
    }
    if (!isFinite(minX)) return;

    const bboxW = maxX - minX;
    const bboxH = maxY - minY;
    const fitZoom = Math.min(
      rect.width / (bboxW + padding * 2),
      rect.height / (bboxH + padding * 2),
      1.0,
    );
    const finalZoom = Math.max(0.25, fitZoom);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    setZoom(finalZoom);
    setPan({
      x: rect.width / 2 - centerX * finalZoom,
      y: rect.height / 2 - centerY * finalZoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Document-level listeners
  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const op = opRef.current;
      if (op.type === 'pan') {
        const dx = e.clientX - op.startX;
        const dy = e.clientY - op.startY;
        setPan({ x: op.startPanX + dx, y: op.startPanY + dy });
      } else if (op.type === 'drag') {
        const w = screenToWorld(e.clientX, e.clientY);
        const x = w.x - op.offsetX;
        const y = w.y - op.offsetY;
        setPreviewPos({ id: op.id, x, y });
      } else if (op.type === 'connect') {
        const w = screenToWorld(e.clientX, e.clientY);
        setConnecting((prev) => (prev ? { ...prev, toX: w.x, toY: w.y } : prev));

        const el = document.elementFromPoint(e.clientX, e.clientY);
        const portEl = el?.closest('[data-port="in"]') as HTMLElement | null;
        if (portEl) {
          const toId = portEl.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
          if (toId && toId !== op.fromId) {
            setHighlightPort({ nodeId: toId, port: 'in' });
          } else {
            setHighlightPort(null);
          }
        } else {
          setHighlightPort(null);
        }
      }
      // Always re-render connections so they follow preview position during drag
      if (op.type === 'drag') {
        setHeightsTick((t) => t + 1);
      }
    };

    const handleUp = (e: PointerEvent) => {
      const op = opRef.current;
      if (op.type === 'none') return;

      if (op.type === 'pan') {
        opRef.current = { type: 'none' };
        return;
      }

      if (op.type === 'drag') {
        setPreviewPos((prev) => {
          if (prev && prev.id === op.id) {
            onNodesChange(
              nodesRef.current.map((n) => (n.id === op.id ? { ...n, x: prev.x, y: prev.y } : n)),
            );
          }
          return null;
        });
        opRef.current = { type: 'none' };
        return;
      }

      if (op.type === 'connect') {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const portEl = el?.closest('[data-port="in"]') as HTMLElement | null;
        if (portEl) {
          const toId = portEl.closest('[data-node-id]')?.getAttribute('data-node-id');
          if (toId && toId !== op.fromId) {
            const exists = connectionsRef.current.some(
              (c) => c.from === op.fromId && c.to === toId,
            );
            if (!exists) {
              onConnectionsChange([
                ...connectionsRef.current,
                { from: op.fromId, to: toId },
              ]);
            }
          }
        }
        opRef.current = { type: 'none' };
        setConnecting(null);
        setHighlightPort(null);
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && opRef.current.type === 'connect') {
        opRef.current = { type: 'none' };
        setConnecting(null);
        setHighlightPort(null);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('keydown', handleKey);
    };
  }, [screenToWorld, onNodesChange, onConnectionsChange]);

  // Wheel zoom
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const before = { x: (mx - pan.x) / zoom, y: (my - pan.y) / zoom };
      const delta = -e.deltaY * 0.001;
      const newZoom = Math.max(0.25, Math.min(3, zoom * (1 + delta)));
      setPan({ x: mx - before.x * newZoom, y: my - before.y * newZoom });
      setZoom(newZoom);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [pan, zoom]);

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-node-id]')) return;
    if (target.closest('[data-port]')) return;
    opRef.current = {
      type: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    onSelectNode(null);
  };

  const onNodePointerDown = (e: React.PointerEvent, nodeId: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-port]')) return;
    if (target.closest('input, select, textarea, button')) return;
    e.stopPropagation();
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const w = screenToWorld(e.clientX, e.clientY);
    opRef.current = {
      type: 'drag',
      id: nodeId,
      offsetX: w.x - node.x,
      offsetY: w.y - node.y,
      nodeX: node.x,
      nodeY: node.y,
    };
    onSelectNode(nodeId);
  };

  const onPortPointerDown = (e: React.PointerEvent, nodeId: string, port: 'in' | 'out') => {
    if (port !== 'out') return;
    e.stopPropagation();
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const pos = portWorldPosition(node, 'out', nodeHeightsRef.current);
    const w = screenToWorld(e.clientX, e.clientY);
    opRef.current = { type: 'connect', fromId: nodeId, fromX: pos.x, fromY: pos.y };
    setConnecting({ fromId: nodeId, fromX: pos.x, fromY: pos.y, toX: w.x, toY: w.y });
  };

  const onPortPointerEnter = (nodeId: string, port: 'in' | 'out') => {
    if (opRef.current.type === 'connect' && port === 'in') {
      setHighlightPort({ nodeId, port });
    }
  };

  const onPortPointerLeave = () => {
    setHighlightPort(null);
  };

  const onUpdateNode = (id: string, fields: Record<string, string | number>) => {
    onNodesChange(nodes.map((n) => (n.id === id ? { ...n, fields } : n)));
  };

  const onDeleteNode = (id: string) => {
    onNodesChange(nodes.filter((n) => n.id !== id));
    onConnectionsChange(connections.filter((c) => c.from !== id && c.to !== id));
    if (selectedNodeId === id) onSelectNode(null);
  };

  // Delete with keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        const t = e.target as HTMLElement;
        if (t.closest('input, textarea, select')) return;
        e.preventDefault();
        onDeleteNode(selectedNodeId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId]);

  const gridSize = 24 * zoom;

  const renderedNodes = nodes.map((node) => {
    if (previewPos && previewPos.id === node.id) {
      return { ...node, x: previewPos.x, y: previewPos.y };
    }
    return node;
  });

  const connectionPaths = useMemo(() => {
    return connections
      .map((c) => {
        const fromNode = renderedNodes.find((n) => n.id === c.from);
        const toNode = renderedNodes.find((n) => n.id === c.to);
        if (!fromNode || !toNode) return null;
        const from = portWorldPosition(fromNode, 'out', nodeHeightsRef.current);
        const to = portWorldPosition(toNode, 'in', nodeHeightsRef.current);
        return { id: `${c.from}__${c.to}`, from: c.from, to: c.to, d: bezierPath(from.x, from.y, to.x, to.y) };
      })
      .filter(Boolean) as { id: string; from: string; to: string; d: string }[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections, renderedNodes]);

  return (
    <div
      ref={canvasRef}
      onPointerDown={onCanvasPointerDown}
      className="relative flex-1 overflow-hidden bg-[#0d0d0d]"
      style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor: opRef.current.type === 'pan' ? 'grabbing' : 'grab',
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left pointer-events-none"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {/* Connections layer — large SVG positioned at world origin */}
        <svg
          width={SVG_EXTENT}
          height={SVG_EXTENT}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        >
          {connectionPaths.map((p) => {
            const focusId = activeNodeId ?? selectedNodeId;
            const isFocused = focusId != null && (p.from === focusId || p.to === focusId);
            const dimmed = focusId != null && !isFocused;
            const stroke = isFocused
              ? 'rgba(34,197,94,1)'
              : dimmed
                ? 'rgba(34,197,94,0.2)'
                : 'rgba(34,197,94,0.75)';
            return (
              <g key={p.id}>
                {/* Wide invisible hit area for click-to-cut */}
                <path
                  d={p.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(10, 14 / zoom)}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnectionsChange(
                      connectionsRef.current.filter(
                        (c) => !(c.from === p.from && c.to === p.to),
                      ),
                    );
                  }}
                />
                {/* Visible stroke */}
                <path
                  d={p.d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={Math.max(1.5, (isFocused ? 2.75 : 2) / zoom)}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'none', transition: 'stroke 0.15s, stroke-width 0.15s' }}
                />
              </g>
            );
          })}
          {connecting && (
            <path
              d={bezierPath(connecting.fromX, connecting.fromY, connecting.toX, connecting.toY)}
              fill="none"
              stroke="rgba(34,197,94,0.9)"
              strokeWidth={Math.max(1.5, 2 / zoom)}
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Nodes layer */}
        {renderedNodes.map((node) => (
          <div key={node.id} className="pointer-events-auto" style={{ position: 'absolute', left: 0, top: 0, zIndex: 1 }}>
            <Node
              node={node}
              selected={selectedNodeId === node.id}
              active={activeNodeId === node.id}
              knownVariables={knownVariables}
              onSelect={onSelectNode}
              onDelete={onDeleteNode}
              onUpdate={onUpdateNode}
              onPortPointerDown={onPortPointerDown}
              onPortPointerEnter={onPortPointerEnter}
              onPortPointerLeave={onPortPointerLeave}
              onPointerDown={onNodePointerDown}
              onHeightChange={onNodeHeightChange}
              highlightPort={highlightPort}
            />
          </div>
        ))}
      </div>

      <CanvasControls
        zoom={zoom}
        onZoomChange={setZoom}
        onReset={() => {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }}
      />
    </div>
  );
}

function CanvasControls({
  zoom,
  onZoomChange,
  onReset,
}: {
  zoom: number;
  onZoomChange: (z: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-md bg-transparent p-0.5 z-50">
      <button
        onClick={() => onZoomChange(Math.max(0.25, zoom * 0.85))}
        className="h-6 w-6 flex items-center justify-center text-[11px] text-neutral-600 hover:text-neutral-300 rounded transition-colors"
        title="Zoom out"
      >
        −
      </button>
      <button
        onClick={onReset}
        className="h-6 px-1.5 text-[10px] font-mono text-neutral-600 hover:text-neutral-300 rounded transition-colors tabular-nums"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={() => onZoomChange(Math.min(3, zoom * 1.15))}
        className="h-6 w-6 flex items-center justify-center text-[11px] text-neutral-600 hover:text-neutral-300 rounded transition-colors"
        title="Zoom in"
      >
        +
      </button>
    </div>
  );
}