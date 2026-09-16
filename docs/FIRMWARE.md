# RP2040 固件说明

固件位于 `firmware/demo/`：

- `demo.ino`：协议、状态机和样本调度入口。
- `haptic_pw_lookup.h`：连续 PW 曲线查表。
- `hv.cpp`、`hv.h`：高压输出辅助代码。

使用与目标板兼容的 Arduino IDE/核心打开 `demo.ino`，确保四个文件位于同一工程目录后编译上传。上传完成后关闭 Arduino 串口监视器，再让浏览器连接该串口；同一 COM 口不能同时被 Arduino IDE 和浏览器占用。

安全要求：

- 真实刺激前完成硬件、电极、急停和伦理流程检查。
- 页面连接后仍需操作者手动 ARM。
- 出现异常体感、通信错误或接线问题时立即 STOP 并断开。
- GitHub 下载只能提供固件源码，不能自动完成烧录或替代实体硬件验收。

协议详情见 `serial-haptic-protocol.md`。

