"""Process mining + BPMN export (§8).

Wraps PM4Py's inductive miner and serializes its BPMN with a pure-Python
layout, wrapped into rows so a long flow prints legibly on a page. The
step-level observed-flow BPMN (bpmn_observed.py) is the only caller.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

import pm4py
from pm4py.objects.log.obj import EventLog


def discover_inductive(log: EventLog, noise_threshold: float = 0.2):
    """Inductive miner with noise filtering. Returns a BPMN object."""
    return pm4py.discover_bpmn_inductive(log, noise_threshold=noise_threshold)


# Map PM4Py BPMN node classes -> BPMN 2.0 XML element local-names.
_NODE_TAG = {
    "StartEvent":             "startEvent",
    "EndEvent":               "endEvent",
    "Task":                   "task",
    "UserTask":               "userTask",
    "ServiceTask":            "serviceTask",
    "SendTask":               "sendTask",
    "ReceiveTask":            "receiveTask",
    "ManualTask":             "manualTask",
    "ScriptTask":             "scriptTask",
    "BusinessRuleTask":       "businessRuleTask",
    "SubProcess":             "subProcess",
    "CallActivity":           "callActivity",
    "ExclusiveGateway":       "exclusiveGateway",
    "ParallelGateway":        "parallelGateway",
    "InclusiveGateway":       "inclusiveGateway",
    "EventBasedGateway":      "eventBasedGateway",
    "ComplexGateway":         "complexGateway",
    "IntermediateCatchEvent": "intermediateCatchEvent",
    "IntermediateThrowEvent": "intermediateThrowEvent",
    "BoundaryEvent":          "boundaryEvent",
}

_BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL"
_BPMNDI_NS = "http://www.omg.org/spec/BPMN/20100524/DI"
_DC_NS = "http://www.omg.org/spec/DD/20100524/DC"
_DI_NS = "http://www.omg.org/spec/DD/20100524/DI"
_XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

_XML_ID_BAD = re.compile(r"[^A-Za-z0-9_\-]")

# Shape dimensions for the layout. Tasks and subprocesses get one
# rectangle; events get a square; gateways get a diamond bbox.
_NODE_W = 120
_NODE_H = 72
_EVENT_SIZE = 36
_GW_SIZE = 50
_H_GAP = 60        # between two columns: room for the edges' bends
_SPLIT_GAP = 110   # after a column with a branching gateway: room for "3 of 4 transactions"
# A branch's name ("3 of 4 transactions", AD-29) takes two lines in bpmn-js,
# which wraps an external label at 90 px of 11 px Arial and draws it from the
# top of its box: the box is two lines tall and ends clear of the line it names.
_BRANCH_LABEL_W = 84
_BRANCH_LABEL_H = 28
_V_GAP = 30        # between two nodes of one column
_MARGIN = 30
_CHANNEL = 24      # the band above and below each row of nodes, for edges
_LANE = 10         # extra channel height per edge routed through it

# The layout wraps a long flow into rows so the map prints legibly on a page:
# a landscape page's printable area below a heading (9.5 by 5.9 inches, in
# points). A flow whose one row already prints its 12 px labels at 8.5 pt or
# more stays one row; a longer one takes the number of rows that prints it
# largest.
_PAGE_W_PT = 684
_PAGE_H_PT = 425
_LABEL_PX = 12
_LEGIBLE_PT = 8.5
_MAX_ROWS = 8


def _safe_id(prefix: str, idx: int, raw: str | None) -> str:
    """XML ids must start with a letter. Keep them short and stable."""
    base = (raw or "").strip()
    if base:
        base = _XML_ID_BAD.sub("_", base)[:32]
        return f"{prefix}_{idx}_{base}" if base else f"{prefix}_{idx}"
    return f"{prefix}_{idx}"


def _shape_size(node_cls: str) -> tuple[int, int]:
    """Pick a sensible bbox per BPMN element family."""
    if "Event" in node_cls:
        return _EVENT_SIZE, _EVENT_SIZE
    if "Gateway" in node_cls:
        return _GW_SIZE, _GW_SIZE
    return _NODE_W, _NODE_H


def _forward_edges(node_ids: list[str],
                   edges: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Edges with cycle BACK-EDGES removed, so longest-path ranking is
    well-defined.

    The inductive miner emits block-structured loop/redo gateways: a single
    back-edge (e.g. ``SAP: Create sales order -> <a gateway upstream>``) is enough
    to make a longest-path rank inflate the rank of *everything* reachable past
    the loop, smearing those nodes to the far right and scrambling the visual
    step order (``Outlook: Send`` left of ``Outlook: Enter To``; ``end`` mid-flow).
    Ranking on the acyclic forward set lays the diagram out in true topological
    order; the back-edges themselves are still DRAWN (export_bpmn emits every
    flow) -- only the column assignment ignores them.

    Back-edges are found with an iterative DFS from the real roots (no incoming
    edge) first: an edge to a node still GRAY (on the DFS stack) closes a cycle.
    """
    adj: dict[str, list[str]] = {n: [] for n in node_ids}
    for s, t in edges:
        if s in adj and t in adj:
            adj[s].append(t)
    targets = {t for _, t in edges if t in adj}
    roots = [n for n in node_ids if n not in targets] or list(node_ids[:1])
    order = roots + [n for n in node_ids if n not in roots]
    WHITE, GRAY, BLACK = 0, 1, 2
    state = {n: WHITE for n in node_ids}
    back: set[tuple[str, str]] = set()
    for root in order:
        if state[root] != WHITE:
            continue
        stack = [(root, iter(adj[root]))]
        state[root] = GRAY
        while stack:
            u, it = stack[-1]
            pushed = False
            for v in it:
                if state[v] == GRAY:
                    back.add((u, v))           # edge into an ancestor == cycle
                elif state[v] == WHITE:
                    state[v] = GRAY
                    stack.append((v, iter(adj[v])))
                    pushed = True
                    break
            if not pushed:
                state[u] = BLACK
                stack.pop()
    return [(s, t) for (s, t) in edges if (s, t) not in back]


