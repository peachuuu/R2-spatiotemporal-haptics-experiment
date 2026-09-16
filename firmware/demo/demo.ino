// ============================================================
// R2 真实电触觉固件（Phase 2.2：可中断安全调度器与状态机）
//
// - 所有波形、电极、样本表、调度与输出安全逻辑都在本文件；
//   hv.h/hv.cpp 只做低层驱动，不得改动。
// - micros() 驱动的非阻塞调度器：30 Hz burst、PN=3 对称双相、相间高阻，
//   串口 STOP 随时可打断。
// - 状态机：CONNECTED_SAFE -> ARMED_IDLE -> PREPARING -> PREPARED
//   -> SCHEDULED -> PLAYING；STOP/超时/故障 -> CONNECTED_SAFE。
//   上电/复位/结束/解析错误/看门狗：输出等级 0 + 全部电极高阻。
// - DRY_RUN 编译开关：只报告调度转移，绝不调用有源 HV 输出。
// - 开发 CLI：v <等级> → a → 事件编号/校准 k0…k7；h=菜单，s=状态，c=目录，q=停止。
//   （正式网页协议构建下 CLI 与二进制协议互斥）
// ============================================================
#include <Arduino.h>
#include "hv.h"

// ---------------- 版本与编译开关 ----------------
#define FW_MAJOR 0
#define FW_MINOR 3
// ENABLE_DEV_CLI：开发 CLI 与协议 v2 互斥；1=CLI（字符串命令），0=仅二进制协议。
// 正式游戏通过协议 v2 通信；开发 CLI 必须显式打开才可替代它。
#ifndef ENABLE_DEV_CLI
#define ENABLE_DEV_CLI 0
#endif
// SERIAL_DEBUG：1 = 协议模式也向串口打印调试文字（会污染协议 v2 数据流，仅调试用）；
// 0 = 串口只承载二进制协议帧（正式烧录必须为 0）。
#ifndef SERIAL_DEBUG
#define SERIAL_DEBUG 0
#endif
// 校准脉冲：100Hz、PW 100us；START 后持续，直到 STOP/重新设置区域/故障才隔离。
#define CALIBRATION_PULSE_PW_US 100
#define SAMPLE_TABLE_VERSION 5
// 候选样本 "sth.g01.unlock"（用户 5.09 s / 17 段数据）：确认归属并经批准前禁止人体播放。
// 01 已由用户确认数据（2026-08-27 更新表），与其他样本同样可用。
// DRY_RUN：1 = 只打印调度转移，不进行任何有源输出（台架/主机侧测试用）。
#ifndef DRY_RUN
#define DRY_RUN 0
#endif

// 单机串口测试仅在 ENABLE_DEV_CLI=1 的独立烧录版本启用；正式网页协议版本保持 0。
// 独立模式从 0 开始，必须由操作者在串口中明确设置 1..180 的测试等级。
#define STANDALONE_TEST_MAX_VOLTAGE_CODE 180

// ---------------- 安全硬上限与看门狗 ----------------
#define MAX_ELECTRODE_ID 479UL
#define MAX_PHASE_WIDTH_US 1000UL
#define MAX_PULSE_PERIOD_US 12000UL
#define MAX_BURST_DURATION_MS 30000UL
#define MAX_VOLTAGE_CODE 255
#define MAX_SAMPLE_DURATION_US (MAX_BURST_DURATION_MS * 1000UL)
#define COMMAND_WATCHDOG_MS 30000UL   // 主机静默超过 30 秒 -> 安全停止并撤 ARM
#define MAX_DURATION_SLACK_US 200000UL

// ---------------- 参数语义（设计规格 §5） ----------------
struct PulseProfile {
  uint16_t phaseWidthUs;        // 单相脉宽（μs）
  uint32_t pulsePeriodUs;       // 同一 burst 内脉冲周期（μs）
  uint32_t burstPeriodUs;       // burst 周期（μs）；30 Hz ≈ 33333
  uint8_t pulseCount;           // 每 burst 脉冲数（本批固定 3）
  uint8_t phaseBalancePercent;  // 正负相位占比（本批固定 50）
};

struct ElectrodePair {
  const uint16_t* positive;
  uint8_t positiveCount;
  const uint16_t* negative;
  uint8_t negativeCount;
};

struct SampleSegment {
  uint32_t startUs;
  uint32_t endUs;
  ElectrodePair electrodes;
};

struct PwRampPoint {
  uint32_t atUs;
  uint16_t phaseWidthUs;
};

struct PulseWidthLookupPoint {
  uint32_t atUs;
  uint16_t phaseWidthUs;
};

struct PulseWidthLookupCurve {
  const PulseWidthLookupPoint* points;
  uint16_t count;
};

#include "haptic_pw_lookup.h"

struct SampleDefinition {
  const char* id;
  uint32_t durationUs;
  const SampleSegment* segments;
  uint8_t segmentCount;
  PulseProfile pulse;
  const PwRampPoint* pwRamp;
  uint8_t pwRampCount;
  uint32_t repeatUs;   // >0：段与 PW 按该周期循环（火焰两帧循环、雨 1s 循环）
  bool available;
};

// ---------------- 候选样本 "sth.g01.unlock"（5.09 s / 17 段） ----------------
// 用户时间线（ms → μs）；2.14-2.4 与前段重叠，边界规范化为 2.15 s（已审计）。
// 30 Hz；PW：0-1.2s 100→140μs；1.2-3.8s 120→160μs；3.8-5.09s 150→100μs
#define SEG(PAIR_POS, PAIR_NEG) \
  { PAIR_POS, sizeof(PAIR_POS) / sizeof(PAIR_POS[0]), PAIR_NEG, sizeof(PAIR_NEG) / sizeof(PAIR_NEG[0]) }

static const uint16_t S01_73[] = {73}; static const uint16_t S01_77[] = {77};
static const uint16_t S01_71[] = {71}; static const uint16_t S01_79[] = {79};
static const uint16_t S01_69[] = {69}; static const uint16_t S01_82[] = {82};
static const uint16_t S01_67[] = {67}; static const uint16_t S01_84[] = {84};
static const uint16_t S01_65[] = {65}; static const uint16_t S01_86[] = {86};
static const uint16_t S01_72[] = {72}; static const uint16_t S01_70[] = {70};
static const uint16_t S01_80[] = {80}; static const uint16_t S01_81[] = {81};

static const SampleSegment SAMPLE_01_SEGMENTS[] = {
  {0, 600000, SEG(S01_73, S01_77)},
  {600000, 800000, SEG(S01_71, S01_79)},
  {800000, 1000000, SEG(S01_69, S01_82)},
  {1000000, 1200000, SEG(S01_67, S01_84)},
  {1200000, 1400000, SEG(S01_65, S01_86)},
  {1400000, 1650000, SEG(S01_72, S01_70)},
  {1650000, 1900000, SEG(S01_71, S01_69)},
  {1900000, 2150000, SEG(S01_79, S01_82)},
  {2150000, 2400000, SEG(S01_80, S01_81)},
  {2400000, 2600000, SEG(S01_65, S01_86)},
  {2600000, 2800000, SEG(S01_67, S01_84)},
  {2800000, 3000000, SEG(S01_69, S01_82)},
  {3000000, 3200000, SEG(S01_71, S01_79)},
  {3200000, 3400000, SEG(S01_73, S01_77)},
  {3400000, 3650000, SEG(S01_80, S01_81)},
  {3650000, 3900000, SEG(S01_79, S01_82)},
  {3900000, 4150000, SEG(S01_71, S01_69)},
  {4150000, 5085000, SEG(S01_72, S01_70)},
};

static const PwRampPoint SAMPLE_01_PW_RAMP[] = {
  {0, 100}, {1200000, 140}, {1200000, 120}, {3800000, 160}, {3800000, 150}, {5085000, 100},
};


