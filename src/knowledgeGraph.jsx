import { useState, useRef, useEffect, useMemo } from "react";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   RISC-V 32I KNOWLEDGE GRAPH (UPDATED TO LATEST IMPLEMENTATION PLAN)
   Based on the latest implementation plan modules and dependencies.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

const MODULES = [
  {
    id: "RISCV32I",
    label: "RISC_V_32I",
    tier: 0,
    desc: "Top-level RISC-V 32I architecture node. This graph reflects the latest implementation plan and its module-level structure, dependencies, and inferred signal wiring.",
    spec: "Implementation Plan",
    params: [
      { name: "XLEN", value: "32", desc: "Integer register width" },
      { name: "NUM_REGS", value: "32", desc: "General-purpose registers" },
      { name: "ISA", value: "RV32I", desc: "Base integer ISA" },
    ],
    constraints: [
      "x0 is hardwired to zero",
      "Instruction width is 32 bits",
      "Program flow is driven through pc / next_pc updates",
    ],
    ranges: [{ name: "Address Space", min: "0x0000_0000", max: "0xFFFF_FFFF" }],
  },
  {
    id: "RegisterFile",
    label: "RegisterFile",
    tier: 1,
    desc: "Implements 32 general-purpose registers (x0 to x31) and a program counter (pc). Supports two reads and one write while preserving x0 as zero.",
    spec: "Section 2.1, Figure 2.1",
    params: [
      { name: "NUM_REGS", value: "32", desc: "Number of GPRs" },
      { name: "DATA_W", value: "32", desc: "Register width" },
      { name: "ADDR_W", value: "5", desc: "Register address width" },
    ],
    constraints: [
      "Writes to x0 must be ignored",
      "pc must track current instruction address",
      "Two independent read ports and one write port",
    ],
    ranges: [{ name: "Register Index", min: "0", max: "31" }],
  },
  {
    id: "InstructionDecoder",
    label: "InstructionDecoder",
    tier: 1,
    desc: "Decodes a 32-bit instruction into opcode, rd, rs1, rs2, funct3, immediate, and instruction_type across R/I/S/U/B/J formats.",
    spec: "Section 2.2, Figure 2.2",
    params: [
      { name: "INSTR_W", value: "32", desc: "Instruction width" },
      { name: "OPCODE_W", value: "7", desc: "Opcode width" },
      { name: "TYPE_W", value: "3", desc: "Instruction type encoding width" },
    ],
    constraints: [
      "Instruction must be 32 bits",
      "Immediate fields must be correctly packed per format",
      "Sign extension must follow the instruction format",
    ],
    ranges: [],
  },
  {
    id: "ImmediateGenerator",
    label: "ImmediateGenerator",
    tier: 1,
    desc: "Generates immediate_value from the instruction and instruction_type, including sign extension and left-shifted branch/jump offsets when required.",
    spec: "Section 2.3, Figure 2.3, Figure 2.4",
    params: [{ name: "OUT_W", value: "32", desc: "Immediate output width" }],
    constraints: [
      "I/S/B/U/J immediates must be reconstructed correctly",
      "B-type immediate must be shifted left by 1",
      "J-type immediate must be shifted left by 1",
      "U-type immediate must be shifted left by 12",
    ],
    ranges: [{ name: "Immediate Width", min: "32 bits", max: "32 bits" }],
  },
  {
    id: "ALU",
    label: "ALU",
    tier: 1,
    desc: "Performs arithmetic, logical, and shift operations using operand1, operand2, and alu_control. Produces result, zero_flag, and overflow_flag.",
    spec: "Section 2.4, Figures 2.3 and 2.4",
    params: [
      { name: "DATA_W", value: "32", desc: "Operand width" },
      { name: "CTRL_W", value: "4", desc: "ALU control width" },
    ],
    constraints: [
      "Overflow detection applies to arithmetic operations",
      "zero_flag is asserted when result equals zero",
      "Shift amount is derived from operand2",
    ],
    ranges: [{ name: "Shift Amount", min: "0", max: "31" }],
  },
  {
    id: "ControlUnit",
    label: "ControlUnit",
    tier: 2,
    desc: "Controls execution flow for jumps and branches. Computes next_pc, manages write_enable, and produces return_address for link-style control transfers.",
    spec: "Section 2.5, Table 2.1",
    params: [{ name: "PC_W", value: "32", desc: "Program counter width" }],
    constraints: [
      "JAL/JALR/branch control must update next_pc correctly",
      "Instruction-address misalignment must be handled",
      "return_address corresponds to current_pc + 4 when required",
    ],
    ranges: [{ name: "PC Width", min: "32 bits", max: "32 bits" }],
  },
  {
    id: "MemoryInterface",
    label: "MemoryInterface",
    tier: 2,
    desc: "Handles load/store operations, effective address usage, alignment checks, width-dependent access behavior, and exception propagation.",
    spec: "Section 2.6",
    params: [
      { name: "ADDR_W", value: "32", desc: "Address width" },
      { name: "DATA_W", value: "32", desc: "Data width" },
      { name: "WIDTH_W", value: "2", desc: "Load/store width selector" },
    ],
    constraints: [
      "Access alignment must respect selected width",
      "Load data must be sign-extended or zero-extended as required",
      "Exception output reflects misalignment or access failures",
    ],
    ranges: [{ name: "Access Width Code", min: "0", max: "3" }],
  },
  {
    id: "HintInstructionHandler",
    label: "HintInstructionHandler",
    tier: 2,
    desc: "Processes HINT instructions without changing architectural state. Can update performance tracking and advance next_pc for hint-style operations.",
    spec: "Section 2.9, Table 2.3",
    params: [{ name: "PC_W", value: "32", desc: "Program counter width" }],
    constraints: [
      "HINT instructions must not alter architectural state",
      "next_pc advances sequentially for no-op style hints",
      "Performance counter update is optional microarchitectural behavior",
    ],
    ranges: [],
  },
  {
    id: "VLIWSupport",
    label: "VLIWSupport",
    tier: 3,
    desc: "Supports VLIW-style multi-operation instruction handling using a 128-bit instruction bundle and parallel execution result collection.",
    spec: "Section 26.5",
    params: [
      { name: "VLIW_W", value: "128", desc: "VLIW instruction width" },
      { name: "COUNT_W", value: "4", desc: "Operation count width" },
    ],
    constraints: [
      "Multiple operations may execute in parallel",
      "Execution ordering must preserve original bundle semantics",
      "Status flags summarize multi-operation execution",
    ],
    ranges: [{ name: "Instruction Count", min: "0", max: "15" }],
  },
  {
    id: "ExtensionManager",
    label: "ExtensionManager",
    tier: 3,
    desc: "Manages machine-level instruction-set extensions by identifying extension instructions, checking enable state, and maintaining correct control flow.",
    spec: "Section 27.9",
    params: [{ name: "STATUS_W", value: "8", desc: "Extension status width" }],
    constraints: [
      "Extensions must remain compatible with the base ISA",
      "Illegal or disabled extensions must be flagged",
      "next_pc must remain valid after extension handling",
    ],
    ranges: [{ name: "Status Flags", min: "0", max: "255" }],
  },
];