def _ranks(node_ids: list[str], edges: list[tuple[str, str]]) -> dict[str, int]:
    """Each node's column: its longest-path depth from a root (a node with no
    incoming edge) over the ACYCLIC forward edge set, so a loop's back-edge
    does not smear the columns (_forward_edges). Rootless nodes fall back
    to 0."""
    in_edges: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for src, tgt in _forward_edges(node_ids, edges):
        if src in in_edges and tgt in in_edges:
            in_edges[tgt].append(src)
    rank: dict[str, int] = {}
    roots = [n for n in node_ids if not in_edges[n]]
    if not roots and node_ids:
        roots = [node_ids[0]]
    for r in roots:
        rank[r] = 0
    # Iterate until stable, capped to avoid pathological cycles.
    for _ in range(len(node_ids) + 1):
        changed = False
        for nid in node_ids:
            parent_ranks = [rank[p] for p in in_edges[nid] if p in rank]
            if not parent_ranks:
                continue
            new_rank = max(parent_ranks) + 1
            if rank.get(nid, -1) < new_rank:
                rank[nid] = new_rank
                changed = True
        if not changed:
            break
    for nid in node_ids:
        rank.setdefault(nid, 0)
    return rank


def _row_width(widths: list[int], gaps: list[int]) -> int:
    """A row's width: its columns and the gaps between them (gaps[k] is the
    gap after column k)."""
    return sum(widths) + sum(gaps[:-1]) if widths else 0


def _split_rows(widths: list[int], gaps: list[int], n: int,
                allowed: set[int] | None = None) -> list[list[int]] | None:
    """The column indices split into `n` consecutive rows so the widest row
    is as narrow as it can be (a linear partition), cutting only between
    column c and c + 1 for c in `allowed` (every cut when None). None when
    no such split exists."""
    m = len(widths)
    n = max(1, min(n, m))
    inf = float("inf")
    # best[k][i]: the narrowest widest row splitting columns [0, i) into k rows.
    best = [[inf] * (m + 1) for _ in range(n + 1)]
    cut = [[0] * (m + 1) for _ in range(n + 1)]
    best[0][0] = 0
    for k in range(1, n + 1):
        for i in range(1, m + 1):
            for j in range(k - 1, i):
                if j > 0 and allowed is not None and (j - 1) not in allowed:
                    continue
                cand = max(best[k - 1][j], _row_width(widths[j:i], gaps[j:i]))
                if cand < best[k][i]:
                    best[k][i], cut[k][i] = cand, j
    if best[n][m] == inf:
        return None
    rows, i = [], m
    for k in range(n, 0, -1):
        j = cut[k][i]
        rows.append(list(range(j, i)))
        i = j
    return [r for r in reversed(rows) if r]


