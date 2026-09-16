import { describe, expect, it } from "vitest";
import {
  CONDITION_QUESTIONS,
  CONDITION_QUESTIONNAIRE_INTRO,
  ELECTRO_QUESTIONS,
  HXI_COLUMN_OF_QUESTION,
  HXI_FACTOR_COLUMNS,
  HXI_QUESTIONS,
  hxiKeyRows,
  PXI_COLUMN_OF_QUESTION,
  PXI_ENGLISH,
  PXI_FACTOR_COLUMNS,
  PXI_QUESTIONS,
  PXI_QUESTIONS_BY_ID,
  pxiKeyRows,
  shuffledHxiOrder,
  shuffledPxiOrder
} from "../../src/protocol/questions.v1";

describe("HXI questionnaire definition", () => {
  it("defines 20 required HXI items, 6 PXI items and two trailing electro questions", () => {
    expect(HXI_QUESTIONS).toHaveLength(20);
    expect(HXI_QUESTIONS.every(question => question.required)).toBe(true);
    expect(ELECTRO_QUESTIONS.map(question => question.id)).toEqual(["comfort_electro", "pain_electro"]);
    expect(CONDITION_QUESTIONS).toHaveLength(28);
    // 顺序：HXI 20 → PXI 6 → 电刺激 2（电刺激题固定跟在最后）。
    expect(CONDITION_QUESTIONS.slice(20, 26)).toEqual(PXI_QUESTIONS);
    expect(CONDITION_QUESTIONS.slice(26)).toEqual(ELECTRO_QUESTIONS);
  });

  it("maps every HXI item to exactly one factor column, four per factor", () => {
    expect(HXI_FACTOR_COLUMNS).toHaveLength(20);
    const columns = HXI_QUESTIONS.map(question => HXI_COLUMN_OF_QUESTION[question.id]);
    expect(new Set(columns).size).toBe(20);
    // 配置顺序即因子顺序 AU→IN→RE→DI→HA，各 4 题。
    expect(columns).toEqual([...HXI_FACTOR_COLUMNS]);
    const factors = columns.map(column => column?.slice(4, 6));
    expect(new Set(factors)).toEqual(new Set(["AU", "IN", "RE", "DI", "HA"]));
    expect(factors.filter(f => f === "DI")).toHaveLength(4);
  });

  it("shuffles all 20 HXI ids exactly once without touching the electro pair", () => {
    const order = shuffledHxiOrder(() => 0); // 确定性随机源：每次交换到位置 0
    expect(order).toHaveLength(20);
    expect(new Set(order)).toEqual(new Set(HXI_QUESTIONS.map(question => question.id)));
    expect([...order, ...ELECTRO_QUESTIONS.map(question => question.id)]).toHaveLength(22);
  });

  it("uses the updated condition questionnaire intro", () => {
    expect(CONDITION_QUESTIONNAIRE_INTRO).toBe(
      "“触觉感受”指您刚刚通过设备体验到的触觉刺激。“其他感官”主要指当前游戏中的视觉和听觉体验。"
    );
  });

  it("keeps raw 1–7 scoring in the key rows and marks Discord as negative without transforming", () => {
    const rows = hxiKeyRows();
    expect(rows).toHaveLength(22);
    const discordRow = rows.find(row => row[0] === "HXI_DI3");
    expect(discordRow?.[4]).toBe("negative");
    expect(discordRow?.[8]).toContain("1–7 原始分");
    expect(discordRow?.[8]).toContain("8−x 反向计分");
    const autotelicsRow = rows.find(row => row[0] === "HXI_AU1");
    expect(autotelicsRow?.[8]).toBe("1–7 原始分");
    // 电刺激题固定排在对照表末尾。
    expect(rows.at(-1)?.[0]).toBe("pain_electro");
    expect(rows.at(-2)?.[0]).toBe("comfort_electro");
  });

  it("presents the official 2025 Chinese wording and English original in the key rows", () => {
    const rows = hxiKeyRows();
    const au1 = rows.find(row => row[0] === "HXI_AU1");
    expect(au1?.[2]).toBe("自目的愉悦性 Autotelics");
    expect(au1?.[6]).toBe("不考虑其功能，我觉得这些触觉感受是令人愉悦的。");
    expect(au1?.[7]).toBe("Regardless of function, I found the haptic sensations pleasant.");
    const ha1 = rows.find(row => row[0] === "HXI_HA1");
    expect(ha1?.[2]).toBe("协调性 Harmony");
    expect(ha1?.[6]).toBe("我感到这些触觉感受与其他感官之间是和谐一致的。");
    const di1 = rows.find(row => row[0] === "HXI_DI1");
    expect(di1?.[2]).toBe("失调感 Discord");
    expect(di1?.[6]).toBe("这些触觉感受似乎与其他感官之间缺乏协调。");
  });
});