const PORTS = {
  RISCV32I: {
    in: [
      "instruction (32-bit)",
      "vliw_instruction (128-bit)",
      "instruction_count (4-bit)",
      "extension_enable (1-bit)",
      "performance_counter (32-bit)",
    ],
    out: ["graph_root"],
  },
  RegisterFile: {
    in: [
      "read_addr1 (5-bit)",
      "read_addr2 (5-bit)",
      "write_addr (5-bit)",
      "write_data (32-bit)",
      "write_enable (1-bit)",
    ],
    out: ["read_data1 (32-bit)", "read_data2 (32-bit)", "pc (32-bit)"],
  },
  InstructionDecoder: {
    in: ["instruction (32-bit)"],
    out: [
      "opcode (7-bit)",
      "rd (5-bit)",
      "funct3 (3-bit)",
      "rs1 (5-bit)",
      "rs2 (5-bit)",
      "imm (32-bit)",
      "instruction_type (3-bit)",
    ],
  },
  ImmediateGenerator: {
    in: ["instruction (32-bit)", "instruction_type (3-bit)"],
    out: ["immediate_value (32-bit)"],
  },
  ALU: {
    in: ["operand1 (32-bit)", "operand2 (32-bit)", "alu_control (4-bit)"],
    out: ["result (32-bit)", "zero_flag (1-bit)", "overflow_flag (1-bit)"],
  },
  ControlUnit: {
    in: [
      "instruction (32-bit)",
      "current_pc (32-bit)",
      "branch_taken (1-bit)",
      "jump_target (32-bit)",
    ],
    out: ["next_pc (32-bit)", "write_enable (1-bit)", "return_address (32-bit)"],
  },
  MemoryInterface: {
    in: [
      "address (32-bit)",
      "data_in (32-bit)",
      "rs1 (5-bit)",
      "rs2 (5-bit)",
      "opcode (7-bit)",
      "load_store (1-bit)",
      "width (2-bit)",
      "exception (1-bit)",
    ],
    out: ["data_out (32-bit)", "exception_out (1-bit)"],
  },
  HintInstructionHandler: {
    in: [
      "instruction (32-bit)",
      "current_pc (32-bit)",
      "performance_counter (32-bit)",
    ],
    out: ["next_pc (32-bit)", "performance_counter_out (32-bit)"],
  },
  VLIWSupport: {
    in: ["vliw_instruction (128-bit)", "instruction_count (4-bit)"],
    out: ["execution_results (128-bit)", "status_flags (8-bit)"],
  },
  ExtensionManager: {
    in: [
      "instruction (32-bit)",
      "extension_enable (1-bit)",
      "current_pc (32-bit)",
    ],
    out: ["next_pc (32-bit)", "extension_status (8-bit)"],
  },
};

const INSTANCE_OF = [
  "RegisterFile",
  "InstructionDecoder",
  "ImmediateGenerator",
  "ALU",
  "ControlUnit",
  "MemoryInterface",
  "HintInstructionHandler",
  "VLIWSupport",
  "ExtensionManager",
];