class _Layout:
    """Where every node sits (x, y, w, h), which row and column it is in,
    and the geometry the edge router needs."""

    def __init__(self):
        self.pos: dict[str, tuple[int, int, int, int]] = {}
        self.rank: dict[str, int] = {}
        self.row_of_rank: dict[int, int] = {}
        self.col_left: dict[int, int] = {}
        self.col_right: dict[int, int] = {}
        self.gap_after: dict[int, int] = {}        # rank -> the gap right of its column
        self.gap_before: dict[int, int] = {}       # rank -> the gap left of its column
        self.top_channel: dict[int, int] = {}      # row -> y of its top channel's first lane
        self.bottom_channel: dict[int, int] = {}   # row -> y of its bottom channel's first lane

    def row(self, nid: str) -> int:
        return self.row_of_rank[self.rank[nid]]


def _row_heights(by_rank: dict[int, list[str]], sizes, rows) -> list[int]:
    out = []
    for cols in rows:
        h = 0
        for r in cols:
            nodes = by_rank.get(r, [])
            h = max(h, sum(sizes[n][1] for n in nodes) + _V_GAP * max(0, len(nodes) - 1))
        out.append(h)
    return out


def _pick_rows(widths: list[int], gaps: list[int], by_rank, sizes,
               crossings: list[int]) -> list[list[int]]:
    """The row split that prints the diagram legibly on the target page:
    one row when that already prints the labels at _LEGIBLE_PT, else the
    number of rows that prints them largest. A row ends only where the
    fewest edges cross from one row to the next (usually one: the flow goes
    on in the next row), so no branch or loop is cut in two when it can be
    kept whole; a split that cannot keep them allows the next fewest."""
    levels = sorted(set(crossings))
    best, best_scale = None, -1.0
    for n in range(1, min(len(widths), _MAX_ROWS) + 1):
        rows = None
        for limit in (levels if n > 1 else [None]):
            allowed = None if limit is None else {c for c, k in enumerate(crossings) if k <= limit}
            rows = _split_rows(widths, gaps, n, allowed)
            if rows:
                break
        if not rows:
            continue
        w = (max(_row_width([widths[c] for c in cols], [gaps[c] for c in cols]) for cols in rows)
             + 2 * _MARGIN + _H_GAP)
        h = sum(_row_heights(by_rank, sizes, rows)) + len(rows) * 2 * _CHANNEL + 2 * _MARGIN
        scale = min(_PAGE_W_PT / w, _PAGE_H_PT / h)     # printed points per unit
        if n == 1 and scale * _LABEL_PX >= _LEGIBLE_PT:
            return rows
        if scale > best_scale * 1.02:      # a clearly larger print wins; ties keep fewer rows
            best, best_scale = rows, scale
    return best or [list(range(len(widths)))]


def _lanes(layout: "_Layout", edges: list[tuple[str, str, str]]) -> dict[str, tuple[str, int, int]]:
    """For each edge that runs through a channel: (channel, row, lane). A
    forward edge that skips a column or wraps to a later row runs through its
    source row's bottom channel; a back-edge (a loop) through its source row's
    top channel. An edge between neighbouring columns of one row needs none."""
    out: dict[str, tuple[str, int, int]] = {}
    used: dict[tuple[str, int], int] = {}
    ordered = sorted(edges, key=lambda e: (layout.rank[e[1]], layout.rank[e[2]], e[0]))
    for fid, s, t in ordered:
        rs, rt = layout.rank[s], layout.rank[t]
        row_s, row_t = layout.row(s), layout.row(t)
        if row_s == row_t and rt == rs + 1:
            continue
        channel = "bottom" if rt > rs else "top"
        lane = used.get((channel, row_s), 0)
        used[(channel, row_s)] = lane + 1
        out[fid] = (channel, row_s, lane)
    return out


