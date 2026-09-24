"""Process mining + BPMN export (§8).

Wraps PM4Py's inductive miner and serializes its BPMN with a pure-Python
layout, wrapped into rows so a long flow prints legibly on a page, with
what contract C18 puts beside the tasks (their kinds and colours, notes,
data objects and a legend), and (contract C19) one plane per map: a
sub-process's map is written inside its collapsed bpmn:subProcess and drawn
in a diagram of its own (_Plane). The step-level observed-flow BPMN
(bpmn_observed.py) is the only caller.
"""

from __future__ import annotations

import math
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
# bpmn-js's colour attributes on a shape (bioc:fill, bioc:stroke); other
# tools ignore them.
_BIOC_NS = "http://bpmn.io/schema/bpmn/biocolor/1.0"

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

# With room for labels (export_bpmn label_room: the flow the analyst sets on
# steps, contract C17, names flows with sentences): the gap after a branching
# column holds a 90 px label at its left, and the lines that run through the
# gap keep to its right part (_ROUTE_ZONE wide).
_LABEL_GAP = 156
_ROUTE_ZONE = 36
# bpmn-js draws a flow's name in 11 px Arial at a line height of 1.2, wrapped
# at 90 px, from the top left of a box at least 90 px wide around the label
# bounds' centre: a 90 px wide label box is where the text is drawn.
_LABEL_WRAP = 90
_LABEL_LINE = 13.2
_LABEL_CLEAR = 3   # the least room between a label and a box, a line or a label
# Arial's advance widths, in thousandths of an em, of the printable ASCII
# characters from space (32) to tilde (126); another character counts as
# 1000, wider than any of them, so a label's height is never underestimated.
_ARIAL = (278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
          556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
          278, 278, 584, 584, 584, 556, 1015,
          667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
          722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
          278, 278, 278, 469, 556, 333,
          556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
          556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
          334, 260, 334, 584)

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

# Contract C18: what sits beside a task. Its notes are a text annotation above
# it, level with its left side, which bpmn-js writes in 12 px Arial, 7 px in
# from its edges, 14.4 px a line; the association rises from the task's top
# into the note's bracket, through the gap below the note. Its attached files
# are data objects (36 x 50 in bpmn-js) under it, side by side, each with its
# name under it (an 11 px label at most 90 px wide), the data association
# rising from each to the task's bottom. A named event has its name under it,
# a little below its thick circle. The layout keeps room for all of them in
# the node's column (_layout_full above, below, min_width).
_NOTE_W = 140
_NOTE_PAD = 7
_NOTE_LINE = 14.4
_NOTE_GAP = 16
_NOTE_HOOK = 10    # the association meets the end of the bracket's lower hook
_DATA_W = 36
_DATA_H = 50
_DATA_SLOT = 96
_DATA_GAP = 16
_EVENT_NAME_GAP = 3   # an end event's thick circle reaches 2 px below its box
_LEGEND_GAP = 24   # between the diagram and a legend beside or under it
_LEGEND_CLEAR = 12
_LEGEND_STEP = 24


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
        self.label_after: set[int] = set()         # ranks whose right gap holds labels
        self.label_before: set[int] = set()        # ranks whose left gap holds labels
        self.row_band: dict[int, tuple[int, int]] = {}   # row -> (top, bottom) of its nodes' band

    def row(self, nid: str) -> int:
        return self.row_of_rank[self.rank[nid]]


def _column_core(nodes: list[str], sizes, above: dict, below: dict) -> int:
    """The height of a column's core: its nodes stacked 30 px apart, with the
    notes above and the data objects or names below the nodes that have
    another node above or below them (contract C18)."""
    h = sum(sizes[n][1] for n in nodes) + _V_GAP * max(0, len(nodes) - 1)
    return h + sum(above.get(n, 0) for n in nodes[1:]) + sum(below.get(n, 0) for n in nodes[:-1])


def _row_band(by_col: dict[int, list[str]], sizes, cols: list[int],
              above: dict, below: dict) -> tuple[int, int, int]:
    """(T, C, B): a row's nodes' band. C is its tallest column core
    (_column_core), each core centred in it; T is what the first nodes'
    notes reach above C and B what the last nodes' data objects or names
    reach below it (contract C18: both 0 without them)."""
    cores = {c: _column_core(by_col.get(c, []), sizes, above, below) for c in cols}
    height = max(cores.values(), default=0)
    top = bottom = 0
    for c in cols:
        nodes = by_col.get(c, [])
        if nodes:
            start = (height - cores[c]) // 2
            top = max(top, above.get(nodes[0], 0) - start)
            bottom = max(bottom, start + cores[c] + below.get(nodes[-1], 0) - height)
    return top, height, bottom


def _row_heights(by_rank: dict[int, list[str]], sizes, rows,
                 above: dict | None = None, below: dict | None = None) -> list[int]:
    return [sum(_row_band(by_rank, sizes, cols, above or {}, below or {})) for cols in rows]