const DEPENDS_ON = [
  { from: "InstructionDecoder", to: "RegisterFile" },
  { from: "ImmediateGenerator", to: "InstructionDecoder" },
  { from: "ALU", to: "ImmediateGenerator" },
  { from: "ControlUnit", to: "InstructionDecoder" },
  { from: "MemoryInterface", to: "ALU" },
  { from: "HintInstructionHandler", to: "ControlUnit" },
  { from: "VLIWSupport", to: "InstructionDecoder" },
  { from: "ExtensionManager", to: "InstructionDecoder" },
];

const CONNECTS = [
  { from: "RISCV32I", fp: "instruction (32-bit)", to: "InstructionDecoder", tp: "instruction (32-bit)", sig: "instruction_bus" },
  { from: "RISCV32I", fp: "instruction (32-bit)", to: "ImmediateGenerator", tp: "instruction (32-bit)", sig: "instruction_bus" },
  { from: "RISCV32I", fp: "instruction (32-bit)", to: "ControlUnit", tp: "instruction (32-bit)", sig: "instruction_bus" },
  { from: "RISCV32I", fp: "instruction (32-bit)", to: "HintInstructionHandler", tp: "instruction (32-bit)", sig: "instruction_bus" },
  { from: "RISCV32I", fp: "instruction (32-bit)", to: "ExtensionManager", tp: "instruction (32-bit)", sig: "instruction_bus" },
  { from: "RISCV32I", fp: "vliw_instruction (128-bit)", to: "VLIWSupport", tp: "vliw_instruction (128-bit)", sig: "vliw_instruction_bus" },
  { from: "RISCV32I", fp: "instruction_count (4-bit)", to: "VLIWSupport", tp: "instruction_count (4-bit)", sig: "vliw_count_bus" },
  { from: "RISCV32I", fp: "extension_enable (1-bit)", to: "ExtensionManager", tp: "extension_enable (1-bit)", sig: "extension_enable_sig" },
  { from: "RISCV32I", fp: "performance_counter (32-bit)", to: "HintInstructionHandler", tp: "performance_counter (32-bit)", sig: "perf_counter_bus" },

  { from: "InstructionDecoder", fp: "instruction_type (3-bit)", to: "ImmediateGenerator", tp: "instruction_type (3-bit)", sig: "instruction_type_bus" },
  { from: "InstructionDecoder", fp: "rs1 (5-bit)", to: "RegisterFile", tp: "read_addr1 (5-bit)", sig: "rs1_addr" },
  { from: "InstructionDecoder", fp: "rs2 (5-bit)", to: "RegisterFile", tp: "read_addr2 (5-bit)", sig: "rs2_addr" },
  { from: "InstructionDecoder", fp: "rd (5-bit)", to: "RegisterFile", tp: "write_addr (5-bit)", sig: "rd_addr" },

  { from: "RegisterFile", fp: "read_data1 (32-bit)", to: "ALU", tp: "operand1 (32-bit)", sig: "operand1_bus" },
  { from: "RegisterFile", fp: "read_data2 (32-bit)", to: "ALU", tp: "operand2 (32-bit)", sig: "operand2_bus_or_mux" },
  { from: "RegisterFile", fp: "pc (32-bit)", to: "ControlUnit", tp: "current_pc (32-bit)", sig: "pc_bus" },
  { from: "RegisterFile", fp: "pc (32-bit)", to: "HintInstructionHandler", tp: "current_pc (32-bit)", sig: "pc_bus" },
  { from: "RegisterFile", fp: "pc (32-bit)", to: "ExtensionManager", tp: "current_pc (32-bit)", sig: "pc_bus" },

  { from: "ImmediateGenerator", fp: "immediate_value (32-bit)", to: "ControlUnit", tp: "jump_target (32-bit)", sig: "jump_target_bus" },
  { from: "ImmediateGenerator", fp: "immediate_value (32-bit)", to: "ALU", tp: "operand2 (32-bit)", sig: "immediate_or_rs2_mux" },

  { from: "ALU", fp: "zero_flag (1-bit)", to: "ControlUnit", tp: "branch_taken (1-bit)", sig: "branch_taken_sig" },
  { from: "ALU", fp: "result (32-bit)", to: "MemoryInterface", tp: "address (32-bit)", sig: "effective_address_bus" },
  { from: "ALU", fp: "result (32-bit)", to: "RegisterFile", tp: "write_data (32-bit)", sig: "alu_writeback_bus" },

  { from: "ControlUnit", fp: "write_enable (1-bit)", to: "RegisterFile", tp: "write_enable (1-bit)", sig: "reg_write_enable" },
  { from: "ControlUnit", fp: "return_address (32-bit)", to: "RegisterFile", tp: "write_data (32-bit)", sig: "link_return_bus" },

  { from: "InstructionDecoder", fp: "rs1 (5-bit)", to: "MemoryInterface", tp: "rs1 (5-bit)", sig: "mem_rs1_idx" },
  { from: "InstructionDecoder", fp: "rs2 (5-bit)", to: "MemoryInterface", tp: "rs2 (5-bit)", sig: "mem_rs2_idx" },
  { from: "InstructionDecoder", fp: "opcode (7-bit)", to: "MemoryInterface", tp: "opcode (7-bit)", sig: "opcode_bus" },
  { from: "InstructionDecoder", fp: "funct3 (3-bit)", to: "MemoryInterface", tp: "width (2-bit)", sig: "mem_width_select" },
  { from: "RegisterFile", fp: "read_data2 (32-bit)", to: "MemoryInterface", tp: "data_in (32-bit)", sig: "store_data_bus" },
  { from: "MemoryInterface", fp: "data_out (32-bit)", to: "RegisterFile", tp: "write_data (32-bit)", sig: "memory_writeback_bus" },
];