def _layout_full(node_ids: list[str], edges: list[tuple[str, str]],
                 sizes: dict[str, tuple[int, int]],
                 lanes_hint: dict[tuple[str, int], int] | None = None,
                 splits: set[str] | None = None) -> _Layout:
    """Hierarchical left-to-right layout, wrapped into rows.

    1. Rank nodes into columns by longest path over the acyclic forward
       edges (_ranks).
    2. Split the columns into consecutive rows (_pick_rows): one row for a
       short flow, more rows for a long one, whichever prints the diagram
       largest on a landscape page.
    3. Within a row, columns sit left to right; a column's nodes are stacked
       and centred on the row. Each row has a channel above and below it for
       the edges that cannot go straight to their target (loops, skips, the
       step from the end of one row to the start of the next).
    `lanes_hint` is how many edges each (channel, row) carries, so every
    channel is tall enough for its lanes. `splits` are the nodes whose
    outgoing flows are named (the branching gateways): the gap after their
    column is wide enough for the names."""
    lay = _Layout()
    lay.rank = _ranks(node_ids, edges)
    by_rank: dict[int, list[str]] = {}
    for nid in node_ids:
        by_rank.setdefault(lay.rank[nid], []).append(nid)
    ranks = sorted(by_rank)
    # Columns are the ranks that hold nodes, in order; rank numbers can skip.
    index = {r: i for i, r in enumerate(ranks)}
    widths = [max(sizes[n][0] for n in by_rank[r]) for r in ranks]
    splits = splits or set()
    gaps = [_SPLIT_GAP if any(n in splits for n in by_rank[r]) else _H_GAP for r in ranks]
    crossings = [0] * max(0, len(ranks) - 1)
    for src, tgt in edges:
        if src in lay.rank and tgt in lay.rank:
            a, b = index[lay.rank[src]], index[lay.rank[tgt]]
            for c in range(min(a, b), max(a, b)):
                crossings[c] += 1
    by_col = {i: by_rank[r] for r, i in index.items()}
    rows = _pick_rows(widths, gaps, by_col, sizes, crossings)
    heights = _row_heights(by_col, sizes, rows)
    lanes_hint = lanes_hint or {}

    y = _MARGIN
    for row_no, (cols, row_h) in enumerate(zip(rows, heights)):
        top_h = _CHANNEL + _LANE * max(0, lanes_hint.get(("top", row_no), 0) - 1)
        bottom_h = _CHANNEL + _LANE * max(0, lanes_hint.get(("bottom", row_no), 0) - 1)
        lay.top_channel[row_no] = y + _CHANNEL // 2
        y += top_h
        x = _MARGIN + _H_GAP // 2
        before = _H_GAP
        for c in cols:
            r = ranks[c]
            lay.row_of_rank[r] = row_no
            col_w = widths[c]
            lay.col_left[r], lay.col_right[r] = x, x + col_w
            lay.gap_before[r], lay.gap_after[r] = before, gaps[c]
            before = gaps[c]
            nodes = by_rank[r]
            col_h = sum(sizes[n][1] for n in nodes) + _V_GAP * (len(nodes) - 1)
            ny = y + (row_h - col_h) // 2
            for nid in nodes:
                w, h = sizes[nid]
                lay.pos[nid] = (x + (col_w - w) // 2, ny, w, h)
                ny += h + _V_GAP
            x += col_w + gaps[c]
        y += row_h
        lay.bottom_channel[row_no] = y + _CHANNEL // 2
        y += bottom_h
    return lay


def _layout(node_ids: list[str],
            edges: list[tuple[str, str]],
            sizes: dict[str, tuple[int, int]]) -> dict[str, tuple[int, int, int, int]]:
    """{ node_id: (x, y, w, h) }: top-left corner and size of every node
    (see _layout_full). Adequate for the inductive-miner output sizes (under
    ~50 nodes) and good enough for bpmn-js or a BPMN tool to render without
    further layout work."""
    return _layout_full(node_ids, edges, sizes).pos


def _waypoints(lay: _Layout, lane: tuple[str, int, int] | None,
               s: str, t: str, named: bool = False) -> list[tuple[int, int]]:
    """The bends of one edge, from the source's right side to the target's
    left side. Between neighbouring columns of a row: straight, or one
    elbow in the gap between them (close to the source for a named branch,
    so its name fits on the last stretch). Otherwise out into the gap right
    of the source's column, along the channel (the edge's lane; a bottom
    channel's lines sit right of the gap's middle, a top channel's left of
    it, so they do not overlap), and into the gap left of the target's
    column: the line never crosses a node's box."""
    sx, sy, sw, sh = lay.pos[s]
    tx, ty, tw, th = lay.pos[t]
    scy, tcy = sy + sh // 2, ty + th // 2
    rs, rt = lay.rank[s], lay.rank[t]
    if lane is None:
        if scy == tcy:
            return [(sx + sw, scy), (tx, tcy)]
        xm = lay.col_right[rs] + (16 if named else lay.gap_after[rs] // 2)
        return [(sx + sw, scy), (xm, scy), (xm, tcy), (tx, tcy)]
    channel, row, n = lane
    offset = (1 if channel == "bottom" else -1) * (3 + 6 * min(n, 4))
    ox = lay.col_right[rs] + lay.gap_after[rs] // 2 + offset
    ix = lay.col_left[rt] - lay.gap_before[rt] // 2 + offset
    cy = (lay.bottom_channel if channel == "bottom" else lay.top_channel)[row] + n * _LANE
    return [(sx + sw, scy), (ox, scy), (ox, cy), (ix, cy), (ix, tcy), (tx, tcy)]


def _label_bounds(points: list[tuple[int, int]],
                  lane: tuple[str, int, int] | None) -> tuple[int, int, int, int]:
    """Where a branch's name sits: above the last stretch into its target
    (straight or one elbow), or beside the drop into its channel, on the
    channel's open side (below a bottom channel's line, above a top
    channel's), clear of the row's boxes. The box is two lines tall
    (_BRANCH_LABEL_H) and ends 4 px above a line it sits over, 2 px beside a
    channel's line."""
    above = _BRANCH_LABEL_H + 4
    if len(points) == 2:
        x, y = points[0][0] + 6, points[0][1] - above
    elif len(points) == 4:
        x, y = points[2][0] + 4, points[2][1] - above
    else:
        below = lane is not None and lane[0] == "bottom"
        x, y = points[1][0] + 6, points[2][1] + (2 if below else -(_BRANCH_LABEL_H + 2))
    return x, y, _BRANCH_LABEL_W, _BRANCH_LABEL_H


def export_bpmn(bpmn_obj, out_path: str, *,
                documentation: dict | None = None,
                flow_names: dict | None = None) -> None:
    """Serialize a BPMN 2.0 file with a computed BPMNDI layout.

    PM4Py's built-in `write_bpmn` invokes Graphviz `dot` to compute
    BPMNDI coordinates, which makes BPMN export a hard binary
    dependency we can't rely on (IT-locked machines). This emits the
    semantic process plus a hierarchical layout, wrapped into rows
    (_layout_full) with every edge routed around the boxes (_waypoints),
    computed in pure Python: enough for bpmn-js to render and a BPMN tool
    to import without re-layout.

    `documentation` maps a node (the pm4py object's id()) to the text of its
    <bpmn:documentation>; `flow_names` maps a flow (its id()) to the name
    its <bpmn:sequenceFlow> carries.
    """
    documentation = documentation or {}
    flow_names = flow_names or {}
    ET.register_namespace("bpmn", _BPMN_NS)
    ET.register_namespace("bpmndi", _BPMNDI_NS)
    ET.register_namespace("dc", _DC_NS)
    ET.register_namespace("di", _DI_NS)
    ET.register_namespace("xsi", _XSI_NS)
    defs = ET.Element(
        f"{{{_BPMN_NS}}}definitions",
        {
            "id": "Definitions_1",
            "targetNamespace": "http://process-discovery-tracker/bpmn",
        },
    )
    proc = ET.SubElement(
        defs,
        f"{{{_BPMN_NS}}}process",
        {"id": "Process_1", "isExecutable": "false"},
    )

    nodes = list(bpmn_obj.get_nodes())
    flows = list(bpmn_obj.get_flows())

    # Stable id per node so flows can reference them.
    node_id: dict[int, str] = {}
    node_cls: dict[str, str] = {}
    for i, n in enumerate(nodes):
        name = n.get_name() if hasattr(n, "get_name") else ""
        nid = _safe_id("node", i, name)
        node_id[id(n)] = nid
        node_cls[nid] = type(n).__name__

    # First pass: resolve every flow's (id, src, tgt) so we can attach
    # <bpmn:incoming>/<bpmn:outgoing> children to each flow node. BPMN
    # 2.0 requires each flowNode to declare which sequence flows enter
    # and leave it -- bpmn-js emits a parse warning per missing pair
    # if these references are absent.
    flow_records: list[tuple[str, str, str, str]] = []
    incoming: dict[str, list[str]] = {nid: [] for nid in node_id.values()}
    outgoing: dict[str, list[str]] = {nid: [] for nid in node_id.values()}
    for i, f in enumerate(flows):
        src, tgt = f.get_source(), f.get_target()
        if id(src) not in node_id or id(tgt) not in node_id:
            continue
        sid, tid = node_id[id(src)], node_id[id(tgt)]
        fid = f"flow_{i}"
        name = flow_names.get(id(f))
        flow_records.append((fid, sid, tid, name if isinstance(name, str) else ""))
        outgoing[sid].append(fid)
        incoming[tid].append(fid)

    for n in nodes:
        # A pm4py subclass takes the element of its nearest mapped base class:
        # the miner ends its model with a NormalEndEvent (an EndEvent), which an
        # exact class-name lookup wrote as a task named "end".
        tag = next((_NODE_TAG[k.__name__] for k in type(n).__mro__
                    if k.__name__ in _NODE_TAG), "task")
        nid = node_id[id(n)]
        attrs = {"id": nid}
        name = n.get_name() if hasattr(n, "get_name") else ""
        if name:
            attrs["name"] = name
        node_el = ET.SubElement(proc, f"{{{_BPMN_NS}}}{tag}", attrs)
        # BPMN spec order: <documentation>, then <incoming> before <outgoing>.
        text = documentation.get(id(n))
        if isinstance(text, str) and text.strip():
            doc_el = ET.SubElement(node_el, f"{{{_BPMN_NS}}}documentation")
            doc_el.text = text.strip()
        for fid in incoming[nid]:
            inc = ET.SubElement(node_el, f"{{{_BPMN_NS}}}incoming")
            inc.text = fid
        for fid in outgoing[nid]:
            out = ET.SubElement(node_el, f"{{{_BPMN_NS}}}outgoing")
            out.text = fid

    for fid, sid, tid, name in flow_records:
        attrs = {"id": fid, "sourceRef": sid, "targetRef": tid}
        if name:
            attrs["name"] = name
        ET.SubElement(proc, f"{{{_BPMN_NS}}}sequenceFlow", attrs)

    # ---- BPMNDI layout ----
    sizes = {nid: _shape_size(node_cls[nid]) for nid in node_id.values()}
    edge_list = [(s, t) for (_, s, t, _n) in flow_records]
    ids = list(node_id.values())
    splits = {sid for (_f, sid, _t, name) in flow_records if name}
    # Route once to count each channel's lanes, then lay out with channels
    # tall enough for them and route for real.
    draft = _layout_full(ids, edge_list, sizes, splits=splits)
    lanes = _lanes(draft, [(fid, s, t) for (fid, s, t, _n) in flow_records])
    counts: dict[tuple[str, int], int] = {}
    for channel, row, _lane in lanes.values():
        counts[(channel, row)] = counts.get((channel, row), 0) + 1
    lay = _layout_full(ids, edge_list, sizes, lanes_hint=counts, splits=splits)

    diagram = ET.SubElement(
        defs, f"{{{_BPMNDI_NS}}}BPMNDiagram", {"id": "BPMNDiagram_1"})
    plane = ET.SubElement(
        diagram, f"{{{_BPMNDI_NS}}}BPMNPlane",
        {"id": "BPMNPlane_1", "bpmnElement": "Process_1"})

    for nid in node_id.values():
        x, y, w, h = lay.pos[nid]
        shape = ET.SubElement(
            plane, f"{{{_BPMNDI_NS}}}BPMNShape",
            {"id": f"Shape_{nid}", "bpmnElement": nid})
        ET.SubElement(shape, f"{{{_DC_NS}}}Bounds",
                      {"x": str(x), "y": str(y), "width": str(w), "height": str(h)})

    for fid, sid, tid, name in flow_records:
        edge = ET.SubElement(
            plane, f"{{{_BPMNDI_NS}}}BPMNEdge",
            {"id": f"Edge_{fid}", "bpmnElement": fid})
        points = _waypoints(lay, lanes.get(fid), sid, tid, named=bool(name))
        for px, py in points:
            ET.SubElement(edge, f"{{{_DI_NS}}}waypoint", {"x": str(px), "y": str(py)})
        if name:
            lx, ly, lw, lh = _label_bounds(points, lanes.get(fid))
            label = ET.SubElement(edge, f"{{{_BPMNDI_NS}}}BPMNLabel")
            ET.SubElement(label, f"{{{_DC_NS}}}Bounds",
                          {"x": str(lx), "y": str(ly), "width": str(lw), "height": str(lh)})

    tree = ET.ElementTree(defs)
    if hasattr(ET, "indent"):
        ET.indent(tree, space="  ")
    tree.write(out_path, xml_declaration=True, encoding="utf-8")
