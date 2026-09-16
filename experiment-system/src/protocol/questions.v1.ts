/**
 * 问卷定义，版本 1。
 * 所有面向参与者的措辞都放在这里——组件绝不内嵌题目文本。
 * 草稿措辞：未经伦理批准、非正式翻译。每个量表旁保留来源引用元数据。
 */

import { isAnswered } from "../domain/session";
import type { AnswerValue, ResponseSet } from "../domain/types";
import { CONDITION_EVENT_IDS } from "./conditions.v1";

export type QuestionSection = "condition" | "comparison" | "final" | "instruction" | "interview";

export type QuestionResponse =
  | { kind: "likert"; min: number; max: number; anchors: Record<number, string> }
  | { kind: "choice"; options: Array<{ value: string; label: string }> }
  | { kind: "text"; minLength: number; maxLength: number }
  | { kind: "boolean" };

export type Question = {
  id: string;
  section: QuestionSection;
  prompt: string;
  required: boolean;
  response: QuestionResponse;
  conditionScope?: "each-condition" | "after-both";
  /** 来源 / 引用说明，与量表一同保留。 */
  source?: string;
  /** HXI 因子归属（仅 HXI 题项有值）；界面不呈现，仅用于按因子导出。 */
  hxiFactor?: { factor: HxiFactorCode; item: number };
  /** PXI 因子归属（仅 PXI 节选题项有值）；界面不呈现，仅用于按因子导出。 */
  pxiFactor?: { factor: PxiFactorCode; item: number };
};

/** HXI 五因子代码。 */
export type HxiFactorCode = "AU" | "IN" | "RE" | "DI" | "HA";

/** PXI 节选两因子代码。 */
export type PxiFactorCode = "IM" | "MA";

export type ValidationResult = { valid: boolean; errors: Record<string, string> };

