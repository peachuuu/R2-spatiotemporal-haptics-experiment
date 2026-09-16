import type { FingerId } from "./types";

/**
 * 与 `双手手套上位机260821/上位机/config.json` 的 mapping_groups 保持同序。
 * regionIndex 是固件协议 SET_CALIBRATION/START_CALIBRATION 使用的八区域索引；
 * outputChannel 是物理输出电压轨，二者与上位机 voltage 参数逐行一致。
 */
export const CALIBRATION_HARDWARE_MAP: Record<
  FingerId,
  { regionIndex: number; outputChannel: number; sharedChannelLabel: string }
> = {
  "left-palm": { regionIndex: 0, outputChannel: 0, sharedChannelLabel: "左手掌" },
  "left-thumb-index": { regionIndex: 1, outputChannel: 1, sharedChannelLabel: "左手拇指食指" },
  "left-middle-ring": { regionIndex: 2, outputChannel: 2, sharedChannelLabel: "左手中指无名指" },
  "left-little": { regionIndex: 3, outputChannel: 3, sharedChannelLabel: "左手小指" },
  "right-palm": { regionIndex: 4, outputChannel: 4, sharedChannelLabel: "右手掌" },
  "right-thumb-index": { regionIndex: 5, outputChannel: 5, sharedChannelLabel: "右手拇指食指" },
  "right-middle-ring": { regionIndex: 6, outputChannel: 6, sharedChannelLabel: "右手中指无名指" },
  "right-little": { regionIndex: 7, outputChannel: 7, sharedChannelLabel: "右手小指" }
};