describe("PXI excerpt questionnaire definition", () => {
  it("defines 6 required PXI items on a -3 to +3 scale with full anchor labels", () => {
    expect(PXI_QUESTIONS).toHaveLength(6);
    expect(PXI_QUESTIONS.every(question => question.required)).toBe(true);
    for (const question of PXI_QUESTIONS) {
      expect(question.response.kind).toBe("likert");
      if (question.response.kind !== "likert") continue;
      expect(question.response.min).toBe(-3);
      expect(question.response.max).toBe(3);
      expect(question.response.anchors).toEqual({
        [-3]: "非常不同意",
        [-2]: "不同意",
        [-1]: "有些不同意",
        [0]: "既不同意也不赞同 / 中立",
        [1]: "有些同意",
        [2]: "同意",
        [3]: "非常同意"
      });
    }
  });

  it("presents the approved Chinese wording and official English originals verbatim", () => {
    const chinese = PXI_QUESTIONS.map(question => question.prompt);
    expect(chinese).toEqual([
      "在游戏过程中，我几乎没有再注意到周围的环境。",
      "我沉浸在游戏中。",
      "我完全专注于游戏。",
      "我觉得自己很擅长玩这个游戏。",
      "在游戏过程中，我觉得自己很有能力完成游戏任务。",
      "在玩这个游戏时，我感到自己能够很好地掌握它。"
    ]);
    expect(PXI_ENGLISH["pxi_im1"]).toBe("I was no longer aware of my surroundings while I was playing.");
    expect(PXI_ENGLISH["pxi_ma3"]).toBe("I felt a sense of mastery playing this game.");
  });

  it("maps every PXI item to exactly one factor column, three per factor", () => {
    expect(PXI_FACTOR_COLUMNS).toEqual(["PXI_IM1", "PXI_IM2", "PXI_IM3", "PXI_MA1", "PXI_MA2", "PXI_MA3"]);
    const columns = PXI_QUESTIONS.map(question => PXI_COLUMN_OF_QUESTION[question.id]);
    expect(new Set(columns).size).toBe(6);
    expect(columns).toEqual([...PXI_FACTOR_COLUMNS]);
  });

  it("shuffles all 6 PXI ids exactly once without same-factor items adjacent", () => {
    const order = shuffledPxiOrder(() => 0);
    expect(order).toHaveLength(6);
    expect(new Set(order)).toEqual(new Set(PXI_QUESTIONS.map(question => question.id)));
    // 确定性随机源使 Fisher–Yates 全部交换到位置 0 → 200 次重试均失败 → 使用交替兜底顺序。
    expect(order).toEqual(["pxi_im1", "pxi_ma1", "pxi_im2", "pxi_ma2", "pxi_im3", "pxi_ma3"]);
    const factorOf = (id: string) => PXI_QUESTIONS_BY_ID[id]?.pxiFactor?.factor;
    for (let run = 0; run < 50; run++) {
      const candidate = shuffledPxiOrder();
      expect(new Set(candidate)).toEqual(new Set(PXI_QUESTIONS.map(question => question.id)));
      for (let i = 1; i < candidate.length; i++) {
        expect(factorOf(candidate[i - 1]!)).not.toBe(factorOf(candidate[i]!));
      }
    }
  });

  it("lists every PXI factor column with dimension, official item text and raw scoring", () => {
    const rows = pxiKeyRows();
    expect(rows).toHaveLength(6);
    const im1 = rows.find(row => row[0] === "PXI_IM1");
    expect(im1?.[2]).toBe("沉浸感 Immersion");
    expect(im1?.[4]).toBe("positive");
    expect(im1?.[5]).toBe("pxi_im1");
    expect(im1?.[6]).toBe("在游戏过程中，我几乎没有再注意到周围的环境。");
    expect(im1?.[7]).toBe("I was no longer aware of my surroundings while I was playing.");
    expect(im1?.[8]).toBe("-3–3 原始分");
    const ma3 = rows.find(row => row[0] === "PXI_MA3");
    expect(ma3?.[2]).toBe("掌控感 Mastery");
    expect(ma3?.[8]).toBe("-3–3 原始分");
  });
});