// ---------------- 样本0827.doc 提供的样本数据（正/负极显式） ----------------
// 02 石块飞溅（G02）：30Hz，PW 100→140(0-1.2s)/120→160(1.2-3.8s)/150→100(3.8-4.5s)
// 电极顺序与 0901-碎石.json 的 6 帧一致；只替换电极，时序和刺激参数不变。
static const uint16_t S02A_P[] = {4,7,53,57,280,283,294,298}; static const uint16_t S02A_N[] = {8,11,52,56,276,279,295,299};
static const uint16_t S02B_P[] = {18,31,35,45,256,269,308,316}; static const uint16_t S02B_N[] = {17,29,36,47,258,270,306,315};
static const uint16_t S02C_P[] = {73,81,111,131,142,193,326,333,368,394,404,461}; static const uint16_t S02C_N[] = {74,82,110,132,141,194,325,334,369,393,403,462};
static const uint16_t S02D_P[] = {73,83,115,129,144,202,324,333,364,392,406,454}; static const uint16_t S02D_N[] = {74,84,114,130,143,201,323,334,365,391,405,453};
static const uint16_t S02E_P[] = {87,99,151,207,320,380,384,448}; static const uint16_t S02E_N[] = {64,98,128,192,343,381,407,463};
static const uint16_t S02F_P[] = {4,7,23,53,57,264,280,283,294,298}; static const uint16_t S02F_N[] = {8,11,21,52,56,266,276,279,295,299};
static const SampleSegment S02_SEGS[] = {
  {0,750000,SEG(S02A_P,S02A_N)},{750000,1500000,SEG(S02B_P,S02B_N)},{1500000,2000000,SEG(S02C_P,S02C_N)},
  {2000000,2500000,SEG(S02D_P,S02D_N)},{2500000,3500000,SEG(S02E_P,S02E_N)},{3500000,4500000,SEG(S02F_P,S02F_N)},
};
static const PwRampPoint S02_PW[] = {{0,100},{1200000,140},{1200000,120},{3800000,160},{3800000,150},{4500000,100}};
// 03 火焰燃烧（G03）：30Hz；按 G03+G08.doc 显式列出 0–5.55s 的绝对时程。
// 文档导出的“3121”是相邻重复帧的 312 与下一帧序号 1 连写，实际电极为 312。
// PW 由外部查表给出。
static const uint16_t S03A_P[] = {1,39,53,59,286,292,298,312}; static const uint16_t S03A_N[] = {2,3,52,58,284,285,293,299};
static const uint16_t S03B_P[] = {34,36,44,45,306,307,315,317}; static const uint16_t S03B_N[] = {14,15,46,47,272,273,304,305};
static const SampleSegment S03_SEGS[] = {
  {0,500000,SEG(S03A_P,S03A_N)},{500000,1000000,SEG(S03B_P,S03B_N)},
  {1000000,1500000,SEG(S03A_P,S03A_N)},{1500000,2000000,SEG(S03B_P,S03B_N)},
  {2000000,2500000,SEG(S03A_P,S03A_N)},{2500000,3000000,SEG(S03B_P,S03B_N)},
  {3000000,3500000,SEG(S03A_P,S03A_N)},{3500000,4000000,SEG(S03B_P,S03B_N)},
  {4000000,4500000,SEG(S03A_P,S03A_N)},{4500000,5000000,SEG(S03B_P,S03B_N)},
  {5000000,5500000,SEG(S03A_P,S03A_N)},{5500000,5550000,SEG(S03B_P,S03B_N)},
};
static const PwRampPoint S03_PW[] = {{0,100},{1000000,145}};
// 04 幽灵穿过（G04）：30Hz，6 段，5.875s；PW 由外部查表给出。
static const uint16_t S04A_P[] = {11,14,17}; static const uint16_t S04A_N[] = {10,13,16};
static const uint16_t S04B_P[] = {3,20,33}; static const uint16_t S04B_N[] = {0,4,21};
static const uint16_t S04C_P[] = {28,43,57}; static const uint16_t S04C_N[] = {29,42,63};
static const uint16_t S04D_P[] = {259,294,308}; static const uint16_t S04D_N[] = {258,288,309};
static const uint16_t S04E_P[] = {267,284,318}; static const uint16_t S04E_N[] = {266,283,287};
static const uint16_t S04F_P[] = {270,273,276}; static const uint16_t S04F_N[] = {271,274,277};
static const SampleSegment S04_SEGS[] = {
  {0,1800000,SEG(S04A_P,S04A_N)},{1800000,2600000,SEG(S04B_P,S04B_N)},{2600000,3400000,SEG(S04C_P,S04C_N)},
  {3400000,4200000,SEG(S04D_P,S04D_N)},{4200000,5000000,SEG(S04E_P,S04E_N)},{5000000,5875000,SEG(S04F_P,S04F_N)},
};
static const PwRampPoint S04_PW[] = {{0,100},{1400000,140},{1400000,120},{4600000,165},{4600000,150},{5875000,100}};
// 04a/04b 寻找宝箱（G05/G09 侧别）：30Hz、PW 100us，2.113s
static const uint16_t S04L_P[] = {38,36,34}; static const uint16_t S04L_N[] = {37,35,33};
static const uint16_t S04R_P[] = {313,315,317}; static const uint16_t S04R_N[] = {314,316,318};
static const SampleSegment S04L_SEGS[] = {{0,2113000,SEG(S04L_P,S04L_N)}};
static const SampleSegment S04R_SEGS[] = {{0,2113000,SEG(S04R_P,S04R_N)}};
// 06 横向凸棱划过（G06/G10 划棱）：10Hz，4 段 3.483s；PW 由外部查表给出。
static const uint16_t S06A_P[] = {74}; static const uint16_t S06A_N[] = {72};
static const uint16_t S06B_P[] = {73}; static const uint16_t S06B_N[] = {71};
static const uint16_t S06C_P[] = {77}; static const uint16_t S06C_N[] = {79};
static const uint16_t S06D_P[] = {78}; static const uint16_t S06D_N[] = {80};
static const SampleSegment S06_SEGS[] = {
  {0,900000,SEG(S06A_P,S06A_N)},{900000,1800000,SEG(S06B_P,S06B_N)},{1800000,2700000,SEG(S06C_P,S06C_N)},{2700000,3483000,SEG(S06D_P,S06D_N)},
};
static const PwRampPoint S06_PW[] = {{0,100},{700000,130},{700000,120},{2900000,160},{2900000,150},{3480000,100}};
// 07Alf/07Arf 快速、07Al/07Ar 慢速飞行物：均为 30Hz、PW 200us。
// 使用三段式构型；只改电极与分段时间，不改各样本总时长或脉冲参数。
static const uint16_t S07L1_P[] = {11,14,17}; static const uint16_t S07L1_N[] = {10,13,16};
static const uint16_t S07L2_P[] = {3,20,33}; static const uint16_t S07L2_N[] = {0,4,21};
static const uint16_t S07L3_P[] = {28,43,57}; static const uint16_t S07L3_N[] = {29,42,63};
static const uint16_t S07R1_P[] = {270,273,276}; static const uint16_t S07R1_N[] = {271,274,277};
static const uint16_t S07R2_P[] = {267,284,318}; static const uint16_t S07R2_N[] = {266,283,287};
static const uint16_t S07R3_P[] = {259,294,308}; static const uint16_t S07R3_N[] = {258,288,309};
static const SampleSegment S07LF_SEGS[] = {
  {0,520000,SEG(S07L1_P,S07L1_N)},{520000,1030000,SEG(S07L2_P,S07L2_N)},{1030000,1556000,SEG(S07L3_P,S07L3_N)},
};
static const SampleSegment S07RF_SEGS[] = {
  {0,520000,SEG(S07R1_P,S07R1_N)},{520000,1030000,SEG(S07R2_P,S07R2_N)},{1030000,1556000,SEG(S07R3_P,S07R3_N)},
};
static const SampleSegment S07LS_SEGS[] = {
  {0,850000,SEG(S07L1_P,S07L1_N)},{850000,1700000,SEG(S07L2_P,S07L2_N)},{1700000,2554000,SEG(S07L3_P,S07L3_N)},
};
static const SampleSegment S07RS_SEGS[] = {
  {0,850000,SEG(S07R1_P,S07R1_N)},{850000,1700000,SEG(S07R2_P,S07R2_N)},{1700000,2554000,SEG(S07R3_P,S07R3_N)},
};
// 危险区 A/B/C/D = 从左至右的第 1/2/3/4 个锚点。均为 30Hz，PW 由外部查表给出。
// 三段分别是中心、小范围、整只同侧手掌；快 0.6/1.2/1.718s，慢 0.7/1.4/2.276s。
static const uint16_t S07A1_P[] = {33,35,37}; static const uint16_t S07A1_N[] = {34,36,38};
static const uint16_t S07A2_P[] = {33,35,37,44,45,50}; static const uint16_t S07A2_N[] = {34,36,38,46,47,49};
static const uint16_t S07LP_P[] = {33,35,37,40,44,45,50,53,59}; static const uint16_t S07LN_P[] = {34,36,38,41,46,47,49,52,58};
static const uint16_t S07B1_P[] = {40,53,59}; static const uint16_t S07B1_N[] = {41,52,58};
static const uint16_t S07B2_P[] = {40,44,45,50,53,59}; static const uint16_t S07B2_N[] = {41,46,47,49,52,58};
static const uint16_t S07C1_P[] = {292,298,311}; static const uint16_t S07C1_N[] = {293,299,310};
static const uint16_t S07C2_P[] = {292,298,301,306,307,311}; static const uint16_t S07C2_N[] = {293,299,302,304,305,310};
static const uint16_t S07RP_P[] = {292,298,301,306,307,311,314,316,318}; static const uint16_t S07RN_P[] = {293,299,302,304,305,310,313,315,317};
static const uint16_t S07D1_P[] = {314,316,318}; static const uint16_t S07D1_N[] = {313,315,317};
static const uint16_t S07D2_P[] = {301,306,307,314,316,318}; static const uint16_t S07D2_N[] = {302,304,305,313,315,317};
#define AREA_FAST_SEGMENTS(p1,n1,p2,n2,p3,n3) { {0,600000,SEG(p1,n1)},{600000,1200000,SEG(p2,n2)},{1200000,1718000,SEG(p3,n3)} }
#define AREA_SLOW_SEGMENTS(p1,n1,p2,n2,p3,n3) { {0,700000,SEG(p1,n1)},{700000,1400000,SEG(p2,n2)},{1400000,2276000,SEG(p3,n3)} }
static const SampleSegment S07A_FAST_SEGS[] = AREA_FAST_SEGMENTS(S07A1_P,S07A1_N, S07A2_P,S07A2_N, S07LP_P,S07LN_P);
static const SampleSegment S07A_SLOW_SEGS[] = AREA_SLOW_SEGMENTS(S07A1_P,S07A1_N, S07A2_P,S07A2_N, S07LP_P,S07LN_P);
static const SampleSegment S07B_FAST_SEGS[] = AREA_FAST_SEGMENTS(S07B1_P,S07B1_N, S07B2_P,S07B2_N, S07LP_P,S07LN_P);
static const SampleSegment S07B_SLOW_SEGS[] = AREA_SLOW_SEGMENTS(S07B1_P,S07B1_N, S07B2_P,S07B2_N, S07LP_P,S07LN_P);
static const SampleSegment S07C_FAST_SEGS[] = AREA_FAST_SEGMENTS(S07C1_P,S07C1_N, S07C2_P,S07C2_N, S07RP_P,S07RN_P);
static const SampleSegment S07C_SLOW_SEGS[] = AREA_SLOW_SEGMENTS(S07C1_P,S07C1_N, S07C2_P,S07C2_N, S07RP_P,S07RN_P);
static const SampleSegment S07D_FAST_SEGS[] = AREA_FAST_SEGMENTS(S07D1_P,S07D1_N, S07D2_P,S07D2_N, S07RP_P,S07RN_P);
static const SampleSegment S07D_SLOW_SEGS[] = AREA_SLOW_SEGMENTS(S07D1_P,S07D1_N, S07D2_P,S07D2_N, S07RP_P,S07RN_P);
#undef AREA_FAST_SEGMENTS
#undef AREA_SLOW_SEGMENTS
static const PwRampPoint S07_SLOW_PW[] = {{0,100},{750000,140},{750000,140},{1900000,175},{1900000,165},{2276000,120}};
static const PwRampPoint S07_FAST_PW[] = {{0,100},{400000,150},{400000,150},{1400000,180},{1400000,170},{1718000,120}};
// 08 下雨（G08）：100Hz；按 G03+G08.doc 显式列出 0–6.502s 的绝对时程。
// PW 由外部查表给出。
static const uint16_t S08A_P[] = {18,24,30,257,263,269}; static const uint16_t S08A_N[] = {17,22,28,259,265,270};
static const uint16_t S08B_P[] = {21,27,31,256,260,266}; static const uint16_t S08B_N[] = {19,25,262,268};
static const uint16_t S08C_P[] = {37,40,43,308,311,314}; static const uint16_t S08C_N[] = {38,41,45,306,310,313};
static const uint16_t S08D_P[] = {0,49,53,287,298,302}; static const uint16_t S08D_N[] = {32,48,52,299,303,319};
static const uint16_t S08E_P[] = {5,59,62,282,289,292}; static const uint16_t S08E_N[] = {9,58,61,278,290,293};
static const SampleSegment S08_SEGS[] = {
  {0,200000,SEG(S08A_P,S08A_N)},{200000,400000,SEG(S08B_P,S08B_N)},{400000,600000,SEG(S08C_P,S08C_N)},
  {600000,800000,SEG(S08D_P,S08D_N)},{800000,1000000,SEG(S08E_P,S08E_N)},
  {1000000,1200000,SEG(S08A_P,S08A_N)},{1200000,1400000,SEG(S08B_P,S08B_N)},{1400000,1600000,SEG(S08C_P,S08C_N)},
  {1600000,1800000,SEG(S08D_P,S08D_N)},{1800000,2000000,SEG(S08E_P,S08E_N)},
  {2000000,2200000,SEG(S08A_P,S08A_N)},{2200000,2400000,SEG(S08B_P,S08B_N)},{2400000,2600000,SEG(S08C_P,S08C_N)},
  {2600000,2800000,SEG(S08D_P,S08D_N)},{2800000,3000000,SEG(S08E_P,S08E_N)},
  {3000000,3200000,SEG(S08A_P,S08A_N)},{3200000,3400000,SEG(S08B_P,S08B_N)},{3400000,3600000,SEG(S08C_P,S08C_N)},
  {3600000,3800000,SEG(S08D_P,S08D_N)},{3800000,4000000,SEG(S08E_P,S08E_N)},
  {4000000,4200000,SEG(S08A_P,S08A_N)},{4200000,4400000,SEG(S08B_P,S08B_N)},{4400000,4600000,SEG(S08C_P,S08C_N)},
  {4600000,4800000,SEG(S08D_P,S08D_N)},{4800000,5000000,SEG(S08E_P,S08E_N)},
  {5000000,5200000,SEG(S08A_P,S08A_N)},{5200000,5400000,SEG(S08B_P,S08B_N)},{5400000,5600000,SEG(S08C_P,S08C_N)},
  {5600000,5800000,SEG(S08D_P,S08D_N)},{5800000,6000000,SEG(S08E_P,S08E_N)},
  {6000000,6200000,SEG(S08A_P,S08A_N)},{6200000,6400000,SEG(S08B_P,S08B_N)},{6400000,6500000,SEG(S08C_P,S08C_N)},
  {6500000,6502000,SEG(S08C_P,S08C_N)},
};
static const PwRampPoint S08_PW[] = {{0,100},{1000000,145}};