/* ━━━ Layout ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const BW = 166,
  BH = 44,
  BW0 = 182,
  BH0 = 50,
  GAP = 30;
const TY = [48, 200, 392, 584];
const TL = ["TOP MODULE", "CORE STATE / DECODE / EXECUTION", "CONTROL / MEMORY / HINTS", "OPTIONAL / EXTENSION MODULES"];
const CX = 545;

function layout() {
  const tiers = [[], [], [], []];
  MODULES.forEach((m) => tiers[m.tier].push(m));
  const P = {};
  tiers.forEach((list, ti) => {
    const n = list.length,
      bw = ti === 0 ? BW0 : BW,
      bh = ti === 0 ? BH0 : BH;
    const tot = n * bw + (n - 1) * GAP;
    const x0 = CX - tot / 2;
    list.forEach((m, i) => {
      const x = x0 + i * (bw + GAP);
      P[m.id] = { x, y: TY[ti], w: bw, h: bh, cx: x + bw / 2, cy: TY[ti] + bh / 2, top: TY[ti], bot: TY[ti] + bh, l: x, r: x + bw };
    });
  });
  return P;
}

/* ━━━ Colors (light theme) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const TC = [
  { bg: "#eff6ff", border: "#2563eb", text: "#1e3a5f", sel: "#dbeafe" },
  { bg: "#f5f3ff", border: "#7c3aed", text: "#3b1f6e", sel: "#ede9fe" },
  { bg: "#faf5ff", border: "#9333ea", text: "#581c87", sel: "#f3e8ff" },
  { bg: "#f8fafc", border: "#64748b", text: "#334155", sel: "#f1f5f9" },
];
const EC = { INSTANCE_OF: "#94a3b8", DEPENDS_ON: "#e11d48", CONNECTS: "#0891b2" };

/* ━━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function KnowledgeGraph() {
  const [sel, setSel] = useState(null);
  const [hov, setHov] = useState(null);
  const [hovE, setHovE] = useState(null);
  const [tipData, setTipData] = useState(null);
  const [mode, setMode] = useState("hierarchy");
  const [search, setSearch] = useState("");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState(false);
  const dr = useRef({ x: 0, y: 0 });
  const svgRef = useRef(null);

  const P = useMemo(layout, []);
  const MM = useMemo(() => Object.fromEntries(MODULES.map((m) => [m.id, m])), []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e) => {
      e.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(4, z * (e.deltaY > 0 ? 0.93 : 1.07))));
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const onD = (e) => {
    if (e.button !== 0) return;
    setDrag(true);
    dr.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onM = (e) => {
    if (drag) setPan({ x: e.clientX - dr.current.x, y: e.clientY - dr.current.y });
  };
  const onU = () => setDrag(false);

  const fIds = useMemo(() => {
    if (!search) return new Set(MODULES.map((m) => m.id));
    const s = search.toLowerCase();
    return new Set(MODULES.filter((m) => m.label.toLowerCase().includes(s) || m.desc.toLowerCase().includes(s)).map((m) => m.id));
  }, [search]);

  const selMod = sel ? MM[sel] : null;

  function distribute(edges, getFromId, getToId, dir) {
    const fc = {},
      tc = {},
      fu = {},
      tu = {};
    edges.forEach((_, i) => {
      const f = getFromId(edges[i]),
        t = getToId(edges[i]);
      fc[f] = (fc[f] || 0) + 1;
      tc[t] = (tc[t] || 0) + 1;
    });
    return edges.map((e) => {
      const f = getFromId(e),
        t = getToId(e);
      if (!fu[f]) fu[f] = 0;
      if (!tu[t]) tu[t] = 0;
      const fi = fu[f]++,
        ti = tu[t]++;
      const fp = P[f],
        tp = P[t];
      if (!fp || !tp) return null;
      const pad = 14;
      const fU = fp.w - pad * 2,
        tU = tp.w - pad * 2;
      const fx = fp.l + pad + (fc[f] > 1 ? fi * (fU / (fc[f] - 1)) : fU / 2);
      const tx = tp.l + pad + (tc[t] > 1 ? ti * (tU / (tc[t] - 1)) : tU / 2);
      if (dir === "down") return { fx, fy: fp.bot, tx, ty: tp.top };
      if (dir === "up") return { fx, fy: fp.top, tx, ty: tp.bot };
      const fT = MM[f]?.tier ?? 0,
        tT = MM[t]?.tier ?? 0;
      const down = fT < tT || (fT === tT && fp.cx < tp.cx);
      return { fx, fy: down ? fp.bot : fp.top, tx, ty: down ? tp.top : tp.bot };
    });
  }

  const ioA = useMemo(() => distribute(INSTANCE_OF.map((id) => ({ from: "RISCV32I", to: id })), (e) => e.from, (e) => e.to, "down"), [P, MM]);
  const depA = useMemo(() => distribute(DEPENDS_ON, (e) => e.from, (e) => e.to, "up"), [P, MM]);
  const conA = useMemo(() => distribute(CONNECTS, (e) => e.from, (e) => e.to, "auto"), [P, MM]);

  function cPath(x1, y1, x2, y2) {
    const dy = y2 - y1;
    return `M${x1},${y1} C${x1},${y1 + dy * 0.42} ${x2},${y2 - dy * 0.42} ${x2},${y2}`;
  }

  function arrowPts(tx, ty, arrivesFromAbove) {
    const b = arrivesFromAbove ? -9 : 9;
    return `${tx},${ty} ${tx - 5},${ty + b} ${tx + 5},${ty + b}`;
  }

  function showTip(a, lines) {
    if (!a) return;
    setTipData({ x: (a.fx + a.tx) / 2, y: (a.fy + a.ty) / 2, lines });
  }

  function hideTip() {
    setTipData(null);
  }

  function renderEdges() {
    const els = [];

    if (mode === "hierarchy" || mode === "all") {
      INSTANCE_OF.forEach((cid, i) => {
        if (!fIds.has(cid)) return;
        const a = ioA[i];
        if (!a) return;
        const rel = sel === "RISCV32I" || sel === cid;
        const op = sel ? (rel ? 0.55 : 0.04) : 0.18;
        els.push(
          <g key={`io${i}`} onMouseEnter={() => { setHovE(`io${i}`); showTip(a, ["INSTANCE_OF", `RISC_V_32I  ▸  ${MM[cid]?.label}`]); }} onMouseLeave={() => { setHovE(null); hideTip(); }}>
            <path d={cPath(a.fx, a.fy, a.tx, a.ty)} fill="none" stroke="transparent" strokeWidth={14} />
            <path d={cPath(a.fx, a.fy, a.tx, a.ty)} fill="none" stroke={EC.INSTANCE_OF} strokeWidth={hovE === `io${i}` ? 2.2 : 1} opacity={hovE === `io${i}` ? 0.8 : op} />
            <circle cx={a.fx} cy={a.fy} r={2} fill={EC.INSTANCE_OF} opacity={op} />
            <polygon points={arrowPts(a.tx, a.ty, true)} fill={EC.INSTANCE_OF} opacity={hovE === `io${i}` ? 0.8 : op} />
          </g>
        );
      });

      DEPENDS_ON.forEach((d, i) => {
        if (!fIds.has(d.from) && !fIds.has(d.to)) return;
        const a = depA[i];
        if (!a) return;
        const rel = sel === d.from || sel === d.to;
        const isH = hovE === `dp${i}`;
        const op = sel ? (rel ? 0.85 : 0.04) : isH ? 1 : 0.28;
        els.push(
          <g key={`dp${i}`} onMouseEnter={() => { setHovE(`dp${i}`); showTip(a, ["DEPENDS_ON", `${MM[d.from]?.label}  depends on  ${MM[d.to]?.label}`]); }} onMouseLeave={() => { setHovE(null); hideTip(); }}>
            <path d={cPath(a.fx, a.fy, a.tx, a.ty)} fill="none" stroke="transparent" strokeWidth={14} />
            <path d={cPath(a.fx, a.fy, a.tx, a.ty)} fill="none" stroke={EC.DEPENDS_ON} strokeWidth={isH ? 2.5 : 1.2} strokeDasharray="8,4" opacity={op} />
            <circle cx={a.fx} cy={a.fy} r={2} fill={EC.DEPENDS_ON} opacity={op} />
            <polygon points={arrowPts(a.tx, a.ty, false)} fill={EC.DEPENDS_ON} opacity={op} />
          </g>
        );
      });
    }

    if (mode === "wiring" || mode === "all") {
      CONNECTS.forEach((c, i) => {
        if (!fIds.has(c.from) && !fIds.has(c.to)) return;
        const a = conA[i];
        if (!a) return;
        const rel = sel === c.from || sel === c.to;
        const isH = hovE === `cn${i}`;
        const op = sel ? (rel ? 0.85 : 0.03) : isH ? 1 : 0.16;
        const goesDown = a.ty > a.fy;
        els.push(
          <g key={`cn${i}`} onMouseEnter={() => { setHovE(`cn${i}`); showTip(a, [`${c.fp}  →  ${c.tp}`, c.sig]); }} onMouseLeave={() => { setHovE(null); hideTip(); }}>
            <path d={cPath(a.fx, a.fy, a.tx, a.ty)} fill="none" stroke="transparent" strokeWidth={14} />
            <path d={cPath(a.fx, a.fy, a.tx, a.ty)} fill="none" stroke={EC.CONNECTS} strokeWidth={isH ? 2.5 : 1} opacity={op} />
            <circle cx={a.fx} cy={a.fy} r={isH ? 3.5 : 2} fill={EC.CONNECTS} opacity={op} />
            <polygon points={arrowPts(a.tx, a.ty, goesDown)} fill={EC.CONNECTS} opacity={op} />
          </g>
        );
      });
    }
    return els;
  }

  function renderTooltip() {
    if (!tipData) return null;
    const { x, y, lines } = tipData;
    const w = 225,
      h = 14 + lines.length * 16,
      rx = 5;
    return (
      <g style={{ pointerEvents: "none" }}>
        <rect x={x - w / 2} y={y - h / 2 - 2} width={w} height={h} rx={rx} fill="white" stroke="#cbd5e1" strokeWidth={1} filter="url(#shadow)" />
        {lines.map((l, i) => (
          <text key={i} x={x} y={y - h / 2 + 14 + i * 16} textAnchor="middle" fill={i === 0 ? "#475569" : "#0891b2"} fontSize={i === 0 ? 9 : 10} fontWeight={i === 0 ? 600 : 700} fontFamily="inherit">
            {l}
          </text>
        ))}
      </g>
    );
  }

  function renderModules() {
    return MODULES.map((m) => {
      if (!fIds.has(m.id)) return null;
      const p = P[m.id],
        c = TC[m.tier];
      const isSel = sel === m.id,
        isHov = hov === m.id;
      const dim = sel && !isSel;
      const op = dim ? 0.12 : 1;
      return (
        <g key={m.id} onClick={(e) => { e.stopPropagation(); setSel(isSel ? null : m.id); }} onMouseEnter={() => setHov(m.id)} onMouseLeave={() => setHov(null)} style={{ cursor: "pointer" }}>
          {isSel && (
            <rect x={p.x - 4} y={p.y - 4} width={p.w + 8} height={p.h + 8} rx={10} fill="none" stroke={c.border} strokeWidth={2.5} opacity={0.3}>
              <animate attributeName="opacity" values=".15;.4;.15" dur="2.5s" repeatCount="indefinite" />
            </rect>
          )}
          {isHov && !isSel && <rect x={p.x - 2} y={p.y - 2} width={p.w + 4} height={p.h + 4} rx={8} fill="none" stroke={c.border} strokeWidth={1.2} opacity={0.2} />}
          <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={7} fill={isSel ? c.sel : c.bg} stroke={c.border} strokeWidth={isSel ? 2 : 1} opacity={op} />
          <text x={p.cx} y={p.cy + 1} textAnchor="middle" dominantBaseline="middle" fill={c.text} fontSize={m.tier === 0 ? 13 : 9.2} fontWeight={700} fontFamily="inherit" opacity={op}>
            {m.label}
          </text>
        </g>
      );
    });
  }

  function panel() {
    if (!selMod) {
      return (
        <>
          <Sec title="OVERVIEW">
            <SR l="Modules" v={MODULES.length} />
            <SR l="Total Ports" v={Object.values(PORTS).reduce((s, p) => s + p.in.length + p.out.length, 0)} />
            <SR l="INSTANCE_OF" v={INSTANCE_OF.length} c={EC.INSTANCE_OF} />
            <SR l="DEPENDS_ON" v={DEPENDS_ON.length} c={EC.DEPENDS_ON} />
            <SR l="CONNECTS" v={CONNECTS.length} c={EC.CONNECTS} />
          </Sec>

          <Sec title="EDGE LEGEND">
            <LL c={EC.INSTANCE_OF} l="INSTANCE_OF" n="Top-level contains module" />
            <LL c={EC.DEPENDS_ON} l="DEPENDS_ON" n="Implementation-plan dependency" d />
            <LL c={EC.CONNECTS} l="CONNECTS" n="Inferred signal wiring" />
          </Sec>

          <Sec title="IMPLEMENTATION PLAN SUMMARY">
            <div style={ntStyle}><span style={{ color: "#2563eb", fontWeight: 800 }}>CORE</span> — RegisterFile, InstructionDecoder, ImmediateGenerator, ALU</div>
            <div style={ntStyle}><span style={{ color: "#7c3aed", fontWeight: 800 }}>CONTROL</span> — ControlUnit, MemoryInterface, HintInstructionHandler</div>
            <div style={ntStyle}><span style={{ color: "#64748b", fontWeight: 800 }}>EXTENSIONS</span> — VLIWSupport, ExtensionManager</div>
          </Sec>

          <Sec title="KG NODE TYPES">
            <div style={ntStyle}><span style={{ color: "#2563eb", fontWeight: 800 }}>MODULE</span> — Planned hardware block</div>
            <div style={ntStyle}><span style={{ color: "#059669", fontWeight: 800 }}>PORT_IN</span> — Declared input port</div>
            <div style={ntStyle}><span style={{ color: "#d97706", fontWeight: 800 }}>PORT_OUT</span> — Declared output port</div>
            <div style={ntStyle}><span style={{ color: "#7c3aed", fontWeight: 800 }}>PARAM</span> — Width or configuration attribute</div>
            <div style={ntStyle}><span style={{ color: "#e11d48", fontWeight: 800 }}>CONSTRAINT</span> — Must-hold implementation rule</div>
            <div style={ntStyle}><span style={{ color: "#0891b2", fontWeight: 800 }}>RANGE</span> — Value or width bounds</div>
          </Sec>

          <p style={{ color: "#94a3b8", fontSize: 10, marginTop: 16, lineHeight: 1.6 }}>
            Click a module to inspect its ports, parameters, constraints, ranges, wiring, and dependency relations. Scroll to zoom and drag to pan.
          </p>
        </>
      );
    }

    const ports = PORTS[sel] || { in: [], out: [] };
    const c = TC[selMod.tier];
    const rc = CONNECTS.filter((x) => x.from === sel || x.to === sel);
    const rd = DEPENDS_ON.filter((x) => x.from === sel);
    const db = DEPENDS_ON.filter((x) => x.to === sel);

    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.border, boxShadow: `0 0 6px ${c.border}`, flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 800, color: c.border }}>{selMod.label}</span>
          <button onClick={() => setSel(null)} style={{ marginLeft: "auto", background: "none", border: "1px solid #e2e8f0", color: "#94a3b8", borderRadius: 3, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 9 }}>
            ✕
          </button>
        </div>

        <p style={{ color: "#475569", fontSize: 11, lineHeight: 1.6, margin: "0 0 6px" }}>{selMod.desc}</p>
        <div style={{ display: "inline-block", padding: "3px 8px", background: "#f1f5f9", borderRadius: 3, color: "#64748b", fontSize: 9, marginBottom: 12, letterSpacing: 0.5, border: "1px solid #e2e8f0" }}>
          SPEC: {selMod.spec}
        </div>

        {selMod.params?.length > 0 && (
          <Sec title={`PARAMETERS (${selMod.params.length})`} dot="#7c3aed">
            {selMod.params.map((p, i) => (
              <div key={i} style={{ ...tagBase, background: "#f5f3ff", borderColor: "#ddd6fe" }}>
                <span style={{ fontWeight: 800, color: "#7c3aed", minWidth: 72, fontSize: 10 }}>{p.name}</span>
                <span style={{ color: "#6d28d9", fontWeight: 700, fontSize: 11 }}>{p.value}</span>
                <span style={{ color: "#a78bfa", fontSize: 9, marginLeft: 4 }}>— {p.desc}</span>
              </div>
            ))}
          </Sec>
        )}

        {selMod.constraints?.length > 0 && (
          <Sec title={`CONSTRAINTS (${selMod.constraints.length})`} dot="#e11d48">
            {selMod.constraints.map((cText, i) => (
              <div key={i} style={{ ...tagBase, background: "#fff1f2", borderColor: "#fecdd3", color: "#9f1239", fontSize: 10 }}>
                {cText}
              </div>
            ))}
          </Sec>
        )}

        {selMod.ranges?.length > 0 && (
          <Sec title={`RANGES (${selMod.ranges.length})`} dot="#0891b2">
            {selMod.ranges.map((r, i) => (
              <div key={i} style={{ ...tagBase, background: "#ecfeff", borderColor: "#a5f3fc", display: "flex", gap: 8 }}>
                <span style={{ fontWeight: 700, color: "#0e7490", fontSize: 10 }}>{r.name}</span>
                <span style={{ color: "#155e75", fontSize: 10 }}>{r.min}{r.max ? ` … ${r.max}` : ""}</span>
              </div>
            ))}
          </Sec>
        )}

        <Sec title={`INPUTS (${ports.in.length})`} dot="#059669">
          {ports.in.map((p, i) => <PT key={i} l={p} t="in" />)}
        </Sec>

        <Sec title={`OUTPUTS (${ports.out.length})`} dot="#d97706">
          {ports.out.map((p, i) => <PT key={i} l={p} t="out" />)}
        </Sec>

        {rc.length > 0 && (
          <Sec title={`SIGNAL WIRING (${rc.length})`} dot="#0891b2">
            {rc.map((w, i) => (
              <div key={i} style={{ ...tagBase, background: "#ecfeff", borderColor: "#a5f3fc", lineHeight: 1.6 }}>
                <div style={{ display: "flex", gap: 4, fontSize: 10, color: "#334155" }}>
                  <span style={{ fontWeight: w.from === sel ? 700 : 500 }}>{MM[w.from]?.label}</span>
                  <span style={{ color: "#0891b2", fontWeight: 800 }}>→</span>
                  <span style={{ fontWeight: w.to === sel ? 700 : 500 }}>{MM[w.to]?.label}</span>
                </div>
                <div style={{ fontSize: 9, color: "#64748b" }}>
                  {w.fp} → {w.tp}
                  <span style={{ color: "#0891b2", marginLeft: 6, fontWeight: 600 }}>[{w.sig}]</span>
                </div>
              </div>
            ))}
          </Sec>
        )}

        {rd.length > 0 && (
          <Sec title="DEPENDS ON" dot="#e11d48">
            {rd.map((d, i) => (
              <div key={i} onClick={() => setSel(d.to)} style={{ ...tagBase, background: "#fff1f2", borderColor: "#fecdd3", color: "#9f1239", cursor: "pointer", fontSize: 10 }}>
                → {MM[d.to]?.label}
              </div>
            ))}
          </Sec>
        )}

        {db.length > 0 && (
          <Sec title="REQUIRED BY" dot="#7c3aed">
            {db.map((d, i) => (
              <div key={i} onClick={() => setSel(d.from)} style={{ ...tagBase, background: "#f5f3ff", borderColor: "#ddd6fe", color: "#6d28d9", cursor: "pointer", fontSize: 10 }}>
                ← {MM[d.from]?.label}
              </div>
            ))}
          </Sec>
        )}
      </>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#ffffff", display: "flex", flexDirection: "column", overflow: "hidden", color: "#1e293b", fontFamily: "'IBM Plex Mono','JetBrains Mono','Fira Code',ui-monospace,monospace" }}>
      <div style={{ padding: "10px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 14, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#2563eb", boxShadow: "0 0 8px #2563eb55" }} />
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 2, color: "#0f172a" }}>RISC-V 32I · KNOWLEDGE GRAPH</span>
        </div>

        <div style={{ display: "flex", gap: 2 }}>
          {[ ["hierarchy", "HIERARCHY"], ["wiring", "WIRING"], ["all", "ALL"] ].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, letterSpacing: 1, background: mode === k ? "#e2e8f0" : "transparent", border: `1px solid ${mode === k ? "#cbd5e1" : "#e2e8f0"}`, color: mode === k ? "#0f172a" : "#94a3b8", borderRadius: 4, cursor: "pointer", fontFamily: "inherit", transition: "all .15s" }}>
              {l}
            </button>
          ))}
        </div>

        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter modules…" style={{ padding: "5px 10px", fontSize: 11, background: "#ffffff", border: "1px solid #e2e8f0", color: "#1e293b", borderRadius: 4, outline: "none", width: 170, fontFamily: "inherit" }} />

        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 9, color: "#94a3b8" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={EC.INSTANCE_OF} strokeWidth="2" /></svg>INSTANCE_OF</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={EC.DEPENDS_ON} strokeWidth="2" strokeDasharray="4,2" /></svg>DEPENDS_ON</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke={EC.CONNECTS} strokeWidth="2" /></svg>CONNECTS</span>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <svg ref={svgRef} style={{ flex: 1, cursor: drag ? "grabbing" : "grab" }} onMouseDown={onD} onMouseMove={onM} onMouseUp={onU} onMouseLeave={onU} onClick={() => setSel(null)}>
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#00000018" />
            </filter>
          </defs>
          <rect width="100%" height="100%" fill="#ffffff" />
          <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {TL.map((label, i) => (
              <g key={i}>
                <line x1={10} x2={1080} y1={TY[i] - 20} y2={TY[i] - 20} stroke="#f1f5f9" strokeWidth={1} />
                <text x={16} y={TY[i] - 26} fill="#cbd5e1" fontSize={9} fontWeight={700} fontFamily="inherit" letterSpacing={2}>{label}</text>
              </g>
            ))}
            {renderEdges()}
            {renderModules()}
            {renderTooltip()}
          </g>
        </svg>

        <div style={{ width: 320, background: "#f8fafc", borderLeft: "1px solid #e2e8f0", overflowY: "auto", padding: 16, flexShrink: 0 }}>
          {panel()}
        </div>
      </div>
    </div>
  );
}

/* ━━━ Sub-components ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const tagBase = { padding: "5px 8px", marginBottom: 3, borderRadius: 4, border: "1px solid #e2e8f0", fontSize: 10, lineHeight: 1.5 };
const ntStyle = { fontSize: 10, color: "#475569", lineHeight: 2 };

function Sec({ title, children, dot }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, color: "#334155", fontSize: 10, letterSpacing: 1.5, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
        {dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
        {title}
      </div>
      {children}
    </div>
  );
}

function SR({ l, v, c }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 12, lineHeight: 2.2 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{c && <span style={{ width: 8, height: 3, background: c, display: "inline-block", borderRadius: 1 }} />}{l}</span>
      <span style={{ color: "#0f172a", fontWeight: 700 }}>{v}</span>
    </div>
  );
}

function LL({ c, l, n, d }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 10, lineHeight: 2.2 }}>
      <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={c} strokeWidth={2} strokeDasharray={d ? "5,3" : "none"} /></svg>
      <span style={{ color: c, fontWeight: 700, minWidth: 85 }}>{l}</span>
      <span style={{ color: "#94a3b8", fontSize: 9 }}>{n}</span>
    </div>
  );
}

function PT({ l, t }) {
  const isIn = t === "in";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", marginBottom: 3, background: isIn ? "#f0fdf4" : "#fffbeb", border: `1px solid ${isIn ? "#bbf7d0" : "#fde68a"}`, borderRadius: 4, fontSize: 10, color: isIn ? "#166534" : "#92400e" }}>
      <span style={{ fontSize: 7, color: isIn ? "#059669" : "#d97706", fontWeight: 900, letterSpacing: 0.5 }}>{isIn ? "IN" : "OUT"}</span>
      {l}
    </div>
  );
}