export function validateResponses(questions: readonly Question[], responses: ResponseSet): ValidationResult {
  const errors: Record<string, string> = {};
  for (const question of questions) {
    const value = responses[question.id];
    if (!isAnswered(value)) {
      if (question.required) errors[question.id] = "请回答本题。";
      continue;
    }
    switch (question.response.kind) {
      case "likert":
        if (
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < question.response.min ||
          value > question.response.max
        ) {
          errors[question.id] = `请选择 ${question.response.min} 到 ${question.response.max} 之间的整数。`;
        }
        break;
      case "choice":
        if (typeof value !== "string" || !question.response.options.some(option => option.value === value)) {
          errors[question.id] = "请选择其中一项。";
        }
        break;
      case "text":
        if (
          typeof value !== "string" ||
          value.trim().length < question.response.minLength ||
          value.length > question.response.maxLength
        ) {
          errors[question.id] = `请输入 ${question.response.minLength}–${question.response.maxLength} 个字符。`;
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") errors[question.id] = "请勾选复选框。";
        break;
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

const HXI_SOURCE = "HXI（Haptic Experience Inventory, 2025）官方中英文对照；中文文案严格按获批译本呈现，维度信息不呈现给参与者；正式使用前需确认许可与引用";
const DRAFT_ITEM_SOURCE = "研究团队自拟题目；正式使用前需核实措辞";

/** 量表前说明（展示在条件后问卷最上方）。 */
export const CONDITION_QUESTIONNAIRE_INTRO =
  "“触觉感受”指您刚刚通过设备体验到的触觉刺激。“其他感官”主要指当前游戏中的视觉和听觉体验。";

const likert7 = { kind: "likert" as const, min: 1, max: 7, anchors: { 1: "完全不同意", 7: "完全同意" } };

/** HXI 五因子元数据：代码、维度名与方向（DI 为负向；导出保存原始分，不做反向计分）。 */
export const HXI_FACTORS: ReadonlyArray<{
  code: HxiFactorCode;
  name: string;
  direction: "positive" | "negative";
}> = [
  { code: "AU", name: "自目的愉悦性 Autotelics", direction: "positive" },
  { code: "IN", name: "投入感 Involvement", direction: "positive" },
  { code: "RE", name: "真实感 Realism", direction: "positive" },
  { code: "DI", name: "失调感 Discord", direction: "negative" },
  { code: "HA", name: "协调性 Harmony", direction: "positive" }
];

/**
 * 完整 HXI 量表（20 题，按维度分组仅为配置可读性，界面不呈现维度信息）。
 * 呈现时由 shuffledHxiOrder 打乱顺序；存储键恒为题号 id。
 */
export const HXI_QUESTIONS: readonly Question[] = [
  // 自目的愉悦性 Autotelics
  hxi("hxi_a1", "不考虑其功能，我觉得这些触觉感受是令人愉悦的。", "AU", 1),
  hxi("hxi_a2", "对我来说，体验这些触觉感受是一种享受。", "AU", 2),
  hxi("hxi_a3", "我很享受这些触觉感受本身。", "AU", 3),
  hxi("hxi_a4", "无论其功能如何，这些触觉感受本身就是一种享受。", "AU", 4),
  // 投入感 Involvement
  hxi("hxi_i1", "这些触觉感受让我更加沉浸于当前任务中。", "IN", 1),
  hxi("hxi_i2", "我觉得这些触觉感受增强了我与该系统交互时的投入程度。", "IN", 2),
  hxi("hxi_i3", "这些触觉感受促进了我对当前任务的投入。", "IN", 3),
  hxi("hxi_i4", "这些触觉交互让我更加专注。", "IN", 4),
  // 真实感 Realism
  hxi("hxi_r1", "这些触觉感受与我在现实生活中实际感受到的触觉相似。", "RE", 1),
  hxi("hxi_r2", "这些触觉感受非常接近我预期在现实中会体验到的感觉。", "RE", 2),
  hxi("hxi_r3", "这些触觉感受让我觉得像现实生活中熟悉的触感。", "RE", 3),
  hxi("hxi_r4", "这些触觉感受逼真地再现了现实世界中的感觉。", "RE", 4),
  // 失调感 Discord
  hxi("hxi_d1", "这些触觉感受似乎与其他感官之间缺乏协调。", "DI", 1),
  hxi("hxi_d2", "我感到这些触觉感受与其他感官之间存在不匹配。", "DI", 2),
  hxi("hxi_d3", "我感觉这些触觉感受与其他感官不同步。", "DI", 3),
  hxi("hxi_d4", "我感到这些触觉感受与我的预期之间存在脱节。", "DI", 4),
  // 协调性 Harmony
  hxi("hxi_h1", "我感到这些触觉感受与其他感官之间是和谐一致的。", "HA", 1),
  hxi("hxi_h2", "这些触觉感受能够与其他感官体验无缝融合。", "HA", 2),
  hxi("hxi_h3", "我觉得这些触觉感受与其他感官之间协调良好。", "HA", 3),
  hxi("hxi_h4", "这些触觉感受能够很好地补充其他感官体验。", "HA", 4)
];

/** HXI（2025）官方英文原文，仅用于 hxi-key.csv 对照表，不参与界面呈现。 */
export const HXI_ENGLISH: Readonly<Record<string, string>> = {
  hxi_a1: "Regardless of function, I found the haptic sensations pleasant.",
  hxi_a2: "Experiencing the haptic sensations was enjoyable to me.",
  hxi_a3: "I enjoyed the haptic sensations themselves.",
  hxi_a4: "The haptic sensations were enjoyable on their own, regardless of their function.",
  hxi_i1: "I felt absorbed in the task due to the haptic sensations.",
  hxi_i2: "I found the haptic sensations strengthened my engagement with the system.",
  hxi_i3: "The haptic sensations contributed to my involvement in the task.",
  hxi_i4: "The haptic interactions made me more focused.",
  hxi_r1: "The haptic sensations resembled the ones I feel in real life.",
  hxi_r2: "The haptic sensations closely mimicked the experiences I would expect in reality.",
  hxi_r3: "The haptic sensations felt familiar to real life touch.",
  hxi_r4: "The haptic sensations provided a true-to-life representation of real-world sensations.",
  hxi_d1: "The haptic sensations seemed to lack coordination with other senses.",
  hxi_d2: "I experienced a sense of mismatch between the haptic sensations and other senses.",
  hxi_d3: "The haptic sensations felt out of sync with the other senses.",
  hxi_d4: "I experienced a disconnect between the haptic sensations and what I expected.",
  hxi_h1: "I felt a sense of harmony between the haptic sensations and other senses.",
  hxi_h2: "The haptic sensations integrated seamlessly with other senses.",
  hxi_h3: "I feel the haptic sensations are well coordinated with the other senses.",
  hxi_h4: "The haptic sensations complemented other senses well."
};

/**
 * PXI（Player Experience Inventory）节选 6 题：沉浸感 3 题 + 掌控感 3 题。
 * 分值 −3 到 +3，全部 7 个锚点按节选文档的分值说明呈现。
 */
export const PXI_FACTORS: ReadonlyArray<{
  code: PxiFactorCode;
  name: string;
  direction: "positive" | "negative";
}> = [
  { code: "IM", name: "沉浸感 Immersion", direction: "positive" },
  { code: "MA", name: "掌控感 Mastery", direction: "positive" }
];

const PXI_SOURCE =
  "PXI（Player Experience Inventory）节选 6 题（沉浸感/掌控感）；中文文案严格按批准版本呈现；正式使用前需确认许可与引用";

const pxiLikert = {
  kind: "likert" as const,
  min: -3,
  max: 3,
  anchors: {
    [-3]: "非常不同意",
    [-2]: "不同意",
    [-1]: "有些不同意",
    [0]: "既不同意也不赞同 / 中立",
    [1]: "有些同意",
    [2]: "同意",
    [3]: "非常同意"
  } as Record<number, string>
};

export const PXI_QUESTIONS: readonly Question[] = [
  // 沉浸感 Immersion
  pxi("pxi_im1", "在游戏过程中，我几乎没有再注意到周围的环境。", "IM", 1),
  pxi("pxi_im2", "我沉浸在游戏中。", "IM", 2),
  pxi("pxi_im3", "我完全专注于游戏。", "IM", 3),
  // 掌控感 Mastery
  pxi("pxi_ma1", "我觉得自己很擅长玩这个游戏。", "MA", 1),
  pxi("pxi_ma2", "在游戏过程中，我觉得自己很有能力完成游戏任务。", "MA", 2),
  pxi("pxi_ma3", "在玩这个游戏时，我感到自己能够很好地掌握它。", "MA", 3)
];

/** PXI 节选官方英文原题，仅用于 pxi-key.csv 对照表，不参与界面呈现。 */
export const PXI_ENGLISH: Readonly<Record<string, string>> = {
  pxi_im1: "I was no longer aware of my surroundings while I was playing.",
  pxi_im2: "I was immersed in the game.",
  pxi_im3: "I was fully focused on the game.",
  pxi_ma1: "I felt I was good at playing this game.",
  pxi_ma2: "I felt capable while playing the game.",
  pxi_ma3: "I felt a sense of mastery playing this game."
};

function pxi(id: string, prompt: string, factor: PxiFactorCode, item: number): Question {
  return {
    id,
    section: "condition",
    conditionScope: "each-condition",
    required: true,
    prompt,
    response: pxiLikert,
    source: PXI_SOURCE,
    pxiFactor: { factor, item }
  };
}

/** 两道电触觉刺激问题：呈现时固定按此顺序跟在 HXI 与 PXI 节选之后。 */
export const ELECTRO_QUESTIONS: readonly Question[] = [
  {
    id: "comfort_electro",
    section: "condition",
    conditionScope: "each-condition",
    required: true,
    prompt: "总体而言，刚才游戏中的电触觉刺激有多舒适？",
    response: { kind: "likert", min: 1, max: 7, anchors: { 1: "极不舒适", 7: "极其舒适" } },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: "pain_electro",
    section: "condition",
    conditionScope: "each-condition",
    required: true,
    prompt: "刚才游戏中的电触觉刺激引起了多强的疼痛？",
    response: { kind: "likert", min: 1, max: 7, anchors: { 1: "完全没有疼痛", 7: "可想象的最强疼痛" } },
    source: DRAFT_ITEM_SOURCE
  }
];

/** 完整条件后问卷：HXI 20 题 + PXI 节选 6 题 + 两道电刺激题（共 28 题，全部必答）。 */
export const CONDITION_QUESTIONS: readonly Question[] = [...HXI_QUESTIONS, ...PXI_QUESTIONS, ...ELECTRO_QUESTIONS];

function hxi(id: string, prompt: string, factor: HxiFactorCode, item: number): Question {
  return {
    id,
    section: "condition",
    conditionScope: "each-condition",
    required: true,
    prompt,
    response: likert7,
    source: HXI_SOURCE,
    hxiFactor: { factor, item }
  };
}

/** HXI 因子宽表列名（固定因子顺序 AU→IN→RE→DI→HA，各 4 题，与呈现顺序无关）。 */
export const HXI_FACTOR_COLUMNS: readonly string[] = HXI_FACTORS.flatMap(factor =>
  [1, 2, 3, 4].map(item => `HXI_${factor.code}${item}`)
);

/** 题号 id → 因子列名；hxi.csv 按此把原始 1–7 分落列。 */
export const HXI_COLUMN_OF_QUESTION: Readonly<Record<string, string>> = Object.fromEntries(
  HXI_QUESTIONS.map(question => [question.id, `HXI_${question.hxiFactor?.factor}${question.hxiFactor?.item}`])
);

/** 因子列名 → 题号 id（导出时反查）。 */
export const HXI_QUESTION_OF_COLUMN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(HXI_COLUMN_OF_QUESTION).map(([questionId, column]) => [column, questionId])
);

export const HXI_QUESTIONS_BY_ID: Readonly<Record<string, Question>> = Object.fromEntries(
  HXI_QUESTIONS.map(question => [question.id, question])
);

/**
 * HXI 20 题的随机呈现顺序（Fisher–Yates，可注入随机源供测试）。
 * 每条件首次进入问卷时生成一次并持久化到会话；两道电刺激题不参与打乱。
 */
export function shuffledHxiOrder(random: () => number = Math.random): string[] {
  const ids = HXI_QUESTIONS.map(question => question.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids;
}

/** hxi-key.csv 对照表行：因子 ↔ 具体题项（含官方英文原文），供数据分析按列取因子分。 */
export function hxiKeyRows(): string[][] {
  const scoringOf = (question: Question): string => {
    const factor = HXI_FACTORS.find(f => f.code === question.hxiFactor?.factor);
    return factor === undefined || factor.direction === "positive"
      ? "1–7 原始分"
      : "1–7 原始分（负向维度；分析阶段如需因子分请用 8−x 反向计分，导出不做转换）";
  };
  const rows = HXI_FACTOR_COLUMNS.map(column => {
    const question = HXI_QUESTIONS_BY_ID[HXI_QUESTION_OF_COLUMN[column]!]!;
    const factor = HXI_FACTORS.find(f => f.code === question.hxiFactor?.factor)!;
    return [
      column,
      factor.code,
      factor.name,
      String(question.hxiFactor!.item),
      factor.direction,
      question.id,
      question.prompt,
      HXI_ENGLISH[question.id] ?? "",
      scoringOf(question)
    ];
  });
  for (const [index, question] of ELECTRO_QUESTIONS.entries()) {
    rows.push([
      question.id,
      "",
      "电刺激感受（研究团队自拟）",
      String(index + 1),
      "",
      question.id,
      question.prompt,
      "",
      "1–7 原始分"
    ]);
  }
  return rows;
}

/** PXI 因子宽表列名（固定因子顺序 IM→MA，各 3 题，与呈现顺序无关）。 */
export const PXI_FACTOR_COLUMNS: readonly string[] = PXI_FACTORS.flatMap(factor =>
  [1, 2, 3].map(item => `PXI_${factor.code}${item}`)
);

/** 题号 id → 因子列名；pxi.csv 按此把原始 −3–3 分落列。 */
export const PXI_COLUMN_OF_QUESTION: Readonly<Record<string, string>> = Object.fromEntries(
  PXI_QUESTIONS.map(question => [question.id, `PXI_${question.pxiFactor?.factor}${question.pxiFactor?.item}`])
);

/** 因子列名 → 题号 id（导出时反查）。 */
export const PXI_QUESTION_OF_COLUMN: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PXI_COLUMN_OF_QUESTION).map(([questionId, column]) => [column, questionId])
);

export const PXI_QUESTIONS_BY_ID: Readonly<Record<string, Question>> = Object.fromEntries(
  PXI_QUESTIONS.map(question => [question.id, question])
);

/**
 * PXI 节选 6 题的随机呈现顺序（Fisher–Yates，可注入随机源供测试）。
 * 约束：同维度的题项不相邻出现（从而必然不会三道挨在一起）；
 * 重试失败时退化为 IM/MA 交替的固定顺序。每条件首次进入问卷时生成一次并持久化。
 */
export function shuffledPxiOrder(random: () => number = Math.random): string[] {
  const sameFactor = (a: string, b: string): boolean =>
    PXI_QUESTIONS_BY_ID[a]!.pxiFactor!.factor === PXI_QUESTIONS_BY_ID[b]!.pxiFactor!.factor;
  const ids = PXI_QUESTIONS.map(question => question.id);
  for (let attempt = 0; attempt < 200; attempt++) {
    const candidate = [...ids];
    for (let i = candidate.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidate[i], candidate[j]] = [candidate[j]!, candidate[i]!];
    }
    const adjacentSame = candidate.some((id, index) => index > 0 && sameFactor(candidate[index - 1]!, id));
    if (!adjacentSame) return candidate;
  }
  // 兜底：IM/MA 交替（前 3 题为 IM、后 3 题为 MA），保证同维度题项不挨在一起。
  return [0, 1, 2].flatMap(index => [PXI_QUESTIONS[index]!.id, PXI_QUESTIONS[3 + index]!.id]);
}

/** pxi-key.csv 对照表行：因子 ↔ 具体题项（含官方英文原题），供数据分析按列取因子分。 */
export function pxiKeyRows(): string[][] {
  return PXI_FACTOR_COLUMNS.map(column => {
    const question = PXI_QUESTIONS_BY_ID[PXI_QUESTION_OF_COLUMN[column]!]!;
    const factor = PXI_FACTORS.find(f => f.code === question.pxiFactor?.factor)!;
    return [
      column,
      factor.code,
      factor.name,
      String(question.pxiFactor!.item),
      factor.direction,
      question.id,
      question.prompt,
      PXI_ENGLISH[question.id] ?? "",
      "-3–3 原始分"
    ];
  });
}

/** 九对事件对比：两项 0–5 适宜程度评分 + A/B/无偏好选择 + 选填理由。 */
export const COMPARISON_QUESTIONS: readonly Question[] = CONDITION_EVENT_IDS.flatMap(eventId => [
  {
    id: `${eventId}-a-appropriateness`,
    section: "comparison" as const,
    conditionScope: "after-both" as const,
    required: true,
    prompt: "样本 A —— 该事件中触觉反馈的适宜程度？",
    response: { kind: "likert" as const, min: 0, max: 5, anchors: { 0: "完全不合适", 5: "非常合适" } },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: `${eventId}-b-appropriateness`,
    section: "comparison" as const,
    conditionScope: "after-both" as const,
    required: true,
    prompt: "样本 B —— 该事件中触觉反馈的适宜程度？",
    response: { kind: "likert" as const, min: 0, max: 5, anchors: { 0: "完全不合适", 5: "非常合适" } },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: `${eventId}-preference`,
    section: "comparison" as const,
    conditionScope: "after-both" as const,
    required: true,
    prompt: "哪个样本更适合该事件？",
    response: {
      kind: "choice" as const,
      options: [
        { value: "a", label: "样本 A" },
        { value: "b", label: "样本 B" },
        { value: "none", label: "无偏好" }
      ]
    },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: `${eventId}-reason`,
    section: "comparison" as const,
    conditionScope: "after-both" as const,
    required: false,
    prompt: "请说明选择原因，或指出不适宜之处（选填）。",
    response: { kind: "text" as const, minLength: 0, maxLength: 280 },
    source: DRAFT_ITEM_SOURCE
  }
]);

/** 最终评估：总体偏好、差异感知检查与总体理由。 */
export const FINAL_QUESTIONS: readonly Question[] = [
  {
    id: "final_preference",
    section: "final",
    required: true,
    prompt: "综合刚才全部游戏体验，你更希望游戏采用哪一种触觉反馈？",
    response: {
      kind: "choice",
      options: [
        { value: "a", label: "触觉条件 A" },
        { value: "b", label: "触觉条件 B" },
        { value: "none", label: "无偏好" }
      ]
    },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: "final_difference",
    section: "final",
    required: true,
    prompt: "总体而言，你是否明显感受到两种触觉反馈之间的差异？",
    response: { kind: "likert", min: 1, max: 7, anchors: { 1: "完全没有感受到差异", 7: "感受到非常明显的差异" } },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: "final_reason",
    section: "final",
    required: false,
    prompt: "请简要说明你总体偏好该条件或无偏好的原因。选填，建议 0–300 字。",
    response: { kind: "text", minLength: 0, maxLength: 300 },
    source: DRAFT_ITEM_SOURCE
  }
];

/** 试验后访谈（全部选填）。 */
export const INTERVIEW_QUESTIONS: readonly Question[] = [
  {
    id: "interview_preference_reason",
    section: "interview",
    required: false,
    prompt: "总体上，你更喜欢哪种触觉反馈？为什么？",
    response: { kind: "text", minLength: 0, maxLength: 500 },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: "interview_event_difference",
    section: "interview",
    required: false,
    prompt: "哪个游戏事件最能体现两种触觉的差异？",
    response: { kind: "text", minLength: 0, maxLength: 500 },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: "interview_mismatch",
    section: "interview",
    required: false,
    prompt: "是否有某些触觉与游戏事件不匹配、不同步或难以理解？",
    response: { kind: "text", minLength: 0, maxLength: 500 },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: "interview_position_help",
    section: "interview",
    required: false,
    prompt: "触觉的位置、方向或时间变化是否帮助你判断危险或采取操作？请举例。",
    response: { kind: "text", minLength: 0, maxLength: 500 },
    source: DRAFT_ITEM_SOURCE
  },
  {
    id: "interview_distraction",
    section: "interview",
    required: false,
    prompt: "是否有触觉让你分心、感到不自然、过强、过弱或不舒服？你希望怎样改进？",
    response: { kind: "text", minLength: 0, maxLength: 500 },
    source: DRAFT_ITEM_SOURCE
  }
];

export function conditionQuestions(): readonly Question[] {
  return CONDITION_QUESTIONS;
}

export function comparisonQuestions(): readonly Question[] {
  return COMPARISON_QUESTIONS;
}

export function finalQuestions(): readonly Question[] {
  return FINAL_QUESTIONS;
}

export function interviewQuestions(): readonly Question[] {
  return INTERVIEW_QUESTIONS;
}

export function comparisonQuestionsForEvent(eventId: string): Question[] {
  return COMPARISON_QUESTIONS.filter(question => question.id.startsWith(`${eventId}-`));
}