// 09 烟花（G12）：30Hz、PN=3、50% 双相；PW 逐 33.33ms 从
// haptic_pw_lookup.h 的 g12-fireworks.wav 曲线读取，5.016s 后自动关闭。
static const uint16_t S12A_P[] = {5,62,282,289}; static const uint16_t S12A_N[] = {9,61,278,290};
static const uint16_t S12B_P[] = {37,43,308,314}; static const uint16_t S12B_N[] = {35,42,309,316};
static const uint16_t S12C_P[] = {18,30,257,269}; static const uint16_t S12C_N[] = {19,31,256,268};
// 1.000–4.000 s 的烟花混合段仅保留手指区域，避免手掌的较低阈值拉低指尖刺激。
static const uint16_t S12D_P[] = {82,110,146,203,325,369,389,451}; static const uint16_t S12D_N[] = {69,109,133,195,338,370,402,459};
static const uint16_t S12E_P[] = {76,111,144,204,331,368,392,452}; static const uint16_t S12E_N[] = {75,110,143,203,332,369,391,451};
static const uint16_t S12F_P[] = {85,96,149,206,322,383,386,450}; static const uint16_t S12F_N[] = {86,127,150,205,321,352,385,449};
static const uint16_t S12G_P[] = {19,25,30,257,262,268}; static const uint16_t S12G_N[] = {16,23,28,259,264,271};
static const uint16_t S12H_P[] = {8,43,61,279,290,308}; static const uint16_t S12H_N[] = {10,45,60,277,291,306};
static const SampleSegment S12_SEGS[] = {
  {0,300000,SEG(S12A_P,S12A_N)},{300000,600000,SEG(S12B_P,S12B_N)},{600000,1000000,SEG(S12C_P,S12C_N)},
  {1000000,1200000,SEG(S12D_P,S12D_N)},{1200000,1400000,SEG(S12E_P,S12E_N)},{1400000,1600000,SEG(S12F_P,S12F_N)},
  {1600000,1800000,SEG(S12D_P,S12D_N)},{1800000,2000000,SEG(S12E_P,S12E_N)},{2000000,2300000,SEG(S12D_P,S12D_N)},
  {2300000,2600000,SEG(S12E_P,S12E_N)},{2600000,3000000,SEG(S12F_P,S12F_N)},{3000000,3300000,SEG(S12D_P,S12D_N)},
  {3300000,3600000,SEG(S12E_P,S12E_N)},{3600000,4000000,SEG(S12F_P,S12F_N)},{4000000,4500000,SEG(S12G_P,S12G_N)},
  // 5.000–5.016s 未另给电极，沿用最后一段 H 并按查表 PW=70us 后关闭。
  {4500000,5016000,SEG(S12H_P,S12H_N)},
};

// ---------------- 样本目录：全部 STH/BH ID，无数据一律 available=false ----------------
#define SAMPLE_UNAVAILABLE(id) { id, 0, NULL, 0, {0, 0, 0, 0, 0}, NULL, 0, 0, false }