def _pick_rows(widths: list[int], gaps: list[int], by_rank, sizes,
               crossings: list[int], trade: bool = False,
               above: dict | None = None, below: dict | None = None) -> list[list[int]]:
    """The row split that prints the diagram legibly on the target page:
    one row when that already prints the labels at _LEGIBLE_PT, else the
    number of rows that prints them largest. A row ends only where the
    fewest edges cross from one row to the next (usually one: the flow goes
    on in the next row), so no branch or loop is cut in two when it can be
    kept whole; a split that cannot keep them allows the next fewest. With
    `trade` (the flow the analyst sets: loops and skips that span most of
    the flow leave few such places) a split that lets more edges cross is
    taken when keeping them whole would print the diagram more than a tenth
    smaller. `above` and `below` are the room the notes, data objects and
    names beside the nodes take (contract C18, _row_band)."""
    levels = sorted(set(crossings))

    def scale_of(rows):
        w = (max(_row_width([widths[c] for c in cols], [gaps[c] for c in cols]) for cols in rows)
             + 2 * _MARGIN + _H_GAP)
        h = (sum(_row_heights(by_rank, sizes, rows, above, below))
             + len(rows) * 2 * _CHANNEL + 2 * _MARGIN)
        return min(_PAGE_W_PT / w, _PAGE_H_PT / h)     # printed points per unit

    best, best_scale = None, -1.0
    for n in range(1, min(len(widths), _MAX_ROWS) + 1):
        options = []
        for limit in (levels if n > 1 else [None]):
            allowed = None if limit is None else {c for c, k in enumerate(crossings) if k <= limit}
            rows = _split_rows(widths, gaps, n, allowed)
            if rows:
                options.append((rows, scale_of(rows)))
                if not trade:
                    break
        if not options:
            continue
        top = max(s for _r, s in options)
        rows, scale = next((r, s) for r, s in options if s >= 0.9 * top)
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
                 splits: set[str] | None = None,
                 label_room: bool = False,
                 above: dict[str, int] | None = None,
                 below: dict[str, int] | None = None,
                 min_width: dict[str, int] | None = None) -> _Layout:
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
    column is wide enough for the names. With `label_room` that gap holds a
    90 px label beside the lines through it (_LABEL_GAP, and _waypoints
    keeps those lines to its right part).

    Contract C18: `above` and `below` are the heights a node's note takes
    above it and its data objects or name take below it, and `min_width`
    the width its column needs for them. They stay inside the node's column,
    where no line runs (the lines keep to the gaps and the channels), and
    each row's band grows by what they reach beyond its nodes (_row_band)."""
    above, below, min_width = above or {}, below or {}, min_width or {}
    lay = _Layout()
    lay.rank = _ranks(node_ids, edges)
    by_rank: dict[int, list[str]] = {}
    for nid in node_ids:
        by_rank.setdefault(lay.rank[nid], []).append(nid)
    ranks = sorted(by_rank)
    # Columns are the ranks that hold nodes, in order; rank numbers can skip.
    index = {r: i for i, r in enumerate(ranks)}
    widths = [max(max(sizes[n][0], min_width.get(n, 0)) for n in by_rank[r]) for r in ranks]
    splits = splits or set()
    named = [any(n in splits for n in by_rank[r]) for r in ranks]
    split_gap = _LABEL_GAP if label_room else _SPLIT_GAP
    gaps = [split_gap if is_named else _H_GAP for is_named in named]
    if label_room:
        lay.label_after = {r for r, is_named in zip(ranks, named) if is_named}
    crossings = [0] * max(0, len(ranks) - 1)
    for src, tgt in edges:
        if src in lay.rank and tgt in lay.rank:
            a, b = index[lay.rank[src]], index[lay.rank[tgt]]
            for c in range(min(a, b), max(a, b)):
                crossings[c] += 1
    if label_room:
        # A join belongs with the step after it and a split with the step
        # before it: a row does not end between them when it can end
        # elsewhere (such a place counts one crossing more).
        ins = {n: 0 for n in node_ids}
        outs = {n: 0 for n in node_ids}
        for src, tgt in edges:
            if src in outs and tgt in ins:
                outs[src] += 1
                ins[tgt] += 1

        def all_gateways(r: int, degree: dict[str, int]) -> bool:
            return all(sizes[n] == (_GW_SIZE, _GW_SIZE) and degree[n] > 1 for n in by_rank[r])
        for c in range(len(crossings)):
            crossings[c] += int(all_gateways(ranks[c], ins) or all_gateways(ranks[c + 1], outs))
    by_col = {i: by_rank[r] for r, i in index.items()}
    rows = _pick_rows(widths, gaps, by_col, sizes, crossings, trade=label_room,
                      above=above, below=below)
    lanes_hint = lanes_hint or {}

    y = _MARGIN
    for row_no, cols in enumerate(rows):
        reach_above, core_h, reach_below = _row_band(by_col, sizes, cols, above, below)
        top_h = _CHANNEL + _LANE * max(0, lanes_hint.get(("top", row_no), 0) - 1)
        bottom_h = _CHANNEL + _LANE * max(0, lanes_hint.get(("bottom", row_no), 0) - 1)
        lay.top_channel[row_no] = y + _CHANNEL // 2
        y += top_h
        lay.row_band[row_no] = (y, y + reach_above + core_h + reach_below)
        x = _MARGIN + _H_GAP // 2
        before = _H_GAP
        before_named = False
        for c in cols:
            r = ranks[c]
            lay.row_of_rank[r] = row_no
            col_w = widths[c]
            lay.col_left[r], lay.col_right[r] = x, x + col_w
            lay.gap_before[r], lay.gap_after[r] = before, gaps[c]
            before = gaps[c]
            if before_named:
                lay.label_before.add(r)
            before_named = r in lay.label_after
            nodes = by_rank[r]
            ny = y + reach_above + (core_h - _column_core(nodes, sizes, above, below)) // 2
            for i, nid in enumerate(nodes):
                if i:
                    ny += above.get(nid, 0)
                w, h = sizes[nid]
                lay.pos[nid] = (x + (col_w - w) // 2, ny, w, h)
                ny += h + below.get(nid, 0) + _V_GAP
            x += col_w + gaps[c]
        y += reach_above + core_h + reach_below
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
    # In a gap that holds labels the lines keep to its right part, a top
    # channel's lines 3 px left of a bottom channel's, 6 px between lanes.
    zone = (0 if channel == "top" else 3) + 6 * min(n, 4) - _ROUTE_ZONE
    if rs in lay.label_after:
        ox = lay.col_right[rs] + lay.gap_after[rs] + zone
    if rt in lay.label_before:
        ix = lay.col_left[rt] + zone
    cy = (lay.bottom_channel if channel == "bottom" else lay.top_channel)[row] + n * _LANE
    return [(sx + sw, scy), (ox, scy), (ox, cy), (ix, cy), (ix, tcy), (tx, tcy)]


def _crosses_a_box(points: list[tuple[int, int]], lay: "_Layout", ends: tuple[str, str],
                   extra: list[tuple[int, int, int, int]] = ()) -> bool:
    """True when a stretch of the line runs through a box other than its
    ends, or through one of the `extra` boxes (contract C18: the notes, the
    data objects and the names beside the nodes)."""
    boxes = [box for nid, box in lay.pos.items() if nid not in ends] + list(extra)
    return any(_hits(box, a, b) for a, b in zip(points, points[1:]) for box in boxes)


def _vertex_route(lay: "_Layout", lane: tuple[str, int, int] | None, s: str, t: str,
                  gateways: set[str], used: set[tuple[str, str]],
                  extra: list[tuple[int, int, int, int]] = ()) -> list[tuple[int, int]] | None:
    """With room for labels: the route of a flow that turns up or down,
    leaving a gateway from its top or bottom corner and entering a gateway
    at its top or bottom corner, so the flows of a gateway part at the
    gateway rather than running bundled beside it, and a name can sit by
    its own line. A corner takes one flow (`used`); an end that cannot use
    one keeps its side (_waypoints). Both corners are tried first, then the
    source's, then the target's; a route that would run through a box (or
    one of the `extra` boxes, contract C18) is not taken. None for a level
    flow or when no route is left."""
    sx, sy, sw, sh = lay.pos[s]
    tx, ty, tw, th = lay.pos[t]
    scx, scy, tcx, tcy = sx + sw // 2, sy + sh // 2, tx + tw // 2, ty + th // 2
    options: list[tuple[list[tuple[int, int]], list[tuple[str, str]]]] = []
    if lane is None:
        if scy == tcy:
            return None
        side = "top" if tcy < scy else "bottom"
        back = "bottom" if side == "top" else "top"
        # A corner is used only when the other end lies beyond it: a line
        # from a corner never turns back through its own gateway.
        if (s in gateways and (s, side) not in used
                and (tcy < sy if side == "top" else tcy > sy + sh)):
            options.append(([(scx, sy if side == "top" else sy + sh), (scx, tcy), (tx, tcy)],
                            [(s, side)]))
        if (t in gateways and (t, back) not in used
                and (scy < ty if back == "top" else scy > ty + th)):
            options.append(([(sx + sw, scy), (tcx, scy), (tcx, ty if back == "top" else ty + th)],
                            [(t, back)]))
    else:
        full = _waypoints(lay, lane, s, t)
        cy = full[2][1]
        s_side = "bottom" if cy > scy else "top"
        t_side = "bottom" if cy > tcy else "top"
        leave = ([(scx, sy + sh if s_side == "bottom" else sy), (scx, cy)]
                 if s in gateways and (s, s_side) not in used else None)
        enter = ([(tcx, cy), (tcx, ty + th if t_side == "bottom" else ty)]
                 if t in gateways and (t, t_side) not in used else None)
        if leave and enter:
            options.append((leave + enter, [(s, s_side), (t, t_side)]))
        if leave:
            options.append((leave + full[3:], [(s, s_side)]))
        if enter:
            options.append((full[:3] + enter, [(t, t_side)]))
    for pts, corners in options:
        pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
        if not _crosses_a_box(pts, lay, (s, t), extra):
            used.update(corners)
            return pts
    return None


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


def _text_px(text: str, size: int = 11) -> float:
    """The width of `text` in bpmn-js's `size` px Arial (11 px for a name
    outside a shape, 12 px in a text annotation), a tenth wider for the
    rounding of small type, so a text is never taken for narrower than it
    prints."""
    per_unit = 0.0121 if size == 11 else size * 0.0011
    return sum(_ARIAL[ord(c) - 32] if 32 <= ord(c) <= 126 else 1000 for c in text) * per_unit


def _wrap(text: str, wrap: float, size: int = 11) -> list[float]:
    """The widths of the lines bpmn-js makes of `text`: each of its lines (a
    line break is kept) wrapped between words at `wrap` px, a word wider
    than a line taking the lines it needs (_text_px widths)."""
    out: list[float] = []
    space = _text_px(" ", size)
    for part in text.split("\n"):
        width, lines = 0.0, []
        for word in part.split():
            w = _text_px(word, size)
            if width and width + space + w <= wrap:
                width += space + w
                continue
            if width:
                lines.append(width)
            while w > wrap:
                lines.append(float(wrap))
                w -= wrap
            width = w
        if width or not lines:
            lines.append(width)
        out += lines
    return out


def _label_height(text: str) -> int:
    """The height of a flow's name in bpmn-js: its words wrapped at 90 px (a
    word wider than a line takes the lines it needs), 13.2 px a line."""
    return math.ceil(len(_wrap(text, _LABEL_WRAP)) * _LABEL_LINE + 1.6)


def _label_size(text: str) -> tuple[int, int]:
    """(width, height) of a name bpmn-js writes under a shape (an event's, a
    data object's): its widest line wrapped at 90 px, and _label_height."""
    return min(_LABEL_WRAP, math.ceil(max(_wrap(text, _LABEL_WRAP)))), _label_height(text)


def _note_size(text: str, width: int = _NOTE_W) -> tuple[int, int]:
    """(width, height) of a text annotation `width` px wide holding `text`:
    its lines wrapped inside the padding, 14.4 px a line, and the padding
    above and below."""
    lines = len(_wrap(text, width - 2 * _NOTE_PAD, 12))
    return width, math.ceil(lines * _NOTE_LINE + 2 * _NOTE_PAD)


def _legend_size(text: str) -> tuple[int, int]:
    """(width, height) of the legend's text annotation: as wide as its
    longest line (each line one entry, none wrapped) and as tall as its
    lines (_note_size)."""
    widest = max(_text_px(line, 12) for line in text.split("\n"))
    return _note_size(text, math.ceil(widest) + 2 * _NOTE_PAD + 4)


def _hits(box: tuple[float, float, float, float],
          a: tuple[float, float], b: tuple[float, float]) -> bool:
    """True when the straight stretch a to b runs through `box` (x, y, w, h)."""
    bx, by, bw, bh = box
    return (min(a[0], b[0]) < bx + bw and max(a[0], b[0]) > bx
            and min(a[1], b[1]) < by + bh and max(a[1], b[1]) > by)


def _overlap(p: tuple[float, float, float, float], q: tuple[float, float, float, float]) -> bool:
    return p[0] < q[0] + q[2] and q[0] < p[0] + p[2] and p[1] < q[1] + q[3] and q[1] < p[1] + p[3]


def _spots(points: list[tuple[int, int]], w: int, h: int,
           below_first: bool) -> list[tuple[int, int]]:
    """Where a flow's name may sit (top left corners), in the order tried:
    beside each stretch of its line, from the stretch that leaves its source
    on, so a branch's name stays by the gateway it leaves. Beside a level
    stretch: above it before below it (below first for a line in a bottom
    channel, the channel's open side), from the end the line leaves by on,
    every 24 px. Beside an upright stretch: right of it before left of it,
    from the end the line leaves by on, every 24 px."""
    out: list[tuple[int, int]] = []
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        if y1 == y2:
            n = abs(x2 - x1)
            if x2 >= x1:
                xs = [x1 + 6, x1 + 20] + [x1 + 6 + k for k in range(24, n, 24)] + [x2 - w - 6]
            else:
                xs = [x1 - w - 6, x1 - w - 20] + [x1 - w - 6 - k for k in range(24, n, 24)] + [x2 + 6]
            ys = (y1 + 4, y1 - h - 4) if below_first else (y1 - h - 4, y1 + 4)
            out += [(x, y) for y in ys for x in dict.fromkeys(xs + [(x1 + x2 - w) // 2])]
        else:
            n = abs(y2 - y1)
            if y2 >= y1:
                ys = [y1 + 6] + [y1 + 6 + k for k in range(24, n, 24)] + [y2 - h - 6]
            else:
                ys = [y1 - h - 6] + [y1 - h - 6 - k for k in range(24, n, 24)] + [y2 + 6]
            ys = list(dict.fromkeys(ys + [(y1 + y2 - h) // 2]))
            out += [(x, y) for x in (x1 + 6, x1 - w - 6) for y in ys]
    return out


def _event_label(box: tuple[int, int, int, int], name: str) -> tuple[int, int, int, int]:
    """The room an event's name takes under it, kept clear by the flows'
    names: from the event's bottom, centred in a 90 px box, as tall as the
    gap above the name (C18) and its wrapped lines."""
    x, y, w, h = box
    return (x + w // 2 - _LABEL_WRAP // 2, y + h, _LABEL_WRAP,
            _EVENT_NAME_GAP + _label_height(name))


def _touches(box: tuple[float, float, float, float], clear: int, boxes, labels,
             stretches) -> int:
    """How badly `box`, grown by `clear` px on every side, meets what is
    drawn: 10000 for each box it covers, 100 for each label, 1 for each line
    it crosses (0: it is clear)."""
    x, y, w, h = box
    grown = (x - clear, y - clear, w + 2 * clear, h + 2 * clear)
    return (10000 * sum(_overlap(grown, b) for b in boxes)
            + 100 * sum(_overlap(grown, p) for p in labels)
            + sum(_hits(grown, a, b) for a, b in stretches))


def _place_labels(lay: _Layout, records: list[tuple[str, str, str, str]],
                  routes: dict[str, list[tuple[int, int]]],
                  lanes: dict[str, tuple[str, int, int]],
                  taken: list[tuple[int, int, int, int]] | None = None,
                  boxes: list[tuple[int, int, int, int]] = (),
                  lines: list[tuple[tuple[int, int], tuple[int, int]]] = (),
                  first: dict[str, tuple[int, int, int, int]] | None = None,
                  ) -> dict[str, tuple[int, int, int, int]]:
    """{flow id: label bounds} for every named flow, in flow order: the first
    of its spots (_spots) that keeps _LABEL_CLEAR px from every box, every
    line (its own included), every label placed before it and every box in
    `taken` (the events' names); when no spot is clear, the one that covers
    the fewest boxes, then the fewest labels, then crosses the fewest lines.
    A label is 90 px wide (bpmn-js draws the text from its left, wrapped at
    90 px) and as tall as its wrapped lines (_label_height).

    Contract C18: `boxes` and `lines` are what else is drawn (the notes, the
    data objects, the names beside the nodes and their associations), kept
    clear the same way. A flow's spot in `first` (a mined map's fixed place,
    _label_bounds) is kept when it touches nothing drawn."""
    boxes = list(lay.pos.values()) + list(boxes)
    stretches = [s for pts in routes.values() for s in zip(pts, pts[1:])] + list(lines)
    placed: dict[str, tuple[int, int, int, int]] = {}
    others = list(taken or [])
    for fid, _sid, _tid, name in records:
        if not name:
            continue
        spot = (first or {}).get(fid)
        if spot is not None and not _touches(spot, 0, boxes, list(placed.values()) + others,
                                             stretches):
            placed[fid] = spot
            continue
        w, h = _LABEL_WRAP, _label_height(name)
        lane = lanes.get(fid)
        best, fewest = None, None
        for x, y in _spots(routes[fid], w, h, lane is not None and lane[0] == "bottom"):
            touched = _touches((x, y, w, h), _LABEL_CLEAR, boxes,
                               list(placed.values()) + others, stretches)
            if fewest is None or touched < fewest:
                best, fewest = (x, y, w, h), touched
                if touched == 0:
                    break
        placed[fid] = best
    return placed


def _place_legend(size: tuple[int, int], boxes, stretches) -> tuple[int, int, int, int]:
    """Where the legend sits (contract C18): inside the diagram when there is
    room, the lowest place (then the rightmost) that keeps _LEGEND_CLEAR px
    from every box, name and line, tried every _LEGEND_STEP px from the
    bottom right corner; else beside the diagram or under it, whichever
    prints the diagram larger on a landscape page (under it on a tie)."""
    w, h = size
    points = [p for s in stretches for p in s]
    left = min([b[0] for b in boxes] + [p[0] for p in points])
    top = min([b[1] for b in boxes] + [p[1] for p in points])
    right = max([b[0] + b[2] for b in boxes] + [p[0] for p in points])
    bottom = max([b[1] + b[3] for b in boxes] + [p[1] for p in points])
    left, top, right, bottom = (int(v) for v in (left, top, right, bottom))
    for y in range(bottom - h, top - 1, -_LEGEND_STEP):
        for x in range(right - w, left - 1, -_LEGEND_STEP):
            if not _touches((x, y, w, h), _LEGEND_CLEAR, boxes, [], stretches):
                return x, y, w, h

    def scale(box):
        width = max(right, box[0] + w) - min(left, box[0])
        height = max(bottom, box[1] + h) - min(top, box[1])
        return min(_PAGE_W_PT / width, _PAGE_H_PT / height)
    under = (left, bottom + _LEGEND_GAP, w, h)
    beside = (right + _LEGEND_GAP, top, w, h)
    return beside if scale(beside) > scale(under) else under


def _beside(lay: _Layout, note_sizes: dict[str, tuple[int, int]],
            data_names: dict[str, list[tuple[str, str, str, tuple[int, int]]]],
            event_names: dict[str, tuple[int, int]]):
    """Where contract C18's elements sit once the nodes are placed:
    ({task id: note box}, {task id: association points}, {data key: (task
    id, box, name box, association points)}, {event id: name box}). A note
    sits _NOTE_GAP above its task, level with its left side, the
    association rising straight from the task's top into the end of the
    note bracket's lower hook. The data objects of a task sit side by side
    under it, centred, _DATA_GAP below it, each name centred under its
    object, each data association rising from the object's top to the
    task's bottom (straight up when the object is under the task). An
    event's name is centred under it, _EVENT_NAME_GAP below it."""
    notes, note_lines, data, events = {}, {}, {}, {}
    for nid, (w, h) in note_sizes.items():
        tx, ty, _tw, _th = lay.pos[nid]
        notes[nid] = (tx, ty - _NOTE_GAP - h, w, h)
        note_lines[nid] = [(tx + _NOTE_HOOK, ty), (tx + _NOTE_HOOK, ty - _NOTE_GAP)]
    for nid, objects in data_names.items():
        tx, ty, tw, th = lay.pos[nid]
        left = tx + tw // 2 - (len(objects) * _DATA_SLOT - (_DATA_SLOT - _LABEL_WRAP)) // 2
        oy = ty + th + _DATA_GAP
        for k, (key, _name, _doc, (lw, lh)) in enumerate(objects):
            ocx = left + k * _DATA_SLOT + _LABEL_WRAP // 2
            end = min(max(ocx, tx + 12), tx + tw - 12)
            data[key] = (nid, (ocx - _DATA_W // 2, oy, _DATA_W, _DATA_H),
                         (ocx - lw // 2, oy + _DATA_H, lw, lh), [(ocx, oy), (end, ty + th)])
    for nid, (lw, lh) in event_names.items():
        x, y, w, h = lay.pos[nid]
        events[nid] = (x + w // 2 - lw // 2, y + h + _EVENT_NAME_GAP, lw, lh)
    return notes, note_lines, data, events


def _bounds(parent, box) -> None:
    x, y, w, h = box
    ET.SubElement(parent, f"{{{_DC_NS}}}Bounds",
                  {"x": str(x), "y": str(y), "width": str(w), "height": str(h)})


def _waypoints_of(parent, points) -> None:
    for px, py in points:
        ET.SubElement(parent, f"{{{_DI_NS}}}waypoint", {"x": str(px), "y": str(py)})


def export_bpmn(bpmn_obj, out_path: str, *,
                documentation: dict | None = None,
                flow_names: dict | None = None,
                label_room: bool = False,
                task_tags: dict | None = None,
                colours: dict | None = None,
                notes: dict | None = None,
                data: dict | None = None,
                legend: str | None = None,
                sub_planes: dict | None = None) -> None:
    """Serialize a BPMN 2.0 file with a computed BPMNDI layout.

    PM4Py's built-in `write_bpmn` invokes Graphviz `dot` to compute
    BPMNDI coordinates, which makes BPMN export a hard binary
    dependency we can't rely on (IT-locked machines). This emits the
    semantic process plus a hierarchical layout, wrapped into rows
    (_layout_full) with every edge routed around the boxes (_waypoints),
    computed in pure Python: enough for bpmn-js to render and a BPMN tool
    to import without re-layout.

    `documentation` maps a node or a flow (the object's id()) to the text of
    its <bpmn:documentation>; `flow_names` maps a flow (its id()) to the name
    its <bpmn:sequenceFlow> carries. `label_room` is for names that are
    sentences (the flow the analyst sets on steps, contract C17): the gap
    after a branching column is wide enough for a 90 px label beside the
    lines through it, and each name sits where it keeps clear of every box,
    line and other name (_place_labels). Without it a name keeps its fixed
    place (_label_bounds), sized for "N of M transactions", unless something
    drawn is there; then it moves the same way.

    Contract C18, each keyed by a task (its id()): `task_tags` its element
    ("userTask", "manualTask"; else by its class); `colours` its (fill,
    stroke), written as bpmn-js's bioc:fill and bioc:stroke; `notes` its
    (text, whole text or None): a text annotation above it, joined by an
    association, the whole text its documentation when the shown one was
    cut; `data` its [(key, name, documentation)]: a data object reference
    each (ids DataObjectReference_<key> and DataObject_<key>) under it,
    joined by a data input association (the task holds it, with the
    property BPMN 2.0 wants as its target). `legend` is the text of one
    more text annotation that no association joins (_place_legend). Every
    element has its place on the diagram, and a named event its name's:
    the layout keeps room for them all (_layout_full), and the lines and
    the flows' names keep clear of them.

    Contract C19: `sub_planes` maps a task (its id()) that stands for a
    sub-process to that sub-process's own map: a dict with its "model", the
    keyword arguments above for it (its own "sub_planes" too, at any depth)
    and "prefix", the text every id of its plane starts with, unique in the
    file. Such a task (tagged "subProcess" in `task_tags`) is written as a
    collapsed bpmn:subProcess, named, documented, coloured and joined to its
    notes and files like a task, task sized, its shape isExpanded="false";
    it holds the map's model, drawn in a BPMNDiagram of its own whose
    plane's bpmnElement is the sub-process (_Plane). A task tagged
    "subProcess" without an entry is a collapsed sub-process with nothing
    in it (a label on several tasks holds its map on the first). The main
    plane keeps its ids, and a file without a sub-process is written as it
    was before sub-processes.
    """
    ET.register_namespace("bpmn", _BPMN_NS)
    ET.register_namespace("bpmndi", _BPMNDI_NS)
    ET.register_namespace("dc", _DC_NS)
    ET.register_namespace("di", _DI_NS)
    ET.register_namespace("xsi", _XSI_NS)
    ET.register_namespace("bioc", _BIOC_NS)
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
    main = _Plane(bpmn_obj, "", documentation=documentation, flow_names=flow_names,
                  label_room=label_room, task_tags=task_tags, colours=colours,
                  notes=notes, data=data, legend=legend, sub_planes=sub_planes)
    # C19: each sub-process's plane, depth first, with the id of the
    # sub-process its diagram draws.
    planes: list[tuple[_Plane, str]] = []
    main.emit(proc, planes)
    main.draw(defs, "Process_1")
    for plane, element in planes:
        plane.draw(defs, element)

    tree = ET.ElementTree(defs)
    if hasattr(ET, "indent"):
        ET.indent(tree, space="  ")
    tree.write(out_path, xml_declaration=True, encoding="utf-8")


# The keyword arguments of export_bpmn a sub-process's map carries (C19).
_PLANE_KEYS = ("documentation", "flow_names", "label_room", "task_tags", "colours",
               "notes", "data", "legend", "sub_planes")


class _Plane:
    """One map of the file: the main process or (contract C19) a
    sub-process's own map. It resolves its model's ids, its flows and what
    contract C18 puts beside its tasks (__init__), writes its elements into
    the process or the sub-process that holds them (emit), and lays out and
    draws its diagram (draw). Every id is `prefix` plus the id the main
    plane gives the same element, so the main plane (prefix "") keeps its
    ids and a sub-process's are unique in the file."""

    def __init__(self, bpmn_obj, prefix: str = "", *, documentation=None, flow_names=None,
                 label_room=False, task_tags=None, colours=None, notes=None, data=None,
                 legend=None, sub_planes=None):
        self.prefix = prefix
        self.documentation = documentation or {}
        flow_names = flow_names or {}
        self.label_room = label_room
        self.task_tags, self.colours = task_tags or {}, colours or {}
        notes, data = notes or {}, data or {}
        self.legend = legend
        self.sub_planes = sub_planes or {}
        # C19: the sub-processes drawn collapsed on this plane.
        self.collapsed: set[str] = set()
        self.nodes = list(bpmn_obj.get_nodes())
        flows = list(bpmn_obj.get_flows())

        # Stable id per node so flows can reference them.
        self.node_id: dict[int, str] = {}
        self.node_cls: dict[str, str] = {}
        for i, n in enumerate(self.nodes):
            name = n.get_name() if hasattr(n, "get_name") else ""
            nid = _safe_id("node", i, name)
            self.node_id[id(n)] = nid
            self.node_cls[nid] = type(n).__name__

        # First pass: resolve every flow's (id, src, tgt) so we can attach
        # <bpmn:incoming>/<bpmn:outgoing> children to each flow node. BPMN
        # 2.0 requires each flowNode to declare which sequence flows enter
        # and leave it: bpmn-js emits a parse warning per missing pair if
        # these references are absent.
        self.flow_records: list[tuple[str, str, str, str]] = []
        self.flow_docs: dict[str, str] = {}
        self.incoming: dict[str, list[str]] = {nid: [] for nid in self.node_id.values()}
        self.outgoing: dict[str, list[str]] = {nid: [] for nid in self.node_id.values()}
        for i, f in enumerate(flows):
            src, tgt = f.get_source(), f.get_target()
            if id(src) not in self.node_id or id(tgt) not in self.node_id:
                continue
            sid, tid = self.node_id[id(src)], self.node_id[id(tgt)]
            fid = f"flow_{i}"
            name = flow_names.get(id(f))
            self.flow_records.append((fid, sid, tid, name if isinstance(name, str) else ""))
            text = self.documentation.get(id(f))
            if isinstance(text, str) and text.strip():
                self.flow_docs[fid] = text.strip()
            self.outgoing[sid].append(fid)
            self.incoming[tid].append(fid)

        # C18: what each task and each named event has beside it, and the room
        # it takes (_layout_full above, below, min_width).
        self.note_sizes: dict[str, tuple[int, int]] = {}
        self.note_text: dict[str, tuple[str, str | None]] = {}
        self.data_names: dict[str, list[tuple[str, str, str, tuple[int, int]]]] = {}
        self.event_names: dict[str, tuple[int, int]] = {}
        self.above: dict[str, int] = {}
        self.below: dict[str, int] = {}
        self.min_width: dict[str, int] = {}
        for n in self.nodes:
            nid = self.node_id[id(n)]
            name = n.get_name() if hasattr(n, "get_name") else ""
            if id(n) in notes and notes[id(n)][0]:
                self.note_text[nid] = notes[id(n)]
                self.note_sizes[nid] = _note_size(notes[id(n)][0])
                self.above[nid] = self.note_sizes[nid][1] + _NOTE_GAP
                # The note starts at the task's left side; the task is centred
                # in its column, which holds the note's width right of that.
                half = _shape_size(self.node_cls[nid])[0] // 2
                self.min_width[nid] = 2 * max(half, self.note_sizes[nid][0] - half)
            if data.get(id(n)):
                objects = [(key, dname, ddoc, _label_size(dname)) for key, dname, ddoc in data[id(n)]]
                self.data_names[nid] = objects
                self.below[nid] = _DATA_GAP + _DATA_H + max(size[1] for *_rest, size in objects)
                self.min_width[nid] = max(self.min_width.get(nid, 0),
                                          len(objects) * _DATA_SLOT - (_DATA_SLOT - _LABEL_WRAP))
            if "Event" in self.node_cls[nid] and name:
                self.event_names[nid] = _label_size(name)
                self.below[nid] = _EVENT_NAME_GAP + self.event_names[nid][1]
                self.min_width[nid] = max(_EVENT_SIZE, self.event_names[nid][0])
        self.note_ids = {nid: f"TextAnnotation_{k}" for k, nid in enumerate(self.note_text, start=1)}

    def _pid(self, raw: str) -> str:
        """An id of this plane: its prefix, then the main plane's id."""
        return self.prefix + raw

    def emit(self, parent, planes: list) -> None:
        """Write this plane's elements into `parent` (the process, or the
        sub-process that holds this map): the flow nodes, the sequence
        flows, the data objects, then the artifacts. A sub-process node
        holds its own map's elements (C19); its plane joins `planes`, with
        the sub-process's id, before the planes of its own sub-processes."""
        for n in self.nodes:
            # A pm4py subclass takes the element of its nearest mapped base class:
            # the miner ends its model with a NormalEndEvent (an EndEvent), which an
            # exact class-name lookup wrote as a task named "end".
            tag = self.task_tags.get(id(n)) or next((_NODE_TAG[k.__name__] for k in type(n).__mro__
                                                     if k.__name__ in _NODE_TAG), "task")
            nid = self.node_id[id(n)]
            attrs = {"id": self._pid(nid)}
            name = n.get_name() if hasattr(n, "get_name") else ""
            if name:
                attrs["name"] = name
            node_el = ET.SubElement(parent, f"{{{_BPMN_NS}}}{tag}", attrs)
            # BPMN spec order: <documentation>, then <incoming> before <outgoing>,
            # then an activity's properties and data input associations, then
            # (a sub-process) its flow elements and artifacts.
            text = self.documentation.get(id(n))
            if isinstance(text, str) and text.strip():
                doc_el = ET.SubElement(node_el, f"{{{_BPMN_NS}}}documentation")
                doc_el.text = text.strip()
            for fid in self.incoming[nid]:
                inc = ET.SubElement(node_el, f"{{{_BPMN_NS}}}incoming")
                inc.text = self._pid(fid)
            for fid in self.outgoing[nid]:
                out = ET.SubElement(node_el, f"{{{_BPMN_NS}}}outgoing")
                out.text = self._pid(fid)
            if nid in self.data_names:
                prop = self._pid(f"Property_{nid}")
                ET.SubElement(node_el, f"{{{_BPMN_NS}}}property",
                              {"id": prop, "name": "__targetRef_placeholder"})
                for key, *_rest in self.data_names[nid]:
                    assoc = ET.SubElement(node_el, f"{{{_BPMN_NS}}}dataInputAssociation",
                                          {"id": self._pid(f"DataInputAssociation_{key}")})
                    ET.SubElement(assoc, f"{{{_BPMN_NS}}}sourceRef").text = self._pid(
                        f"DataObjectReference_{key}")
                    ET.SubElement(assoc, f"{{{_BPMN_NS}}}targetRef").text = prop
            if tag == "subProcess":
                self.collapsed.add(nid)
                spec = self.sub_planes.get(id(n))
                if spec is not None:
                    child = _Plane(spec["model"], spec.get("prefix") or "",
                                   **{key: spec.get(key) for key in _PLANE_KEYS})
                    planes.append((child, self._pid(nid)))
                    child.emit(node_el, planes)

        for fid, sid, tid, name in self.flow_records:
            attrs = {"id": self._pid(fid), "sourceRef": self._pid(sid),
                     "targetRef": self._pid(tid)}
            if name:
                attrs["name"] = name
            flow_el = ET.SubElement(parent, f"{{{_BPMN_NS}}}sequenceFlow", attrs)
            if fid in self.flow_docs:
                ET.SubElement(flow_el, f"{{{_BPMN_NS}}}documentation").text = self.flow_docs[fid]

        # C18: the data objects (flow elements), then the artifacts: the notes,
        # the legend and the associations.
        for objects in self.data_names.values():
            for key, dname, ddoc, _size in objects:
                ET.SubElement(parent, f"{{{_BPMN_NS}}}dataObject",
                              {"id": self._pid(f"DataObject_{key}")})
                ref = ET.SubElement(parent, f"{{{_BPMN_NS}}}dataObjectReference",
                                    {"id": self._pid(f"DataObjectReference_{key}"), "name": dname,
                                     "dataObjectRef": self._pid(f"DataObject_{key}")})
                if ddoc:
                    ET.SubElement(ref, f"{{{_BPMN_NS}}}documentation").text = ddoc
        for nid, (shown, whole) in self.note_text.items():
            ann = ET.SubElement(parent, f"{{{_BPMN_NS}}}textAnnotation",
                                {"id": self._pid(self.note_ids[nid])})
            if whole:
                ET.SubElement(ann, f"{{{_BPMN_NS}}}documentation").text = whole
            ET.SubElement(ann, f"{{{_BPMN_NS}}}text").text = shown
        if self.legend:
            ann = ET.SubElement(parent, f"{{{_BPMN_NS}}}textAnnotation",
                                {"id": self._pid("TextAnnotation_legend")})
            ET.SubElement(ann, f"{{{_BPMN_NS}}}text").text = self.legend
        for k, nid in enumerate(self.note_text, start=1):
            ET.SubElement(parent, f"{{{_BPMN_NS}}}association",
                          {"id": self._pid(f"Association_{k}"), "associationDirection": "None",
                           "sourceRef": self._pid(nid), "targetRef": self._pid(self.note_ids[nid])})

    def draw(self, defs, element: str) -> None:
        """Lay out this plane and add its BPMNDiagram to `defs`, its plane
        drawing `element` (the process, or the sub-process whose map this
        is)."""
        nodes, node_id, node_cls = self.nodes, self.node_id, self.node_cls
        flow_records = self.flow_records
        sizes = {nid: _shape_size(node_cls[nid]) for nid in node_id.values()}
        edge_list = [(s, t) for (_, s, t, _n) in flow_records]
        ids = list(node_id.values())
        splits = {sid for (_f, sid, _t, name) in flow_records if name}
        room = {"above": self.above, "below": self.below, "min_width": self.min_width}
        label_room = self.label_room
        # Route once to count each channel's lanes, then lay out with channels
        # tall enough for them and route for real.
        draft = _layout_full(ids, edge_list, sizes, splits=splits, label_room=label_room, **room)
        lanes = _lanes(draft, [(fid, s, t) for (fid, s, t, _n) in flow_records])
        counts: dict[tuple[str, int], int] = {}
        for channel, row, _lane in lanes.values():
            counts[(channel, row)] = counts.get((channel, row), 0) + 1
        lay = _layout_full(ids, edge_list, sizes, lanes_hint=counts, splits=splits,
                           label_room=label_room, **room)
        note_boxes, note_lines, data_boxes, event_boxes = _beside(lay, self.note_sizes,
                                                                  self.data_names,
                                                                  self.event_names)
        extra = (list(note_boxes.values()) + [d[1] for d in data_boxes.values()]
                 + [d[2] for d in data_boxes.values()] + list(event_boxes.values()))
        extra_lines = [(a, b) for pts in list(note_lines.values()) + [d[3] for d in data_boxes.values()]
                       for a, b in zip(pts, pts[1:])]
        routes = {fid: _waypoints(lay, lanes.get(fid), sid, tid, named=bool(name))
                  for (fid, sid, tid, name) in flow_records}
        events = [_event_label(lay.pos[node_id[id(n)]], n.get_name()) for n in nodes
                  if "Event" in node_cls[node_id[id(n)]] and hasattr(n, "get_name") and n.get_name()]
        first = None
        if label_room:
            gateways = {nid for nid, cls in node_cls.items() if "Gateway" in cls}
            corners: set[tuple[str, str]] = set()
            for fid, sid, tid, _name in flow_records:
                routes[fid] = (_vertex_route(lay, lanes.get(fid), sid, tid, gateways, corners, extra)
                               or routes[fid])
        else:
            first = {fid: _label_bounds(routes[fid], lanes.get(fid))
                     for (fid, _s, _t, name) in flow_records if name}
        placed = _place_labels(lay, flow_records, routes, lanes, taken=events, boxes=extra,
                               lines=extra_lines, first=first)
        legend_box = None
        if self.legend:
            drawn = list(lay.pos.values()) + extra + list(placed.values())
            lines = [s for pts in routes.values() for s in zip(pts, pts[1:])] + extra_lines
            legend_box = _place_legend(_legend_size(self.legend), drawn, lines)

        diagram = ET.SubElement(
            defs, f"{{{_BPMNDI_NS}}}BPMNDiagram", {"id": self._pid("BPMNDiagram_1")})
        plane = ET.SubElement(
            diagram, f"{{{_BPMNDI_NS}}}BPMNPlane",
            {"id": self._pid("BPMNPlane_1"), "bpmnElement": element})

        colour_of = {node_id[key]: value for key, value in self.colours.items() if key in node_id}
        for nid in node_id.values():
            attrs = {"id": self._pid(f"Shape_{nid}"), "bpmnElement": self._pid(nid)}
            if nid in self.collapsed:
                # C19: a sub-process is drawn collapsed; its map is its own plane.
                attrs["isExpanded"] = "false"
            if nid in colour_of:
                fill, stroke = colour_of[nid]
                attrs[f"{{{_BIOC_NS}}}stroke"] = stroke
                attrs[f"{{{_BIOC_NS}}}fill"] = fill
            shape = ET.SubElement(plane, f"{{{_BPMNDI_NS}}}BPMNShape", attrs)
            _bounds(shape, lay.pos[nid])
            if nid in event_boxes:
                _bounds(ET.SubElement(shape, f"{{{_BPMNDI_NS}}}BPMNLabel"), event_boxes[nid])
        for key, (_nid, box, name_box, _line) in data_boxes.items():
            shape = ET.SubElement(plane, f"{{{_BPMNDI_NS}}}BPMNShape",
                                  {"id": self._pid(f"Shape_DataObjectReference_{key}"),
                                   "bpmnElement": self._pid(f"DataObjectReference_{key}")})
            _bounds(shape, box)
            _bounds(ET.SubElement(shape, f"{{{_BPMNDI_NS}}}BPMNLabel"), name_box)
        for nid, box in note_boxes.items():
            shape = ET.SubElement(plane, f"{{{_BPMNDI_NS}}}BPMNShape",
                                  {"id": self._pid(f"Shape_{self.note_ids[nid]}"),
                                   "bpmnElement": self._pid(self.note_ids[nid])})
            _bounds(shape, box)
        if legend_box is not None:
            shape = ET.SubElement(plane, f"{{{_BPMNDI_NS}}}BPMNShape",
                                  {"id": self._pid("Shape_TextAnnotation_legend"),
                                   "bpmnElement": self._pid("TextAnnotation_legend")})
            _bounds(shape, legend_box)

        for fid, sid, tid, name in flow_records:
            edge = ET.SubElement(
                plane, f"{{{_BPMNDI_NS}}}BPMNEdge",
                {"id": self._pid(f"Edge_{fid}"), "bpmnElement": self._pid(fid)})
            points = routes[fid]
            _waypoints_of(edge, points)
            if name:
                label = ET.SubElement(edge, f"{{{_BPMNDI_NS}}}BPMNLabel")
                _bounds(label, placed[fid])
        for k, nid in enumerate(self.note_text, start=1):
            edge = ET.SubElement(plane, f"{{{_BPMNDI_NS}}}BPMNEdge",
                                 {"id": self._pid(f"Edge_Association_{k}"),
                                  "bpmnElement": self._pid(f"Association_{k}")})
            _waypoints_of(edge, note_lines[nid])
        for key, (_nid, _box, _name_box, line) in data_boxes.items():
            edge = ET.SubElement(plane, f"{{{_BPMNDI_NS}}}BPMNEdge",
                                 {"id": self._pid(f"Edge_DataInputAssociation_{key}"),
                                  "bpmnElement": self._pid(f"DataInputAssociation_{key}")})
            _waypoints_of(edge, line)