static const SampleDefinition SAMPLE_CATALOG[] = {
  {
    "sth.g01.unlock", 5085000UL,
    SAMPLE_01_SEGMENTS, sizeof(SAMPLE_01_SEGMENTS) / sizeof(SAMPLE_01_SEGMENTS[0]),
    {100, 1000, 33333, 3, 50},
    SAMPLE_01_PW_RAMP, sizeof(SAMPLE_01_PW_RAMP) / sizeof(SAMPLE_01_PW_RAMP[0]),
    0,
    true  // 用户已确认 01 数据（0827 更新表）
  },
  { "sth.g02.rubble", 4500000UL, S02_SEGS, 6, {100, 1000, 33333, 3, 50}, S02_PW, 6, 0, true },
  { "sth.g03.fire", 5550000UL, S03_SEGS, 12, {50, 1000, 33333, 3, 50}, S03_PW, 2, 0, true },
  { "sth.g04.ghost", 5875000UL, S04_SEGS, 6, {50, 1000, 33333, 3, 50}, S04_PW, 6, 0, true },
  { "sth.g05.chest.left", 2113000UL, S04L_SEGS, 1, {100, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g05.chest.right", 2113000UL, S04R_SEGS, 1, {100, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  SAMPLE_UNAVAILABLE("sth.g06.open"),
  { "sth.g06.ridge", 3483000UL, S06_SEGS, 4, {50, 1000, 100000, 3, 50}, S06_PW, 6, 0, true },
  { "sth.g07.projectile.left.fast", 1556000UL, S07LF_SEGS, 3, {200, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.projectile.right.fast", 1556000UL, S07RF_SEGS, 3, {200, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.projectile.left.slow", 2554000UL, S07LS_SEGS, 3, {200, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.projectile.right.slow", 2554000UL, S07RS_SEGS, 3, {200, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.a.fast", 1718000UL, S07A_FAST_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.a.slow", 2276000UL, S07A_SLOW_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.b.fast", 1718000UL, S07B_FAST_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.b.slow", 2276000UL, S07B_SLOW_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.c.fast", 1718000UL, S07C_FAST_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.c.slow", 2276000UL, S07C_SLOW_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.d.fast", 1718000UL, S07D_FAST_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g07.area.d.slow", 2276000UL, S07D_SLOW_SEGS, 3, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  { "sth.g08.rain", 6502000UL, S08_SEGS, 34, {50, 1000, G08_RAIN_BURST_PERIOD_US, 3, 50}, S08_PW, 2, 0, true },
  { "sth.g12.fireworks", 5016000UL, S12_SEGS, 16, {50, 1000, 33333, 3, 50}, NULL, 0, 0, true },
  SAMPLE_UNAVAILABLE("bh.g01.unlock"), SAMPLE_UNAVAILABLE("bh.g03.fire"), SAMPLE_UNAVAILABLE("bh.g04.ghost"),
  SAMPLE_UNAVAILABLE("bh.g05.chest.left"), SAMPLE_UNAVAILABLE("bh.g05.chest.right"),
  SAMPLE_UNAVAILABLE("bh.g06.open"), SAMPLE_UNAVAILABLE("bh.g06.ridge"),
  SAMPLE_UNAVAILABLE("bh.g07.projectile.left.fast"), SAMPLE_UNAVAILABLE("bh.g07.projectile.right.fast"),
  SAMPLE_UNAVAILABLE("bh.g07.projectile.left.slow"), SAMPLE_UNAVAILABLE("bh.g07.projectile.right.slow"),
  SAMPLE_UNAVAILABLE("bh.g07.area.a.fast"), SAMPLE_UNAVAILABLE("bh.g07.area.a.slow"),
  SAMPLE_UNAVAILABLE("bh.g07.area.b.fast"), SAMPLE_UNAVAILABLE("bh.g07.area.b.slow"),
  SAMPLE_UNAVAILABLE("bh.g07.area.c.fast"), SAMPLE_UNAVAILABLE("bh.g07.area.c.slow"),
  SAMPLE_UNAVAILABLE("bh.g07.area.d.fast"), SAMPLE_UNAVAILABLE("bh.g07.area.d.slow"),
  SAMPLE_UNAVAILABLE("bh.g08.rain"), SAMPLE_UNAVAILABLE("bh.g12.fireworks"),
};
#define SAMPLE_CATALOG_COUNT (sizeof(SAMPLE_CATALOG) / sizeof(SAMPLE_CATALOG[0]))

// ---------------- 校准区域配置（与双手手套上位机 260821 对齐） ----------------
// 上位机 config.json 的 mapping_groups 顺序及电极范围：
//   0: 左手掌 0..63；1: 左拇+食 64..127；2: 左中+无名 128..191；3: 左小 192..207；
//   4: 右手掌 256..319；5: 右拇+食 320..383；6: 右中+无名 384..447；7: 右小 448..463。
// 同一通道内的两根手指共享物理电压轨；参考对仍逐手指独立，以便校准时定位。
enum OutputChannel : uint8_t {
  OUTPUT_LEFT_PALM = 0,
  OUTPUT_LEFT_THUMB_INDEX = 1,
  OUTPUT_LEFT_MIDDLE_RING = 2,
  OUTPUT_LEFT_LITTLE = 3,
  OUTPUT_RIGHT_PALM = 4,
  OUTPUT_RIGHT_THUMB_INDEX = 5,
  OUTPUT_RIGHT_MIDDLE_RING = 6,
  OUTPUT_RIGHT_LITTLE = 7,
  OUTPUT_CHANNEL_COUNT = 8
};

struct CalibrationRegionConfig {
  const char* regionId;   // 与 R2 FingerId 对齐，如 "left-index"
  uint8_t outputChannel;  // 上位机 volt[0..7] 的同序通道
  const uint16_t* positive;
  uint8_t positiveCount;
  const uint16_t* negative;
  uint8_t negativeCount;
  uint8_t maxVoltageCode;
  bool calibrationSampleDefined;
};

// 用户确认的 8 个校准区参考正/负极对；电极 ID 与上位机二维布局一致。
// 单机调试用 k0…k7 分别预览下列区域，持续输出直到 0/q；同一命令可刷新看门狗。
static const uint16_t CAL_L_PALM_P[] = {33, 35, 37, 40, 44, 45, 50, 53, 59};
static const uint16_t CAL_L_PALM_N[] = {34, 36, 38, 41, 46, 47, 49, 52, 58};
static const uint16_t CAL_R_PALM_P[] = {292, 298, 301, 306, 307, 311, 314, 316, 318};
static const uint16_t CAL_R_PALM_N[] = {293, 299, 302, 304, 305, 310, 313, 315, 317};
static const uint16_t CAL_L_THUMB_P[] = {82,110}; static const uint16_t CAL_L_THUMB_N[] = {69,109};
static const uint16_t CAL_L_MIDDLE_P[] = {146};   static const uint16_t CAL_L_MIDDLE_N[] = {133};
static const uint16_t CAL_L_LITTLE_P[] = {203};   static const uint16_t CAL_L_LITTLE_N[] = {195};
static const uint16_t CAL_R_THUMB_P[] = {325,369}; static const uint16_t CAL_R_THUMB_N[] = {338,370};
static const uint16_t CAL_R_MIDDLE_P[] = {389};   static const uint16_t CAL_R_MIDDLE_N[] = {402};
static const uint16_t CAL_R_LITTLE_P[] = {451};   static const uint16_t CAL_R_LITTLE_N[] = {459};

static const CalibrationRegionConfig CALIBRATION_REGIONS[] = {
  { "left-palm", OUTPUT_LEFT_PALM, CAL_L_PALM_P, 9, CAL_L_PALM_N, 9, 180, true },
  { "left-thumb-index", OUTPUT_LEFT_THUMB_INDEX, CAL_L_THUMB_P, 2, CAL_L_THUMB_N, 2, 180, true },
  { "left-middle-ring", OUTPUT_LEFT_MIDDLE_RING, CAL_L_MIDDLE_P, 1, CAL_L_MIDDLE_N, 1, 180, true },
  { "left-little", OUTPUT_LEFT_LITTLE, CAL_L_LITTLE_P, 1, CAL_L_LITTLE_N, 1, 180, true },
  { "right-palm", OUTPUT_RIGHT_PALM, CAL_R_PALM_P, 9, CAL_R_PALM_N, 9, 180, true },
  { "right-thumb-index", OUTPUT_RIGHT_THUMB_INDEX, CAL_R_THUMB_P, 2, CAL_R_THUMB_N, 2, 180, true },
  { "right-middle-ring", OUTPUT_RIGHT_MIDDLE_RING, CAL_R_MIDDLE_P, 1, CAL_R_MIDDLE_N, 1, 180, true },
  { "right-little", OUTPUT_RIGHT_LITTLE, CAL_R_LITTLE_P, 1, CAL_R_LITTLE_N, 1, 180, true },
};
#define CALIBRATION_REGION_COUNT (sizeof(CALIBRATION_REGIONS) / sizeof(CALIBRATION_REGIONS[0]))

// 校准后按输出通道保存阈值；STOP/样本结束会使实际 PWM 回到 0，
// 但本数组保留本轮校准值，供同一会话内后续样本使用。
static uint8_t outputChannelVoltageCodes[OUTPUT_CHANNEL_COUNT] = {0};
#if ENABLE_DEV_CLI
static uint8_t standaloneTestVoltageCode = 0;
#endif

// ---------------- 校验 ----------------
bool validateElectrodeSet(const uint16_t* pins, uint8_t count, char* err, size_t errLen) {
  if (pins == NULL || count == 0) { snprintf(err, errLen, "empty electrode set"); return false; }
  for (uint8_t i = 0; i < count; i++) {
    if (pins[i] > MAX_ELECTRODE_ID) { snprintf(err, errLen, "electrode %u out of range", pins[i]); return false; }
    for (uint8_t j = i + 1; j < count; j++) {
      if (pins[i] == pins[j]) { snprintf(err, errLen, "duplicate electrode %u", pins[i]); return false; }
    }
  }
  return true;
}

bool validatePair(const ElectrodePair& pair, char* err, size_t errLen) {
  // 显式静默段：用于保留已给时间轴中尚未安全定义电极的区间。
  if (pair.positiveCount == 0 && pair.negativeCount == 0 && pair.positive == NULL && pair.negative == NULL) return true;
  if (pair.positiveCount == 0 || pair.negativeCount == 0) { snprintf(err, errLen, "one-sided electrode pair"); return false; }
  if (!validateElectrodeSet(pair.positive, pair.positiveCount, err, errLen)) return false;
  if (!validateElectrodeSet(pair.negative, pair.negativeCount, err, errLen)) return false;
  for (uint8_t i = 0; i < pair.positiveCount; i++) {
    for (uint8_t j = 0; j < pair.negativeCount; j++) {
      if (pair.positive[i] == pair.negative[j]) {
        snprintf(err, errLen, "electrode %u in both polarities", pair.positive[i]);
        return false;
      }
    }
  }
  return true;
}

bool electrodeBelongsToOutputChannel(uint16_t electrode, uint8_t channel) {
  switch (channel) {
    case OUTPUT_LEFT_PALM: return electrode <= 63;
    case OUTPUT_LEFT_THUMB_INDEX: return electrode >= 64 && electrode <= 127;
    case OUTPUT_LEFT_MIDDLE_RING: return electrode >= 128 && electrode <= 191;
    case OUTPUT_LEFT_LITTLE: return electrode >= 192 && electrode <= 207;
    case OUTPUT_RIGHT_PALM: return electrode >= 256 && electrode <= 319;
    case OUTPUT_RIGHT_THUMB_INDEX: return electrode >= 320 && electrode <= 383;
    case OUTPUT_RIGHT_MIDDLE_RING: return electrode >= 384 && electrode <= 447;
    case OUTPUT_RIGHT_LITTLE: return electrode >= 448 && electrode <= 463;
    default: return false;
  }
}

bool validateCalibrationMap(char* err, size_t errLen) {
  if (CALIBRATION_REGION_COUNT != 8) {
    snprintf(err, errLen, "expected 8 calibration regions");
    return false;
  }
  for (uint8_t i = 0; i < CALIBRATION_REGION_COUNT; i++) {
    const CalibrationRegionConfig& region = CALIBRATION_REGIONS[i];
    if (region.regionId == NULL || region.regionId[0] == '\0') {
      snprintf(err, errLen, "calibration region %u has no id", i);
      return false;
    }
    if (region.outputChannel >= OUTPUT_CHANNEL_COUNT || region.maxVoltageCode > 180) {
      snprintf(err, errLen, "calibration region %u has invalid channel/output", i);
      return false;
    }
    if (!region.calibrationSampleDefined) continue;
    ElectrodePair pair = { region.positive, region.positiveCount, region.negative, region.negativeCount };
    if (!validatePair(pair, err, errLen)) return false;
    for (uint8_t p = 0; p < pair.positiveCount; p++) {
      if (!electrodeBelongsToOutputChannel(pair.positive[p], region.outputChannel)) {
        snprintf(err, errLen, "positive electrode outside output channel");
        return false;
      }
    }
    for (uint8_t n = 0; n < pair.negativeCount; n++) {
      if (!electrodeBelongsToOutputChannel(pair.negative[n], region.outputChannel)) {
        snprintf(err, errLen, "negative electrode outside output channel");
        return false;
      }
    }
  }
  return true;
}

bool validateSample(const SampleDefinition& s, char* err, size_t errLen) {
  if (s.id == NULL || s.id[0] == '\0') { snprintf(err, errLen, "empty sample id"); return false; }
  if (s.durationUs == 0 || s.durationUs > MAX_SAMPLE_DURATION_US) { snprintf(err, errLen, "duration out of range"); return false; }
  if (s.segmentCount == 0 || s.segments == NULL) { snprintf(err, errLen, "no segments"); return false; }
  if (s.pulse.phaseWidthUs == 0 || s.pulse.phaseWidthUs > MAX_PHASE_WIDTH_US) { snprintf(err, errLen, "phaseWidthUs out of range"); return false; }
  if (s.pulse.pulsePeriodUs == 0 || s.pulse.pulsePeriodUs > MAX_PULSE_PERIOD_US) { snprintf(err, errLen, "pulsePeriodUs out of range"); return false; }
  if (s.pulse.burstPeriodUs == 0) { snprintf(err, errLen, "burstPeriodUs zero"); return false; }
  if (s.pulse.pulseCount == 0) { snprintf(err, errLen, "pulseCount zero"); return false; }
  if (s.pulse.phaseBalancePercent > 100) { snprintf(err, errLen, "phaseBalancePercent out of range"); return false; }
  uint32_t lastEndUs = 0;
  for (uint8_t i = 0; i < s.segmentCount; i++) {
    const SampleSegment& seg = s.segments[i];
    if (seg.startUs != lastEndUs) { snprintf(err, errLen, "segment %u not contiguous at %lu us", i, seg.startUs); return false; }
    if (seg.endUs <= seg.startUs) { snprintf(err, errLen, "segment %u inverted", i); return false; }
    if (seg.endUs > s.durationUs) { snprintf(err, errLen, "segment %u exceeds duration", i); return false; }
    if (!validatePair(seg.electrodes, err, errLen)) return false;
    lastEndUs = seg.endUs;
  }
  if (lastEndUs != s.durationUs) { snprintf(err, errLen, "segments do not cover duration"); return false; }
  if (s.pwRamp != NULL) {
    for (uint8_t i = 0; i < s.pwRampCount; i++) {
      if (s.pwRamp[i].phaseWidthUs == 0 || s.pwRamp[i].phaseWidthUs > MAX_PHASE_WIDTH_US) {
        snprintf(err, errLen, "pw ramp point %u out of range", i);
        return false;
      }
    }
  }
  return true;
}

uint32_t cycleUs(const SampleDefinition& s, uint32_t elapsedUs) {
  return s.repeatUs > 0 ? elapsedUs % s.repeatUs : elapsedUs;
}

uint16_t phaseWidthAt(const SampleDefinition& s, uint32_t elapsedUs) {
  const uint32_t rawElapsedUs = elapsedUs;
  elapsedUs = cycleUs(s, elapsedUs);
  uint16_t fallback = s.pulse.phaseWidthUs;
  if (s.pwRamp == NULL || s.pwRampCount == 0) return lookupPulseWidth(s.id, rawElapsedUs, fallback);
  if (elapsedUs <= s.pwRamp[0].atUs) return lookupPulseWidth(s.id, rawElapsedUs, s.pwRamp[0].phaseWidthUs);
  for (uint8_t i = 1; i < s.pwRampCount; i++) {
    if (elapsedUs <= s.pwRamp[i].atUs) {
      const PwRampPoint& a = s.pwRamp[i - 1];
      const PwRampPoint& b = s.pwRamp[i];
      uint32_t span = b.atUs - a.atUs;
      if (span == 0) return lookupPulseWidth(s.id, rawElapsedUs, b.phaseWidthUs);
      fallback = a.phaseWidthUs + (uint32_t)(b.phaseWidthUs - a.phaseWidthUs) * (elapsedUs - a.atUs) / span;
      return lookupPulseWidth(s.id, rawElapsedUs, fallback);
    }
  }
  return lookupPulseWidth(s.id, rawElapsedUs, s.pwRamp[s.pwRampCount - 1].phaseWidthUs);
}

const SampleDefinition* findSample(const char* id) {
  for (uint16_t i = 0; i < SAMPLE_CATALOG_COUNT; i++) {
    if (strcmp(SAMPLE_CATALOG[i].id, id) == 0) return &SAMPLE_CATALOG[i];
  }
  return NULL;
}

// ---------------- 安全输出层（DRY_RUN 只打印，不输出） ----------------
void outputSetVolt(uint8_t code) {
#if DRY_RUN
  Serial.print("[DRY] volt="); Serial.println(code);
#else
  hv_set_volt(code);
#endif
}

void outputSetPin(uint16_t id, uint8_t value) {
#if DRY_RUN
  if (value == FLOAT) return;  // 高阻无需打印，避免刷屏
  Serial.print("[DRY] pin "); Serial.print(id); Serial.print("="); Serial.println(value == 1 ? '+' : '-');
#else
  hv_set_pin(id, value);
#endif
}

void outputFloatAll() {
#if DRY_RUN
  Serial.println("[DRY] all float + volt=0");
#else
  hv_init();        // 全部电极高阻
  hv_set_volt(0);   // 输出归零
#endif
}

// 按电极对涉及的所有输出通道取已校准等级：
// 单通道 → 该通道等级；跨通道（如 BH 双手掌） → 取各通道已校准等级的较小值，
// 保护更敏感的一侧；全部未校准（0）→ 回退全局最后等级，绝不静默用 0。
extern volatile uint8_t voltageCode;  // 前向声明：定义于下方状态变量区
static uint8_t playbackVoltageForPair(const ElectrodePair& pair) {
  uint8_t distinct[8];
  uint8_t distinctCount = 0;
  const uint16_t* sets[2] = { pair.positive, pair.negative };
  const uint8_t counts[2] = { pair.positiveCount, pair.negativeCount };
  for (uint8_t s = 0; s < 2; s++) {
    for (uint8_t i = 0; i < counts[s]; i++) {
      for (uint8_t ch = 0; ch < OUTPUT_CHANNEL_COUNT; ch++) {
        if (!electrodeBelongsToOutputChannel(sets[s][i], ch)) continue;
        bool dup = false;
        for (uint8_t j = 0; j < distinctCount; j++) {
          if (distinct[j] == ch) { dup = true; break; }
        }
        if (!dup) distinct[distinctCount++] = ch;
        break;
      }
    }
  }
  if (distinctCount == 0) return voltageCode;
  uint8_t best = 0;
  for (uint8_t i = 0; i < distinctCount; i++) {
    uint8_t code = outputChannelVoltageCodes[distinct[i]];
    if (code == 0) continue;
    if (best == 0 || code < best) best = code;
  }
  return best != 0 ? best : voltageCode;
}


// ---------------- 协议 v2 帧定义（设计规格 §4；golden vectors 与游戏 hapticProtocol.ts 一致） ----------------
// 帧：MAGIC(0x52 0x32) | VERSION(1) | OPCODE(1) | TXN_ID(4 LE) | LEN(2 LE) | PAYLOAD | CRC16(2 LE)
#define MAGIC0 0x52
#define MAGIC1 0x32
#define PROTO_VERSION 1
#define MAX_PAYLOAD 240

// 主机 -> 设备
#define OP_HELLO 0x01
#define OP_GET_STATUS 0x02
#define OP_ARM 0x03
#define OP_SET_CALIBRATION 0x04
#define OP_START_CALIBRATION 0x05
#define OP_PREPARE_SAMPLE 0x06
#define OP_COMMIT_AFTER 0x07
#define OP_STOP 0x08
// 设备 -> 主机
#define OP_HELLO_ACK 0x81
#define OP_STATUS 0x82
#define OP_ARMED 0x83
#define OP_CALIBRATION_APPLIED 0x84
#define OP_CALIBRATION_STARTED 0x85
#define OP_PREPARED 0x86
#define OP_STARTED 0x87
#define OP_COMPLETE 0x88
#define OP_STOPPED 0x89
#define OP_ERROR 0x8A

// 错误码（与游戏侧一致）
#define ERR_BAD_CRC 0x01
#define ERR_BAD_FRAME 0x02
#define ERR_BAD_STATE 0x03
#define ERR_NOT_ARMED 0x04
#define ERR_UNKNOWN_SAMPLE 0x05
#define ERR_SAMPLE_UNDEFINED 0x06
#define ERR_INVALID_ELECTRODE_MAP 0x07
#define ERR_INVALID_OUTPUT 0x08
#define ERR_BUSY 0x09
#define ERR_WATCHDOG_STOP 0x0A
#define ERR_TIMEOUT 0x0B

// CRC16-CCITT (poly 0x1021, init 0xFFFF, 无反射)
static uint16_t crc16Ccitt(const uint8_t* data, uint16_t len) {
  uint16_t crc = 0xFFFF;
  for (uint16_t i = 0; i < len; i++) {
    crc ^= (uint16_t)data[i] << 8;
    for (uint8_t b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
  }
  return crc;
}

static uint8_t txBuffer[10 + MAX_PAYLOAD + 2];

// 发送响应帧；txnId 回显请求。payload=NULL 表示空载荷。
void sendFrame(uint8_t opcode, uint32_t txnId, const uint8_t* payload, uint16_t payloadLen) {
  txBuffer[0] = MAGIC0; txBuffer[1] = MAGIC1; txBuffer[2] = PROTO_VERSION; txBuffer[3] = opcode;
  txBuffer[4] = txnId & 0xFF; txBuffer[5] = (txnId >> 8) & 0xFF;
  txBuffer[6] = (txnId >> 16) & 0xFF; txBuffer[7] = (txnId >> 24) & 0xFF;
  txBuffer[8] = payloadLen & 0xFF; txBuffer[9] = (payloadLen >> 8) & 0xFF;
  if (payloadLen > 0 && payload != NULL) memcpy(txBuffer + 10, payload, payloadLen);
  uint16_t crc = crc16Ccitt(txBuffer, 10 + payloadLen);
  txBuffer[10 + payloadLen] = crc & 0xFF; txBuffer[11 + payloadLen] = (crc >> 8) & 0xFF;
  Serial.write(txBuffer, 12 + payloadLen);
}

void sendError(uint32_t txnId, uint8_t code, const char* detail) {
  uint8_t payload[64];
  payload[0] = code;
  uint8_t n = 1;
  if (detail != NULL) {
    while (*detail && n < sizeof(payload)) payload[n++] = (uint8_t)(*detail++);
  }
  sendFrame(OP_ERROR, txnId, payload, n);
}

// ---------------- 设备状态机 ----------------
enum DeviceState : uint8_t {
  STATE_CONNECTED_SAFE = 0,  // 上电默认：输出 0 + 全部高阻
  STATE_ARMED_IDLE,          // 操作者已 ARM，未准备样本
  STATE_PREPARING,           // 校验/装载样本中（本固件为同步校验，瞬时完成）
  STATE_PREPARED,            // 样本已装载，未输出
  STATE_SCHEDULED,           // 已提交，等待 delayUs 后起播
  STATE_PLAYING,             // 输出中
  STATE_FAULT                // 故障：输出 0 + 全部高阻
};

// 参数用 uint8_t 以避免 arduino-builder 自动原型与 sketch 内 enum 的冲突
const char* stateName(uint8_t s) {
  switch ((DeviceState)s) {
    case STATE_CONNECTED_SAFE: return "CONNECTED_SAFE";
    case STATE_ARMED_IDLE: return "ARMED_IDLE";
    case STATE_PREPARING: return "PREPARING";
    case STATE_PREPARED: return "PREPARED";
    case STATE_SCHEDULED: return "SCHEDULED";
    case STATE_PLAYING: return "PLAYING";
    case STATE_FAULT: return "FAULT";
    default: return "?";
  }
}

volatile DeviceState deviceState = STATE_CONNECTED_SAFE;
volatile bool armed = false;
volatile uint8_t voltageCode = 0;
const SampleDefinition* preparedSample = NULL;
uint32_t playStartUs = 0;       // SCHEDULED 起播点（micros 目标）
uint32_t sampleStartUs = 0;     // PLAYING 实际起播（micros）
uint32_t lastBurstUs = 0;
uint32_t lastHostActivityMs = 0;
int lastSegmentIndex = -1;
volatile uint8_t faultCode = 0;
uint32_t playTxnId = 0;   // 当前 PLAYING 对应的 COMMIT 事务号
bool calibrationActive = false;
uint32_t calibrationTxn = 0;
uint32_t calibrationBurstsDone = 0;
uint32_t calibrationLastBurstUs = 0;
const CalibrationRegionConfig* calibrationRegion = NULL;

void enterSafeState(uint8_t fault) {
  deviceState = STATE_CONNECTED_SAFE;
  armed = false;
  // 不归零 voltageCode：STOP/故障时硬件输出已由 outputFloatAll() 归零并高阻，
  // 但保留最后一次已应用的校准等级，供后续样本播放沿用（协议 v2 设计意图）。
  preparedSample = NULL;
  lastSegmentIndex = -1;
  calibrationActive = false;
  calibrationRegion = NULL;
  outputFloatAll();
  if (fault != 0) {
    faultCode = fault;
    deviceState = STATE_FAULT;
#if SERIAL_DEBUG
    Serial.print("[FAULT] "); Serial.println(fault);
#endif
  }
}

void armOutput() {
  armed = true;
  deviceState = STATE_ARMED_IDLE;
#if SERIAL_DEBUG
  Serial.println("[状态] ARMED_IDLE");
#endif
}

// 正常完成一个 cue：立即归零并高阻，但保留 ARM，供同一游戏内的下一个 cue 使用。
// 只有 STOP、断开或故障才调用 enterSafeState() 并撤销 ARM。
void completeSampleToArmedIdle() {
  outputFloatAll();
  preparedSample = NULL;
  lastSegmentIndex = -1;
  deviceState = armed ? STATE_ARMED_IDLE : STATE_CONNECTED_SAFE;
}

// ---------------- 样本调度（非阻塞） ----------------
// 每次脉冲相位都先设置再延时，STOP 在 loop 中随时可打断。
void emitBiphasicBurst(const ElectrodePair& pair, uint16_t pwUs, uint8_t pulseCount) {
  const uint16_t gapUs = 2;
  for (uint8_t n = 0; n < pulseCount; n++) {
    // 正相
    for (uint8_t i = 0; i < pair.positiveCount; i++) outputSetPin(pair.positive[i], 1);
    for (uint8_t i = 0; i < pair.negativeCount; i++) outputSetPin(pair.negative[i], 0);
    delayMicroseconds(pwUs);
    for (uint8_t i = 0; i < pair.positiveCount; i++) outputSetPin(pair.positive[i], FLOAT);
    for (uint8_t i = 0; i < pair.negativeCount; i++) outputSetPin(pair.negative[i], FLOAT);
    delayMicroseconds(gapUs);
    // 负相（电荷平衡）
    for (uint8_t i = 0; i < pair.positiveCount; i++) outputSetPin(pair.positive[i], 0);
    for (uint8_t i = 0; i < pair.negativeCount; i++) outputSetPin(pair.negative[i], 1);
    delayMicroseconds(pwUs);
    for (uint8_t i = 0; i < pair.positiveCount; i++) outputSetPin(pair.positive[i], FLOAT);
    for (uint8_t i = 0; i < pair.negativeCount; i++) outputSetPin(pair.negative[i], FLOAT);
    delayMicroseconds(gapUs);
  }
}

int segmentIndexAt(const SampleDefinition& s, uint32_t elapsedUs) {
  elapsedUs = cycleUs(s, elapsedUs);
  for (uint8_t i = 0; i < s.segmentCount; i++) {
    if (elapsedUs >= s.segments[i].startUs && elapsedUs < s.segments[i].endUs) return i;
  }
  return -1;
}

// BH 固定使用双手掌非空间电极组；其时间、频率、PN=3、50% 双相平衡和 PW
// 查表全部来自同名 STH 样本。此解析器同时供协议 v2 与 Arduino CLI 使用，
// 防止两条入口对同一 bh.* ID 给出不同结果。
static const uint16_t BH_PALM_POSITIVE[] = {33,35,37,40,44,45,50,53,59,292,298,301,306,307,311,314,316,318};
static const uint16_t BH_PALM_NEGATIVE[] = {34,36,38,41,46,47,49,52,58,293,299,302,304,305,310,313,315,317};

const SampleDefinition* resolvePlayableSample(const char* id) {
  const SampleDefinition* sample = findSample(id);
  if ((sample == NULL || !sample->available) && strncmp(id, "bh.", 3) == 0) {
    static ElectrodePair fixedBilateralPalm = { BH_PALM_POSITIVE, 18, BH_PALM_NEGATIVE, 18 };
    static SampleSegment bhSegment;
    static SampleDefinition bhSample;
    static char bhSampleId[65];
    char sthId[65];
    snprintf(bhSampleId, sizeof(bhSampleId), "%s", id);
    snprintf(sthId, sizeof(sthId), "sth.%s", id + 3);
    const SampleDefinition* source = findSample(sthId);
    if (source != NULL && source->available) {
      bhSegment = {0, source->durationUs, fixedBilateralPalm};
      bhSample = *source;
      bhSample.id = bhSampleId;
      bhSample.segments = &bhSegment;
      bhSample.segmentCount = 1;
      return &bhSample;
    }
  }
  return sample;
}

bool prepareSample(const char* id, char* err, size_t errLen) {
  if (deviceState == STATE_PLAYING || deviceState == STATE_SCHEDULED) {
    enterSafeState(0);  // 改样本前先停止并隔离
    deviceState = STATE_ARMED_IDLE;
  }
  if (!armed) { snprintf(err, errLen, "NOT_ARMED"); return false; }
  const SampleDefinition* sample = resolvePlayableSample(id);
  if (sample == NULL) { snprintf(err, errLen, "UNKNOWN_SAMPLE %s", id); return false; }
  if (!sample->available) { snprintf(err, errLen, "SAMPLE_UNDEFINED %s", id); return false; }
  deviceState = STATE_PREPARING;
  if (!validateSample(*sample, err, errLen)) { enterSafeState(7); return false; }
  preparedSample = sample;
  deviceState = STATE_PREPARED;
  return true;
}

// 提交：delayUs 后起播（微秒延迟在 SCHEDULED 状态用 micros 计时）。
bool commitAfter(uint32_t delayUs) {
  if (deviceState != STATE_PREPARED || preparedSample == NULL) {
#if SERIAL_DEBUG
    Serial.println("[拒绝] COMMIT 需先处于 PREPARED。");
#endif
    return false;
  }
  deviceState = STATE_SCHEDULED;
  playStartUs = micros() + delayUs;
#if SERIAL_DEBUG
  Serial.print("[状态] SCHEDULED delay="); Serial.print(delayUs); Serial.println("us");
#endif
  return true;
}

#if ENABLE_DEV_CLI
// 单机调试快捷键。编号和可用 STH 样本目录对应；未提供数据的样本不会出现在此表中。
const char* standaloneSampleIdForInput(const String& input) {
  if (input == "1") return "sth.g01.unlock";
  if (input == "2") return "sth.g02.rubble";
  if (input == "3") return "sth.g03.fire";
  if (input == "4") return "sth.g04.ghost";
  if (input == "51") return "sth.g05.chest.left";
  if (input == "52") return "sth.g05.chest.right";
  if (input == "6") return "sth.g06.ridge";
  if (input == "71") return "sth.g07.projectile.left.fast";
  if (input == "72") return "sth.g07.projectile.right.fast";
  if (input == "73") return "sth.g07.projectile.left.slow";
  if (input == "74") return "sth.g07.projectile.right.slow";
  if (input == "75") return "sth.g07.area.b.fast";
  if (input == "76") return "sth.g07.area.b.slow";
  if (input == "77") return "sth.g07.area.c.fast";
  if (input == "78") return "sth.g07.area.c.slow";
  if (input == "79") return "sth.g07.area.a.fast";
  if (input == "80") return "sth.g07.area.a.slow";
  if (input == "81") return "sth.g07.area.d.fast";
  if (input == "82") return "sth.g07.area.d.slow";
  if (input == "8") return "sth.g08.rain";
  if (input == "12") return "sth.g12.fireworks";
  // BH 使用对应 STH 的时程/频率/PW 查表，但固定为双手掌非空间电极组。
  if (input == "101") return "bh.g01.unlock";
  if (input == "102") return "bh.g02.rubble";
  if (input == "103") return "bh.g03.fire";
  if (input == "104") return "bh.g04.ghost";
  if (input == "151") return "bh.g05.chest.left";
  if (input == "152") return "bh.g05.chest.right";
  if (input == "106") return "bh.g06.ridge";
  if (input == "171") return "bh.g07.projectile.left.fast";
  if (input == "172") return "bh.g07.projectile.right.fast";
  if (input == "173") return "bh.g07.projectile.left.slow";
  if (input == "174") return "bh.g07.projectile.right.slow";
  if (input == "179") return "bh.g07.area.a.fast";
  if (input == "180") return "bh.g07.area.a.slow";
  if (input == "175") return "bh.g07.area.b.fast";
  if (input == "176") return "bh.g07.area.b.slow";
  if (input == "177") return "bh.g07.area.c.fast";
  if (input == "178") return "bh.g07.area.c.slow";
  if (input == "181") return "bh.g07.area.d.fast";
  if (input == "182") return "bh.g07.area.d.slow";
  if (input == "108") return "bh.g08.rain";
  if (input == "112") return "bh.g12.fireworks";
  return NULL;
}

void printStandaloneCliHelp() {
  Serial.println("单机样本测试：a=ARM；v <0-180>=设置测试输出等级；0/q=立即停止");
  Serial.println("1=G01 2=G02石块 3=G03火焰 4=G04幽灵 51/52=G05宝箱左/右 6=G06/G10划棱");
  Serial.println("71/72=G07/G11飞行物快左/右 73/74=飞行物慢左/右；危险区：79/80=A(最左)快/慢 75/76=B快/慢");
  Serial.println("77/78=C快/慢 81/82=D(最右)快/慢；A/B/C/D=从左至右第1/2/3/4个锚点");
  Serial.println("8=G08下雨 12=G12烟花；s=状态；c=目录");
  Serial.println("BH基础触觉：在对应 STH 编号前加 100；101-104、106、108、112，151/152，171-182。");
  Serial.println("例：101=BH G01；179/180=BH 最左危险区快/慢。BH 固定双手掌非空间电极组。");
  Serial.println("校准预览：k0左掌 k1左拇食 k2左中无名 k3左小；k4右掌 k5右拇食 k6右中无名 k7右小");
  Serial.println("校准持续至 0/q；约每 10 秒重复相同 k0…k7 保持。p/r 仍为 k0/k4 别名。");
}

void setStandaloneTestVoltage(const String& input) {
  const char* raw = input.c_str() + 2;
  char* end = NULL;
  long parsed = strtol(raw, &end, 10);
  if (raw == end || *end != '\0' || parsed < 0 || parsed > STANDALONE_TEST_MAX_VOLTAGE_CODE) {
    Serial.println("无效等级：请输入 v <0-180>");
    return;
  }
  // 改等级前始终停止并隔离；此命令不会自行 ARM 或输出。
  enterSafeState(0);
  standaloneTestVoltageCode = (uint8_t)parsed;
  Serial.print("测试输出等级已保存："); Serial.println(standaloneTestVoltageCode);
  Serial.println("请先输入 a ARM，再输入样本编号。");
}

void startStandaloneSample(const char* sampleId) {
  if (standaloneTestVoltageCode == 0) {
    Serial.println("standalone-cli: voltage must be nonzero; use v <0-180> first");
    return;
  }
  if (!armed) {
    Serial.println("已拒绝：请先输入 a ARM。");
    return;
  }
  char err[96];
  if (!prepareSample(sampleId, err, sizeof(err))) {
    Serial.print("已拒绝："); Serial.println(err);
    return;
  }
  if (!commitAfter(200000UL)) return;
  Serial.print("将播放样本 "); Serial.print(sampleId);
  Serial.print("，测试等级 "); Serial.println(standaloneTestVoltageCode);
}

void startStandaloneCalibration(uint8_t regionIndex) {
  if (standaloneTestVoltageCode == 0) {
    Serial.println("standalone-cli: voltage must be nonzero; use v <0-180> first");
    return;
  }
  if (!armed) {
    Serial.println("已拒绝：请先输入 a ARM。");
    return;
  }
  if (regionIndex >= CALIBRATION_REGION_COUNT) {
    Serial.println("已拒绝：校准区域必须为 k0…k7。");
    return;
  }
  const CalibrationRegionConfig* region = &CALIBRATION_REGIONS[regionIndex];
  if (!region->calibrationSampleDefined) {
    Serial.println("已拒绝：该校准区域未定义参考电极。");
    return;
  }
  if (calibrationActive && calibrationRegion == region) {
    // 再次发送同一命令仅刷新看门狗，不改变当前输出。
    Serial.print(region->regionId); Serial.println(": keepalive");
    return;
  }
  if (deviceState == STATE_PLAYING || deviceState == STATE_SCHEDULED) {
    Serial.println("已拒绝：样本播放中，请先输入 0 停止。");
    return;
  }
  calibrationRegion = region;
  calibrationTxn = 0;
  calibrationBurstsDone = 0;
  calibrationLastBurstUs = micros() - 33333UL;
  calibrationActive = true;
  Serial.print(region->regionId); Serial.print(": started, level ");
  Serial.println(standaloneTestVoltageCode);
}

void startStandaloneLeftPalmCalibration() {
  startStandaloneCalibration(OUTPUT_LEFT_PALM);
}

void startStandaloneRightPalmCalibration() {
  startStandaloneCalibration(OUTPUT_RIGHT_PALM);
}
#endif

void schedulerTick() {
  uint32_t nowUs = micros();

  // 命令看门狗：普通空闲状态下主机静默超时 -> 安全停止。
  // 校准由操作者显式 START，必须持续到 STOP/确认校准/故障，不能被 10 秒静默误停。
  if (deviceState != STATE_PLAYING && !calibrationActive &&
      (armed || deviceState != STATE_CONNECTED_SAFE) &&
      (uint32_t)(millis() - lastHostActivityMs) > COMMAND_WATCHDOG_MS) {
    enterSafeState(0);
  }

  if (deviceState == STATE_SCHEDULED) {
    if ((int32_t)(nowUs - playStartUs) >= 0) {
      deviceState = STATE_PLAYING;
      sampleStartUs = nowUs;
      lastBurstUs = nowUs - preparedSample->pulse.burstPeriodUs;  // 首个 burst 立即
      lastSegmentIndex = -1;
      uint8_t p[4];
      p[0] = nowUs & 0xFF; p[1] = (nowUs >> 8) & 0xFF; p[2] = (nowUs >> 16) & 0xFF; p[3] = (nowUs >> 24) & 0xFF;
#if !ENABLE_DEV_CLI
      sendFrame(OP_STARTED, playTxnId, p, 4);
#endif
#if SERIAL_DEBUG
      Serial.println("[状态] PLAYING");
#endif
    }
    return;
  }

  if (deviceState != STATE_PLAYING || preparedSample == NULL) return;

  const SampleDefinition& s = *preparedSample;
  uint32_t elapsedUs = nowUs - sampleStartUs;

  // 最大时长看门狗（+ 冗余余量）：防止任何路径下的无限输出
  if (elapsedUs > s.durationUs + MAX_DURATION_SLACK_US) {
    enterSafeState(8);
#if !ENABLE_DEV_CLI
    sendError(playTxnId, ERR_WATCHDOG_STOP, NULL);
#endif
#if SERIAL_DEBUG
    Serial.println("[FAULT] WATCHDOG_STOP");
#endif
    return;
  }

  if ((uint32_t)(nowUs - lastBurstUs) < s.pulse.burstPeriodUs) return;
  lastBurstUs = nowUs;

  if (elapsedUs >= s.durationUs) {
    // 自然完成：全部电极高阻、输出归零，并回报 COMPLETE
    uint8_t p[80];
    uint8_t idLen = (uint8_t)strlen(s.id);
    memcpy(p, s.id, idLen);
    uint32_t e = elapsedUs;
    p[idLen] = e & 0xFF; p[idLen + 1] = (e >> 8) & 0xFF; p[idLen + 2] = (e >> 16) & 0xFF; p[idLen + 3] = (e >> 24) & 0xFF;
#if !ENABLE_DEV_CLI
    sendFrame(OP_COMPLETE, playTxnId, p, idLen + 4);
#endif
#if SERIAL_DEBUG
    Serial.print("[完成] "); Serial.println(s.id);
#endif
    completeSampleToArmedIdle();
    return;
  }

  int seg = segmentIndexAt(s, elapsedUs);
  if (seg < 0) {
    enterSafeState(9);
    return;
  }
  if (seg != lastSegmentIndex) {
    lastSegmentIndex = seg;
#if SERIAL_DEBUG
    Serial.print("[段] "); Serial.print(seg + 1); Serial.print("/");
    Serial.println(s.segmentCount);
#endif
  }
  // 单机与正式协议均必须在每个 burst 前明确打开已确认的输出等级。
  // CLI 使用测试等级；协议 v2 使用该电极对所属区域的已校准等级（未校准回退全局）。
  const ElectrodePair& pair = s.segments[seg].electrodes;
#if ENABLE_DEV_CLI
  outputSetVolt(standaloneTestVoltageCode);
#else
  outputSetVolt(playbackVoltageForPair(pair));
#endif
  if (pair.positiveCount == 0 && pair.negativeCount == 0) outputFloatAll();
  else emitBiphasicBurst(pair, phaseWidthAt(s, elapsedUs), s.pulse.pulseCount);
  outputSetVolt(0);
}

// ---------------- 目录诊断（不产生任何刺激） ----------------
void printCatalogDiagnostic() {
  Serial.println("== 样本目录诊断（不刺激） ==");
  uint16_t unavailable = 0;
  char err[96];
  for (uint16_t i = 0; i < SAMPLE_CATALOG_COUNT; i++) {
    const SampleDefinition& s = SAMPLE_CATALOG[i];
    bool ok = validateSample(s, err, sizeof(err));
    Serial.print(s.id);
    Serial.print(" available=");
    Serial.print(s.available ? "yes" : "no");
    Serial.print(" valid=");
    if (ok) {
      Serial.print("OK dur="); Serial.print(s.durationUs / 1000UL); Serial.print("ms segs="); Serial.println(s.segmentCount);
    } else {
      Serial.print("FAIL ("); Serial.print(err); Serial.println(")");
    }
    if (!s.available) unavailable++;
  }
  Serial.print("共 "); Serial.print(SAMPLE_CATALOG_COUNT);
  Serial.print(" 个样本，"); Serial.print(unavailable);
  Serial.println(" 个尚未提供数据（available=false）。");
  Serial.print("DRY_RUN="); Serial.println(DRY_RUN);
  Serial.print("校准区域数："); Serial.println(CALIBRATION_REGION_COUNT);
  Serial.println("== 诊断结束 ==");
}

void printStatus() {
  Serial.print("[状态] "); Serial.println(stateName((DeviceState)deviceState));
  Serial.print("armed="); Serial.println(armed ? 1 : 0);
  Serial.print("voltageCode="); Serial.println(voltageCode);
  Serial.print("prepared="); Serial.println(preparedSample ? preparedSample->id : "(none)");
  Serial.print("faultCode="); Serial.println(faultCode);
}


// ---------------- 协议 v2 字节流解析与命令处理 ----------------
static uint8_t rxBuffer[10 + MAX_PAYLOAD + 2];
static uint16_t rxLen = 0;
static bool rxSync = false;

void handleV2Frame(uint8_t opcode, uint32_t txnId, const uint8_t* payload, uint16_t len);

void protocolV2Poll() {
  while (Serial.available() > 0) {
    uint8_t b = Serial.read();
    lastHostActivityMs = millis();
    if (!rxSync) {
      // 找 MAGIC（允许前缀垃圾）
      if (rxLen == 0 && b != MAGIC0) continue;
      if (rxLen == 1 && b != MAGIC1) { rxLen = (b == MAGIC0) ? 1 : 0; continue; }
    }
    rxBuffer[rxLen++] = b;
    rxSync = true;
    if (rxLen >= 10) {
      uint16_t payloadLen = rxBuffer[8] | ((uint16_t)rxBuffer[9] << 8);
      if (payloadLen > MAX_PAYLOAD) { rxLen = 0; rxSync = false; continue; }  // 丢弃重同步
      uint16_t total = 10 + payloadLen + 2;
      if (rxLen >= total) {
        uint16_t crcRx = rxBuffer[10 + payloadLen] | ((uint16_t)rxBuffer[11 + payloadLen] << 8);
        uint16_t crcCalc = crc16Ccitt(rxBuffer, 10 + payloadLen);
        uint32_t txn = (uint32_t)rxBuffer[4] | ((uint32_t)rxBuffer[5] << 8) | ((uint32_t)rxBuffer[6] << 16) | ((uint32_t)rxBuffer[7] << 24);
        if (crcRx != crcCalc || rxBuffer[2] != PROTO_VERSION) {
          sendError(txn, ERR_BAD_CRC, "CRC");
          // 丢弃 1 字节后重新同步
          for (uint16_t i = 1; i < rxLen; i++) rxBuffer[i - 1] = rxBuffer[i];
          rxLen -= 1; rxSync = false;
          continue;
        }
        handleV2Frame(rxBuffer[3], txn, rxBuffer + 10, payloadLen);
        rxLen = 0; rxSync = false;
      }
    }
  }
}

// 校准脉冲：区域电极 + 已应用 voltageCode；START 后持续直到 STOP。

void calibrationTick() {
  if (!calibrationActive || calibrationRegion == NULL) return;
  uint32_t nowUs = micros();
  if ((uint32_t)(nowUs - calibrationLastBurstUs) < 10000UL) return;
  calibrationLastBurstUs = nowUs;
  // 过去 SET_CALIBRATION 只更新了变量，校准脉冲没有把它送到 PWM 输出层。
  // 现在在每次 burst 前应用该区域所属上位机通道的已校准等级，burst 后立刻归零。
  uint8_t channel = calibrationRegion->outputChannel;
  uint8_t code = outputChannelVoltageCodes[channel];
#if ENABLE_DEV_CLI
  // 单机模式使用 v 命令明确设置的统一测试等级；网页协议不经过该分支。
  code = standaloneTestVoltageCode;
#endif
  outputSetVolt(code);
  ElectrodePair pair = { calibrationRegion->positive, calibrationRegion->positiveCount,
                         calibrationRegion->negative, calibrationRegion->negativeCount };
  emitBiphasicBurst(pair, CALIBRATION_PULSE_PW_US, 3);
  outputSetVolt(0);
  calibrationBurstsDone++;
}

void handleV2Frame(uint8_t opcode, uint32_t txnId, const uint8_t* payload, uint16_t len) {
  switch (opcode) {
    case OP_HELLO: {
      uint8_t p[4] = { FW_MAJOR, FW_MINOR, SAMPLE_TABLE_VERSION, (uint8_t)(DRY_RUN ? 1 : 0) };
      sendFrame(OP_HELLO_ACK, txnId, p, 4);
      break;
    }
    case OP_GET_STATUS: {
      uint8_t p[80];
      p[0] = (uint8_t)deviceState;
      p[1] = armed ? 1 : 0;
      p[2] = voltageCode;
      const char* id = preparedSample ? preparedSample->id : "";
      uint8_t idLen = (uint8_t)strlen(id);
      p[3] = idLen;
      memcpy(p + 4, id, idLen);
      p[4 + idLen] = faultCode;
      sendFrame(OP_STATUS, txnId, p, 5 + idLen);
      break;
    }
    case OP_ARM: {
      if (armed) { sendError(txnId, ERR_BAD_STATE, "already armed"); break; }
      armOutput();
      sendFrame(OP_ARMED, txnId, NULL, 0);
      break;
    }
    case OP_SET_CALIBRATION: {
      if (len < 2) { sendError(txnId, ERR_BAD_FRAME, "len"); break; }
      if (!armed) { sendError(txnId, ERR_NOT_ARMED, NULL); break; }
      uint8_t regionIdx = payload[0];
      uint8_t code = payload[1];
      if (regionIdx >= CALIBRATION_REGION_COUNT) { sendError(txnId, ERR_INVALID_ELECTRODE_MAP, "region"); break; }
      if (code > CALIBRATION_REGIONS[regionIdx].maxVoltageCode) { sendError(txnId, ERR_INVALID_OUTPUT, "code"); break; }
      if (deviceState == STATE_PLAYING || deviceState == STATE_SCHEDULED) { sendError(txnId, ERR_BUSY, NULL); break; }
      uint8_t channel = CALIBRATION_REGIONS[regionIdx].outputChannel;
      outputChannelVoltageCodes[channel] = code;
      voltageCode = code;  // GET_STATUS 返回最后一次已应用的等级；实际输出仍保持 0。
      uint8_t p[2] = { regionIdx, code };
      sendFrame(OP_CALIBRATION_APPLIED, txnId, p, 2);
      break;
    }
    case OP_START_CALIBRATION: {
      if (len < 1) { sendError(txnId, ERR_BAD_FRAME, "len"); break; }
      if (!armed) { sendError(txnId, ERR_NOT_ARMED, NULL); break; }
      uint8_t regionIdx = payload[0];
      if (regionIdx >= CALIBRATION_REGION_COUNT) { sendError(txnId, ERR_INVALID_ELECTRODE_MAP, "region"); break; }
      if (deviceState == STATE_PLAYING || deviceState == STATE_SCHEDULED) { sendError(txnId, ERR_BUSY, NULL); break; }
      if (!CALIBRATION_REGIONS[regionIdx].calibrationSampleDefined) { sendError(txnId, ERR_SAMPLE_UNDEFINED, "calibration"); break; }
      calibrationRegion = &CALIBRATION_REGIONS[regionIdx];
      calibrationTxn = txnId;
      calibrationBurstsDone = 0;
      calibrationLastBurstUs = micros() - 33333UL;
      calibrationActive = true;
      uint8_t p[1] = { regionIdx };
      sendFrame(OP_CALIBRATION_STARTED, txnId, p, 1);
      break;
    }
    case OP_PREPARE_SAMPLE: {
      if (!armed) { sendError(txnId, ERR_NOT_ARMED, NULL); break; }
      if (deviceState == STATE_PLAYING || deviceState == STATE_SCHEDULED) { sendError(txnId, ERR_BUSY, NULL); break; }
      if (len == 0 || len > 64) { sendError(txnId, ERR_BAD_FRAME, "sampleId"); break; }
      char id[65];
      memcpy(id, payload, len); id[len] = 0;
      const SampleDefinition* sample = resolvePlayableSample(id);
      if (sample == NULL) { sendError(txnId, ERR_UNKNOWN_SAMPLE, id); break; }
      if (!sample->available) { sendError(txnId, ERR_SAMPLE_UNDEFINED, id); break; }
      char err[96];
      deviceState = STATE_PREPARING;
      if (!validateSample(*sample, err, sizeof(err))) {
        enterSafeState(7);
        sendError(txnId, ERR_INVALID_ELECTRODE_MAP, err);
        break;
      }
      preparedSample = sample;
      deviceState = STATE_PREPARED;
      uint8_t p[80];
      memcpy(p, id, len);
      uint32_t dur = sample->durationUs;
      p[len] = dur & 0xFF; p[len + 1] = (dur >> 8) & 0xFF; p[len + 2] = (dur >> 16) & 0xFF; p[len + 3] = (dur >> 24) & 0xFF;
      sendFrame(OP_PREPARED, txnId, p, len + 4);
      break;
    }
    case OP_COMMIT_AFTER: {
      if (len < 4) { sendError(txnId, ERR_BAD_FRAME, "delay"); break; }
      if (deviceState != STATE_PREPARED || preparedSample == NULL) { sendError(txnId, ERR_BAD_STATE, "not prepared"); break; }
      uint32_t delayMs = (uint32_t)payload[0] | ((uint32_t)payload[1] << 8) | ((uint32_t)payload[2] << 16) | ((uint32_t)payload[3] << 24);
      if (delayMs > 5000UL) { sendError(txnId, ERR_INVALID_OUTPUT, "delay"); break; }
      commitAfter(delayMs * 1000UL);
      // STARTED 在实际起播时发送（schedulerTick 的 PLAYING 分支）
      playTxnId = txnId;
      break;
    }
    case OP_STOP: {
      enterSafeState(0);
      sendFrame(OP_STOPPED, txnId, NULL, 0);
      break;
    }
    default:
      sendError(txnId, ERR_BAD_FRAME, "opcode");
      break;
  }
}

// ---------------- 初始化 ----------------
void setup() {
  Serial.begin(115200);
  outputFloatAll();      // 上电：输出 0 + 全部高阻
  lastHostActivityMs = millis();
  delay(500);
  char mapErr[96];
  if (!validateCalibrationMap(mapErr, sizeof(mapErr))) {
    faultCode = ERR_INVALID_ELECTRODE_MAP;
    deviceState = STATE_FAULT;
#if SERIAL_DEBUG
    Serial.print("[FAULT] calibration map: "); Serial.println(mapErr);
#endif
    outputFloatAll();
    return;
  }
#if SERIAL_DEBUG
  Serial.println("R2 demo firmware (Phase 2.2)");
#endif
#if ENABLE_DEV_CLI
  printStandaloneCliHelp();
#else
#if SERIAL_DEBUG
  Serial.println("协议 v2 已就绪；请由网页硬件宿主连接。");
#endif
#endif
}

void loop() {
  schedulerTick();
  calibrationTick();
#if !ENABLE_DEV_CLI
  protocolV2Poll();
#endif
#if ENABLE_DEV_CLI
  if (Serial.available() > 0) {
    lastHostActivityMs = millis();
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input == "a" || input == "A") {
      armOutput();
    } else if (input.startsWith("v ")) {
      setStandaloneTestVoltage(input);
    } else if (input == "s" || input == "S") {
      printStatus();
    } else if (input == "p" || input == "P") {
      startStandaloneLeftPalmCalibration();
    } else if (input == "r" || input == "R") {
      startStandaloneRightPalmCalibration();
    } else if (input.length() == 2 && (input[0] == 'k' || input[0] == 'K') && input[1] >= '0' && input[1] <= '7') {
      startStandaloneCalibration((uint8_t)(input[1] - '0'));
    } else if (input == "c" || input == "C") {
      printCatalogDiagnostic();
    } else if (input == "h" || input == "H") {
      printStandaloneCliHelp();
    } else if (input == "0" || input == "q" || input == "Q") {
      enterSafeState(0);
      Serial.println("[停止] 全部电极已隔离，输出归零。");
    } else if (input.length() > 0) {
      const char* sampleId = standaloneSampleIdForInput(input);
      if (sampleId != NULL) {
        startStandaloneSample(sampleId);
      } else {
        Serial.println("无效输入；输入 h 查看菜单。");
      }
    }
  }
#endif
}
